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
