"""조인앤조인 제품별 BOM 엑셀 임포터.

워크북 구조(2026 양식):
  - 시트 '원재료DB'   : 원재료 마스터 (no, 구분, 거래처, 품목코드, 품목명[규격], 규격, 규격단위, 단위, kg당단가, 규격당단가)
  - 시트 '부자재DB'   : 부자재 마스터 (롤지·용기·슬리브 등)
  - 제품 시트(마카롱, 베이글, 뚱낭시에 ...): 맛별 BOM
      · 다단계: 한 시트 안에 여러 '섹션'(빵/꼬끄, 크림, 앙글레즈 …)이 세로로 배치.
        섹션 헤더행(col0='ERP코드', col1='원재료명') + 맛 컬럼(6칸 블록).
        블록 내: +0 'kg당 투입량', +1 '*소요량(EA)', +2 '개당 투입량(kg)', +3/+4 …
      · 크림 제품(마카롱·휘낭시에): 섹션이 2개 이상 → 각 섹션을 '반제품'으로,
        완제품 = 같은 맛의 섹션들 합성.
      · 단일 제품(베이글 등): 섹션 1개 → 섹션의 맛 컬럼이 곧 '완제품'.
      · 마카롱 row1 병합셀 '사랑'/'감동' → 세트 구성(맛 그룹).

투입량 규칙:
  - 원재료: 개당 투입량(kg) = 맛컬럼+2  (>0)
  - 부자재: 소요량(EA)     = 맛컬럼+1  (개당 투입량 kg == 0 일 때)
  - 다른 섹션명과 일치하는 자재명(예: 앙글레즈)은 중첩 반제품으로 연결.
"""
from __future__ import annotations

import re
from typing import Optional

import pandas as pd

from app.db_models import (
    ScmProduct, ScmRawMaterial, ScmSubMaterial, ScmBomLine, ScmItemComponent,
)

# 제품 시트가 아닌 시트(자재 DB·요약·배합비 매트릭스)
NON_PRODUCT_SHEETS = {
    "원재료DB", "부자재DB", "배합비 DB", "배합비 DB(비건)", "총 필요량",
}

WEIGHT_RE = re.compile(r"\s*\(?\d+(\.\d+)?\s*g\)?\s*$")  # 끝의 '20g', '(20g)', '140g'
SECTION_WEIGHT_RE = re.compile(r"\((\d+(?:\.\d+)?)\s*g\)")


def _s(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).replace("\n", " ").strip()


def _f(v) -> float:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 0.0
    try:
        return float(str(v).replace(",", "").replace("원", "").strip())
    except Exception:
        return 0.0


def _clean_flavor(name: str) -> str:
    n = _s(name)
    n = WEIGHT_RE.sub("", n).strip()
    return n


def _is_header_row(df, r) -> bool:
    c0 = _s(df.iat[r, 0]) if df.shape[1] > 0 else ""
    c1 = _s(df.iat[r, 1]) if df.shape[1] > 1 else ""
    return c0 == "ERP코드" and c1 in ("원재료명", "원재료명 ")


def _section_label_row(df, header_r) -> str:
    """헤더행 바로 위(1~2행)에서 섹션명(col0, col1 비어있음)을 찾는다."""
    for rr in (header_r - 1, header_r - 2):
        if rr < 0:
            continue
        c0 = _s(df.iat[rr, 0])
        c1 = _s(df.iat[rr, 1])
        if c0 and not c1:
            return c0
    return ""


def _classify_section(label: str) -> tuple[str, Optional[float]]:
    """섹션명 → (반제품 종류, 개당중량g). 종류: 꼬끄/크림/<원문>."""
    g = None
    m = SECTION_WEIGHT_RE.search(label)
    if m:
        g = float(m.group(1))
    base = SECTION_WEIGHT_RE.sub("", label).strip()
    if "꼬끄" in base or "빵" in base:
        return "꼬끄", g
    if "크림" in base:
        return "크림", g
    return base or "본품", g


def _find_qty_cols(df, header_r, fcol) -> tuple[int, int]:
    """맛 컬럼 fcol 블록에서 개당투입량(kg)·소요량(EA) 컬럼을 찾는다.
    서브헤더는 header_r+1 ~ header_r+4 사이. 기본값 fcol+2 / fcol+1."""
    kg_col, ea_col = fcol + 2, fcol + 1
    for sr in range(header_r + 1, min(header_r + 5, df.shape[0])):
        rowtxt = {c: _s(df.iat[sr, c]) for c in range(fcol, min(fcol + 6, df.shape[1]))}
        if any("개당" in t and "투입량" in t for t in rowtxt.values()):
            for c, t in rowtxt.items():
                if "개당" in t and "투입량" in t:
                    kg_col = c
                if "소요량" in t:
                    ea_col = c
            break
    return kg_col, ea_col


def _detect_flavor_cols(df, header_r) -> list[tuple[int, str]]:
    """헤더행에서 맛 컬럼(col>=5, 요약/필요량 블록 이전)을 추출."""
    out = []
    ncol = df.shape[1]
    for c in range(5, ncol):
        t = _s(df.iat[header_r, c])
        if not t:
            continue
        # 요약 블록(ERP코드/원재료명/필요량/규격) 만나면 중단
        if t in ("ERP코드", "ERP 코드", "원재료명", "규격", "규격 단위") or "필요량" in t or "ERP" in t:
            break
        out.append((c, t))
    return out


def _detect_sections(df) -> list[dict]:
    """시트 내 모든 섹션(헤더행/자재범위/섹션명) 탐지."""
    sections = []
    nrow = df.shape[0]
    header_rows = [r for r in range(nrow) if _is_header_row(df, r)]
    for idx, hr in enumerate(header_rows):
        # 자재 시작: 헤더+1 이후 col0/col1에 값이 처음 나오는 행
        mat_start = None
        for r in range(hr + 1, nrow):
            c0 = _s(df.iat[r, 0]); c1 = _s(df.iat[r, 1])
            if c0 or c1:
                # 서브헤더(개당투입량 등)는 col0/col1 비어있음 → 건너뜀
                if c0 in ("ERP코드",) :
                    continue
                mat_start = r
                break
        if mat_start is None:
            continue
        # 자재 끝: 다음 헤더행 전 또는 '합계' 행까지
        next_hr = header_rows[idx + 1] if idx + 1 < len(header_rows) else nrow
        mat_end = next_hr
        for r in range(mat_start, next_hr):
            if _s(df.iat[r, 1]) == "합계" or _s(df.iat[r, 0]) == "합계":
                mat_end = r
                break
        sections.append({
            "label": _section_label_row(df, hr),
            "header_r": hr,
            "mat_start": mat_start,
            "mat_end": mat_end,
        })
    return sections


def _label_group_cols(df, header_r) -> dict:
    """헤더 위 행(header_r-1, 없으면 header_r-2)에서 사랑/감동 등 그룹 라벨의 컬럼 위치 매핑.
    병합이 아니라 개별 셀에 반복 기입돼 있고, 라벨은 해당 맛 블록(6칸) 내부에 위치한다.
    반환: {col: '사랑'|'감동'}."""
    out = {}
    for rr in (header_r - 1, header_r - 2):
        if rr < 0:
            continue
        found = False
        for c in range(5, df.shape[1]):
            t = _s(df.iat[rr, c])
            if t in ("사랑", "감동") or t.endswith("세트") and ("사랑" in t or "감동" in t):
                out[c] = t.replace("세트", "").strip()
                found = True
        if found:
            break
    return out


def import_bom_workbook(path: str, db, replace: bool = True) -> dict:
    """BOM 워크북을 적재. replace=True면 기존 BOM/세트/자재를 비우고 재적재."""
    report = {"raw_materials": 0, "sub_materials": 0, "sheets": [], "errors": []}

    if replace:
        db.query(ScmBomLine).delete()
        db.query(ScmItemComponent).delete()
        # BOM에서 생성한 품목(item_type 보유)만 삭제 — 기존 생산 품목은 보존
        db.query(ScmProduct).filter(ScmProduct.item_type.in_(
            ["원재료", "부자재", "반제품", "완제품", "세트", "혼합세트"]
        )).delete(synchronize_session=False)
        db.query(ScmRawMaterial).delete()
        db.query(ScmSubMaterial).delete()
        db.commit()

    xl = pd.ExcelFile(path)

    # ── 1. 원재료DB ──
    raw_by_code, raw_by_name = {}, {}
    if "원재료DB" in xl.sheet_names:
        df = pd.read_excel(path, sheet_name="원재료DB", header=1)
        for _, row in df.iterrows():
            name = _s(row.get("품목명 [규격]") or row.get("품목명"))
            if not name or name in ("품목명 [규격]",):
                continue
            code = _s(row.get("품목코드"))
            rm = ScmRawMaterial(
                erp_code=code or None,
                name=name,
                supplier=_s(row.get("거래처명")) or None,
                material_class=_s(row.get("구분")) or "원재료",
                spec=_s(row.get("규격")) or None,
                spec_unit=_s(row.get("규격단위")) or None,
                unit=_s(row.get("단위")) or None,
                kg_price=_f(row.get("kg당 단가")),
                spec_price=_f(row.get("규격당 단가")),
            )
            db.add(rm)
            db.flush()
            if code:
                raw_by_code[code] = rm.id
            raw_by_name[name] = rm.id
            report["raw_materials"] += 1
        db.commit()

    # ── 2. 부자재DB ──
    sub_by_code, sub_by_name = {}, {}
    if "부자재DB" in xl.sheet_names:
        df = pd.read_excel(path, sheet_name="부자재DB", header=1)
        for _, row in df.iterrows():
            name = _s(row.get("품목명 [규격]") or row.get("품목명"))
            if not name:
                continue
            code = _s(row.get("품목코드"))
            sm = ScmSubMaterial(
                erp_code=code or None,
                name=name,
                supplier=_s(row.get("거래처명")) or None,
                unit=_s(row.get("단위")) or None,
                roll_price=_f(row.get("롤당 단가")),
                producible_qty=_f(row.get("생산가능수량")),
                unit_price=_f(row.get("개당 단가\n(롤지=cm당 단가)") or row.get("개당 단가")),
            )
            db.add(sm)
            db.flush()
            if code:
                sub_by_code[code] = sm.id
            sub_by_name[name] = sm.id
            report["sub_materials"] += 1
        db.commit()

    # 품목 캐시
    item_cache: dict[str, int] = {}

    def get_item(name, item_type, flavor=None, flavor_group=None, weight_g=None, category=None):
        key = name
        if key in item_cache:
            return item_cache[key]
        it = ScmProduct(
            product_name=name,
            product_category=category,
            item_type=item_type,
            flavor=flavor,
            flavor_group=flavor_group,
            unit_weight_g=weight_g or 0,
            is_active=True,
        )
        db.add(it)
        db.flush()
        item_cache[name] = it.id
        return it.id

    # ── 3. 제품 시트 ──
    for sheet in xl.sheet_names:
        if sheet in NON_PRODUCT_SHEETS:
            continue
        try:
            df = pd.read_excel(path, sheet_name=sheet, header=None)
            if df.empty:
                continue
            sections = _detect_sections(df)
            if not sections:
                report["sheets"].append({"sheet": sheet, "skipped": "no sections"})
                continue
            is_split = len(sections) > 1
            section_labels = {_classify_section(s["label"])[0] for s in sections}

            sheet_rep = {"sheet": sheet, "sections": len(sections), "items": 0,
                         "bom_lines": 0, "flavors": set(), "sets": []}
            # 맛별 반제품 id 모음: {flavor: {sec_kind: item_id}}
            flavor_semi: dict[str, dict[str, int]] = {}
            flavor_group_map: dict[str, str] = {}

            for sec in sections:
                kind, sweight = _classify_section(sec["label"])
                fcols = _detect_flavor_cols(df, sec["header_r"])
                # 사랑/감동 그룹 — 헤더 위 행의 라벨(블록 내부 위치)
                gcols = _label_group_cols(df, sec["header_r"])

                # 섹션에 맛이 여러 개면 맛별, 1개뿐이면 단일 반제품
                for fcol, fname_raw in fcols:
                    flavor = _clean_flavor(fname_raw)
                    if not flavor:
                        continue
                    kg_col, ea_col = _find_qty_cols(df, sec["header_r"], fcol)
                    # 라벨이 이 맛 블록(fcol..fcol+5) 안에 있으면 그 그룹에 배정
                    fgroup = None
                    for cc in range(fcol, fcol + 6):
                        if cc in gcols:
                            fgroup = gcols[cc]
                            break
                    if fgroup:
                        flavor_group_map[flavor] = fgroup

                    if is_split:
                        # 섹션명과 맛이 같으면(서브레시피: 가나슈/앙글레즈 등) 중복 제거
                        item_name = f"{sheet} {kind}" if kind == flavor else f"{sheet} {kind} {flavor}"
                        item_type = "반제품"
                    else:
                        item_name = flavor if flavor.startswith(sheet) else f"{sheet} {flavor}"
                        item_type = "완제품"
                    item_id = get_item(item_name, item_type, flavor=flavor,
                                       flavor_group=fgroup, weight_g=sweight, category=sheet)
                    sheet_rep["items"] += 1
                    sheet_rep["flavors"].add(flavor)
                    if is_split:
                        flavor_semi.setdefault(flavor, {})[kind] = item_id

                    # 자재 라인
                    for r in range(sec["mat_start"], sec["mat_end"]):
                        erp = _s(df.iat[r, 0]); mname = _s(df.iat[r, 1])
                        if not mname and not erp:
                            continue
                        if mname == "합계":
                            break
                        qkg = _f(df.iat[r, kg_col]) if kg_col < df.shape[1] else 0
                        qea = _f(df.iat[r, ea_col]) if ea_col < df.shape[1] else 0
                        # 중첩 반제품(예: 앙글레즈)
                        nested = None
                        for s2 in sections:
                            k2, _ = _classify_section(s2["label"])
                            if k2 != kind and (k2 == mname or s2["label"] == mname or mname in s2["label"]):
                                nested = k2
                                break
                        if qkg <= 0 and qea <= 0:
                            continue
                        if nested:
                            mtype, qty, qunit = "semi", (qkg or qea), ("kg" if qkg else "ea")
                            rid = sid = None
                        elif qkg > 0:
                            mtype, qty, qunit = "raw", qkg, "kg"
                            rid = raw_by_code.get(erp) or raw_by_name.get(mname)
                            sid = None
                        else:
                            mtype, qty, qunit = "sub", qea, "ea"
                            sid = sub_by_code.get(erp) or sub_by_name.get(mname)
                            rid = None
                        db.add(ScmBomLine(
                            item_id=item_id, material_type=mtype,
                            raw_material_id=rid, sub_material_id=sid,
                            material_erp_code=erp or None, material_name=mname or None,
                            qty_per_unit=qty, qty_unit=qunit, source_sheet=sheet,
                        ))
                        sheet_rep["bom_lines"] += 1

            # ── 완제품 합성(split) ──
            if is_split:
                for flavor, parts in flavor_semi.items():
                    fin_name = f"{sheet} {flavor}"
                    fin_id = get_item(fin_name, "완제품", flavor=flavor,
                                      flavor_group=flavor_group_map.get(flavor), category=sheet)
                    sheet_rep["items"] += 1
                    for kind, child_id in parts.items():
                        db.add(ScmItemComponent(parent_item_id=fin_id, child_item_id=child_id, qty=1))

            # ── 세트(사랑/감동) ──
            groups = {}
            for flavor, g in flavor_group_map.items():
                groups.setdefault(g, []).append(flavor)
            for gname, flavors in groups.items():
                set_name = f"{sheet} {gname}세트"
                set_id = get_item(set_name, "세트", flavor_group=gname, category=sheet)
                sheet_rep["sets"].append({"name": set_name, "count": len(flavors)})
                for flavor in flavors:
                    fin = item_cache.get(f"{sheet} {flavor}")
                    if fin:
                        db.add(ScmItemComponent(parent_item_id=set_id, child_item_id=fin, qty=1))

            db.commit()
            sheet_rep["flavors"] = sorted(sheet_rep["flavors"])
            report["sheets"].append(sheet_rep)
        except Exception as e:
            db.rollback()
            report["errors"].append({"sheet": sheet, "error": str(e)})

    return report


# 비파괴 반영 시 시트명 → 기존 품목 접두어(시트명이 바뀐 경우), 제외 시트(중복본·필링 구조)
SHEET_PREFIX = {"베이글,GS베이글": "베이글", "LLB 카스테라 2종": "카스테라 2종"}
UPSERT_SKIP = {"500깜빠뉴(구 사워도우)", "LLB 도넛케이크 2종"}


def upsertable_sheets(path: str) -> list[str]:
    """'*' 반영 대상: 단일 레시피 제품 시트(꼬끄/빵+크림 합성 시트·자재DB·중복본 제외)."""
    xl = pd.ExcelFile(path)
    out = []
    for sh in xl.sheet_names:
        if sh in NON_PRODUCT_SHEETS or sh in UPSERT_SKIP:
            continue
        df = pd.read_excel(path, sheet_name=sh, header=None)
        secs = _detect_sections(df)
        if not secs or any(_classify_section(s["label"])[0] in ("꼬끄", "크림") for s in secs):
            continue
        out.append(sh)
    return out


def upsert_bom_sheets(path: str, db, sheets: list[str]) -> dict:
    """선택한 제품 시트만 **비파괴** 반영(기존 품목·자재·CSA 연결·노무비 보존).

    - 자재: 기존 마스터를 ERP코드→이름 순으로 재사용, 없을 때만 시트 '원재료DB/부자재DB' 행으로 신설.
    - 품목: 같은 이름이 있으면 BOM 라인만 교체(id·csa_product_id·labor 유지), 없으면 완제품 신설.
    - 섹션마다 맛 컬럼 = 완제품(단일 레시피 시트 기준). 꼬끄/크림 합성 시트(마카롱 등)는 대상 아님.
    - 같은 섹션에서 이름이 겹치는데 투입량이 다르면 첫 섹션 같은 열의 맛명을 붙여 구분.
    """
    report = {"sheets": [], "errors": [], "new_raw": [], "new_sub": [], "new_items": [], "updated_items": [],
              "sheet_priced": []}
    xl = pd.ExcelFile(path)
    if sheets == ["*"]:
        sheets = upsertable_sheets(path)

    raw_by_code, raw_by_name = {}, {}
    for m in db.query(ScmRawMaterial).all():
        if m.erp_code and m.erp_code.strip() not in ("", "-"):
            raw_by_code.setdefault(m.erp_code.strip(), m.id)
        raw_by_name.setdefault(m.name, m.id)
    sub_by_code, sub_by_name = {}, {}
    for m in db.query(ScmSubMaterial).all():
        if m.erp_code and m.erp_code.strip() not in ("", "-"):
            sub_by_code.setdefault(m.erp_code.strip(), m.id)
        sub_by_name.setdefault(m.name, m.id)

    # 시트 자재DB(신설 시 단가 출처, VAT별도)
    raw_db, sub_db = {}, {}
    if "원재료DB" in xl.sheet_names:
        for _, row in pd.read_excel(path, sheet_name="원재료DB", header=1).iterrows():
            name = _s(row.get("품목명 [규격]") or row.get("품목명"))
            if name and name != "품목명 [규격]":
                raw_db[name] = row
                if _s(row.get("품목코드")):
                    raw_db[_s(row.get("품목코드"))] = row
    if "부자재DB" in xl.sheet_names:
        for _, row in pd.read_excel(path, sheet_name="부자재DB", header=1).iterrows():
            name = _s(row.get("품목명 [규격]") or row.get("품목명"))
            if name:
                sub_db[name] = row
                if _s(row.get("품목코드")):
                    sub_db[_s(row.get("품목코드"))] = row

    def raw_id(erp, mname, sheet_price=0.0, sheet_spec=0.0):
        rid = raw_by_code.get(erp) or raw_by_name.get(mname)
        if rid:
            return rid
        row = raw_db.get(erp) if erp else None
        row = row if row is not None else raw_db.get(mname)
        if row is None:
            report["sheet_priced"].append(mname)   # 자재DB에 없음 → 제품시트 행의 규격단가 사용
        rm = ScmRawMaterial(
            erp_code=erp or None, name=mname or erp,
            supplier=_s(row.get("거래처명")) if row is not None else None,
            material_class=(_s(row.get("구분")) if row is not None else "") or "원재료",
            spec=_s(row.get("규격")) if row is not None else None,
            unit=_s(row.get("단위")) if row is not None else None,
            kg_price=_f(row.get("kg당 단가")) if row is not None else (
                sheet_price / sheet_spec if sheet_spec else sheet_price),
            spec_price=_f(row.get("규격당 단가")) if row is not None else sheet_price,
            notes="BOM 시트 선택반영(VAT별도)",
        )
        db.add(rm); db.flush()
        if erp:
            raw_by_code[erp] = rm.id
        raw_by_name[rm.name] = rm.id
        report["new_raw"].append(rm.name)
        return rm.id

    def sub_id(erp, mname, sheet_price=0.0):
        sid = sub_by_code.get(erp) or sub_by_name.get(mname)
        if sid:
            return sid
        row = sub_db.get(erp) if erp else None
        row = row if row is not None else sub_db.get(mname)
        if row is None:
            report["sheet_priced"].append(mname)
        sm = ScmSubMaterial(
            erp_code=erp or None, name=mname or erp,
            supplier=_s(row.get("거래처명")) if row is not None else None,
            unit=_s(row.get("단위")) if row is not None else None,
            roll_price=_f(row.get("롤당 단가")) if row is not None else 0,
            producible_qty=_f(row.get("생산가능수량")) if row is not None else 0,
            unit_price=(_f(row.get("개당 단가\n(롤지=cm당 단가)") or row.get("개당 단가")) if row is not None
                        else sheet_price),
        )
        db.add(sm); db.flush()
        if erp:
            sub_by_code[erp] = sm.id
        sub_by_name[sm.name] = sm.id
        report["new_sub"].append(sm.name)
        return sm.id

    orphans: set = set()
    for sheet in sheets:
        if sheet not in xl.sheet_names:
            report["errors"].append({"sheet": sheet, "error": "시트 없음"})
            continue
        try:
            df = pd.read_excel(path, sheet_name=sheet, header=None)
            sections = _detect_sections(df)
            first_cols = dict(_detect_flavor_cols(df, sections[0]["header_r"])) if sections else {}
            rep = {"sheet": sheet, "items": []}
            for sec in sections:
                seen: dict[str, tuple] = {}
                fcols = _detect_flavor_cols(df, sec["header_r"])
                # 같은 맛명(중량 제거 후)이 중량만 다르게 여러 열이면 중량을 이름에 남겨 구분
                # (예: 노브랜드 화이트식빵 600g / 90g — 기존 임포터는 한 품목에 합쳐 원가 과대)
                variants: dict[str, set] = {}
                for _c, fr in fcols:
                    variants.setdefault(_clean_flavor(fr), set()).add(re.sub(r"\s+", " ", _s(fr)))
                for fcol, fname_raw in fcols:
                    flavor = _clean_flavor(fname_raw)
                    if not flavor:
                        continue
                    if len(variants.get(flavor, ())) > 1:
                        flavor = re.sub(r"\s+", " ", _s(fname_raw))
                    kg_col, ea_col = _find_qty_cols(df, sec["header_r"], fcol)
                    lines = []
                    for r in range(sec["mat_start"], sec["mat_end"]):
                        erp = _s(df.iat[r, 0]); mname = _s(df.iat[r, 1])
                        if not mname and not erp:
                            continue
                        if mname == "합계":
                            break
                        if erp.endswith(".0") and erp[:-2].isdigit():
                            erp = erp[:-2]
                        if erp == mname or not re.fullmatch(r"[0-9A-Za-z\-]+", erp or "-"):
                            erp = ""          # 코드칸에 이름이 들어간 행(체다치즈향·롤지 등)
                        qkg = _f(df.iat[r, kg_col]) if kg_col < df.shape[1] else 0
                        qea = _f(df.iat[r, ea_col]) if ea_col < df.shape[1] else 0
                        sp, sspec = _f(df.iat[r, 3]), _f(df.iat[r, 2])
                        # 포장재(롤지·필름)는 시트에 kg칸이 채워져 있어도 부자재(개수)로
                        is_sub = ("롤지" in mname or mname in sub_db or (erp and erp in sub_db)
                                  or (mname in sub_by_name and mname not in raw_by_name))
                        if is_sub and (qea > 0 or qkg > 0):
                            lines.append(("sub", erp, mname, qea or 1.0, "ea", sp, 0.0))
                        elif qkg > 0:
                            lines.append(("raw", erp, mname, qkg, "kg", sp, sspec))
                        elif qea > 0:
                            lines.append(("sub", erp, mname, qea, "ea", sp, 0.0))
                    if not lines:
                        continue
                    sig = tuple(x[:5] for x in lines)
                    if flavor in seen:
                        if seen[flavor] == sig:
                            continue
                        pair = _clean_flavor(first_cols.get(fcol, "")) or str(fcol)
                        flavor = f"{flavor} ({pair}용)"
                    seen[flavor] = sig
                    prefix = SHEET_PREFIX.get(sheet, sheet)
                    item_name = flavor if flavor.startswith(prefix) else f"{prefix} {flavor}"
                    it = db.query(ScmProduct).filter(ScmProduct.product_name == item_name).first()
                    if it:
                        db.query(ScmBomLine).filter(ScmBomLine.item_id == it.id).delete()
                        # 구 임포터가 '본품' 반제품 1개로 감싼 구조(아메쿠키·CU파운드 등)는 직접 라인으로 평탄화
                        # — 남겨두면 반제품 원가 + 직접 라인이 이중 합산됨
                        for c in db.query(ScmItemComponent).filter(ScmItemComponent.parent_item_id == it.id).all():
                            orphans.add(c.child_item_id)
                            db.delete(c)
                        report["updated_items"].append(item_name)
                    else:
                        m = SECTION_WEIGHT_RE.search(fname_raw) or re.search(r"(\d+(?:\.\d+)?)\s*g", fname_raw, re.I)
                        it = ScmProduct(product_name=item_name, product_category=prefix, item_type="완제품",
                                        flavor=flavor, unit_weight_g=float(m.group(1)) if m else 0,
                                        is_active=True, notes="BOM 시트 선택반영")
                        db.add(it); db.flush()
                        report["new_items"].append(item_name)
                    for i, (t, erp, mname, q, u, sp, sspec) in enumerate(lines, 1):
                        rid = raw_id(erp, mname, sp, sspec) if t == "raw" else None
                        sid = sub_id(erp, mname, sp) if t == "sub" else None
                        db.add(ScmBomLine(item_id=it.id, material_type=t, raw_material_id=rid,
                                          sub_material_id=sid, material_erp_code=erp or None,
                                          material_name=mname or None, qty_per_unit=q, qty_unit=u,
                                          source_sheet=sheet, sort_order=i))
                    rep["items"].append(item_name)
            db.flush()
            for cid in orphans:
                if not db.query(ScmItemComponent).filter(ScmItemComponent.child_item_id == cid).count():
                    ch = db.query(ScmProduct).filter(ScmProduct.id == cid, ScmProduct.item_type == "반제품").first()
                    if ch and ch.is_active is not False:
                        ch.is_active = False
                        ch.notes = ((ch.notes or "") + " [시트 선택반영으로 완제품 직접라인 전환 — 미사용]").strip()
                        report.setdefault("deactivated_semis", []).append(ch.product_name)
            orphans.clear()
            db.commit()
            report["sheets"].append(rep)
        except Exception as e:
            db.rollback()
            report["errors"].append({"sheet": sheet, "error": str(e)})
    return report
