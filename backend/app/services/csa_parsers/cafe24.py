"""카페24 (자사몰) 파서.

기준변경요청서 #83 (MD 김재경, 2025-01-01 적용분부터 전 기간 동일 적용)
──────────────────────────────────────────────────────────────────────
  ① 순매출 = 주문번호별 [총 실결제금액(최초정보)] ÷ 1.1  (매월 일관 적용)
     · 이 금액은 '주문 단위' 값이 품목 행마다 반복 기재돼 있다 → 행 단순합산 금지.
       주문당 1회만 집계하고, 그 주문의 살아있는(비취소) 품목 행에
       (상품구매금액 − 상품별 추가할인금액) 비율로 안분한다(행 합계 = 주문 금액, 원 단위 오차 없음).
       → 품목별 매출 분석이 가능하면서 채널 합계는 주문 금액 합과 정확히 일치.
     · ÷1.1은 이 파서에서 직접 적용한다. 카페24/자사몰은 csa_service.VAT_INCLUDED_CHANNELS에
       없으므로(2026-06-15 제외) ingest에서 추가 환산되지 않는다 — 이중 환산 없음.
       ※ '월마다 ÷1.1이 섞인' 원인: 2026-05-19 커밋(94c2b1f)에서 카페24/자사몰을
         VAT_INCLUDED_CHANNELS에 넣었다가 2026-06-15 커밋(db108a9)에서 뺐다. 환산은
         ingest 시점에 raw_lines에 '구워져' 저장되므로, 그 사이(5/19~6/15)에 올린 배치는
         ÷1.1, 그 전·후에 올린 배치는 미환산 — 판매월이 아니라 '업로드 시점'에 따라 섞였다.
  ② 취소 처리 (AN열[취소구분])
     · '취소'·'부분취소' 행 → 취소 행(is_cancelled, 매출·낱개 미반영). 부분취소 품목 금액은
       주문 최초 실결제금액에서 차감(2026-11-08 김재경 회신 — 낱개·매출 모두 취소분 제외).
     · 주문의 모든 행이 취소 → 완전취소 주문: 주문수·매출 모두 제외.
       하나라도 '취소안함'이면 정상 주문: 취소 행만 빼고, 주문 실결제금액은 남은 행에 안분.
     · 구양식(AN열 없음, 2026-06-12 이전 보관본)은 B열[결제구분]=='F' 행을 취소로 본다.
  ③ 낱개 = 입수 × I열[수량]  (ParsedLine.unit_per_set 으로 직접 지정)
     입수 결정 순서:
       0) 상품코드(AK) 매핑표 cafe24_units.CAFE24_UNITS_BY_CODE (MD 정답표 182종) — 최우선
       1) 옵션(AM)에 '총 N개/구/봉' → N
       2) 옵션을 '+'·','로 나눠 조각마다 N(개입·개·구·봉·ea·캔·병) × M(박스·box, 기본 1) 합산
          ('선택 안함' 조각은 숫자가 없어 자연히 0). 1+1·증정 조각도 포함.
       3) 옵션에 단위가 없으면 F열[상품명]을 같은 규칙으로
       4) 적립금·쇼핑백 → 0
     표에 있는 코드에서 규칙으로도 못 찾으면 0(정답표 기준), 표에 없는 코드에서
     못 찾으면 None → 기존 ChannelProductMapping 입수값을 따른다.
     ⚠ csa_service는 다중매핑(ChannelProductMappingComponent)이 걸린 상품이면 파서의
       unit_per_set을 쓰지 않고 컴포넌트 입수로 분할한다(공유 로직).
  ④ 주문건수 = 주문번호 고유값(완전취소 제외) — routes/csa.py _DISTINCT_ORDER_CHANNELS가
     비취소 행의 주문번호를 센다. 완전취소 주문은 모든 행이 is_cancelled라 자동 제외.
  ⑤ 공동구매 구분: 매핑표의 공동구매 플래그, 표에 없으면 상품명 '[OOX널담]' 패턴.
     raw_row["판매구분"]에 '공동구매'/'자사몰'로 남긴다(ParsedLine에 전용 필드 없음).

  날짜: K열[주문일시] (결제일시는 취소 행에서 NaT가 흔함).
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_datetime, to_float, to_str,
)
from app.services.csa_parsers.cafe24_units import CAFE24_UNITS_BY_CODE

_VAT = 1.1

# '총 16개', '총 24구', '총 9봉'
_TOTAL_RE = re.compile(r"총\s*(\d+)\s*(개입|개|구|봉|캔|병|ea)", re.I)
# 조각별 낱개 단위: 8개입 / 7개 / 8구 / 5봉 / 4ea / 24캔 / 3병
_UNIT_RE = re.compile(r"(\d+)\s*(개입|개|구|봉|캔|병|ea)", re.I)
# 박스 수: 2박스 / 2BOX / 2box
_BOX_RE = re.compile(r"(\d+)\s*(박스|box)", re.I)
# 낱개 집계 제외 품목
_NON_PRODUCT_RE = re.compile(r"적립금|쇼핑백")
# 공동구매 상품명 패턴: [신여성X널담], [다쿵x널담], [28기 현숙X널담] …
_GROUP_BUY_RE = re.compile(r"\[[^\]]*[xX]\s*널담")


def _units_in_text(text: Optional[str]) -> Optional[int]:
    """한 텍스트(옵션 또는 상품명)에서 세트당 낱개 수. 단위를 못 찾으면 None."""
    if not text:
        return None
    m = _TOTAL_RE.search(text)
    if m:
        return int(m.group(1))
    total = 0
    found = False
    for piece in re.split(r"[+,]", text):
        u = _UNIT_RE.search(piece)
        if not u:
            continue
        found = True
        # 박스 수는 단위 뒤쪽을 먼저 보고(8구 2박스), 없으면 조각 전체에서
        b = _BOX_RE.search(piece[u.end():]) or _BOX_RE.search(piece)
        total += int(u.group(1)) * (int(b.group(1)) if b else 1)
    return total if found else None


def _units_by_rule(prod_name: Optional[str], option: Optional[str]) -> Optional[int]:
    """#83 규칙 1)~4) — 옵션 우선, 없으면 상품명."""
    if _NON_PRODUCT_RE.search(prod_name or ""):
        return 0
    v = _units_in_text(option)
    if v is None:
        v = _units_in_text(prod_name)
    return v


# 옵션에서 박스 수를 고르는 코드: 박스당 입수 (2026-11-08 김재경 — 아메리칸쿠키 6개 2박스=12)
_PER_BOX: dict[str, int] = {"P0000DGU": 6}


def units_per_set(code: Optional[str], prod_name: Optional[str], option: Optional[str]) -> Optional[int]:
    """상품코드 매핑표 우선, 없으면 규칙. None이면 매핑 테이블 입수값에 맡김."""
    if code and code in _PER_BOX:
        # 상품명엔 'N개 2/3박스'처럼 박스 수가 둘 다 적혀 규칙이 틀림 → 옵션의 박스 수 × 박스당 입수
        m = re.search(r"(\d+)\s*(?:박스|box|BOX)", option or "")
        return _PER_BOX[code] * (int(m.group(1)) if m else 1)
    if code and code in CAFE24_UNITS_BY_CODE:
        fixed, _gb = CAFE24_UNITS_BY_CODE[code]
        if fixed is not None:
            return fixed
        v = _units_by_rule(prod_name, option)
        return v if v is not None else 0
    return _units_by_rule(prod_name, option)


def is_group_buy(code: Optional[str], prod_name: Optional[str]) -> bool:
    """공동구매 상품 여부 — 매핑표 플래그 우선, 없으면 상품명 패턴."""
    if code and code in CAFE24_UNITS_BY_CODE:
        return CAFE24_UNITS_BY_CODE[code][1]
    return bool(_GROUP_BUY_RE.search(prod_name or ""))


def _order_total(row) -> float:
    """주문 단위 총 실결제금액(최초정보). 컬럼명 변형 대비."""
    for col in ("총 실결제금액(최초정보) (KRW)", "총 실결제금액(최초정보)", "총 실결제금액"):
        if col in row.index:
            v = row.get(col)
            if v is not None and str(v) != "nan":
                return to_float(v)
    return 0.0


@register("자사몰")
@register("카페24")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)

    # 신양식 판별: AN열[취소구분] 존재 여부. 없으면 결제구분 F 로 취소 판별(구양식).
    has_cancel_col = "취소구분" in df.columns

    # ── 1패스: 행 정리 + 주문별 묶기 ─────────────────────────────────────
    rows: list[dict] = []
    seq: dict = {}

    def _seq_line_no(order_no, sku: str) -> str:
        k = (order_no, sku)
        n = seq.get(k, 0)
        seq[k] = n + 1
        return f"{sku}-{n}"

    for _idx, (_, row) in enumerate(df.iterrows()):
        prod_name = to_str(row.get("상품명(한국어 쇼핑몰)") or row.get("상품명"))
        if not prod_name:
            continue
        sale_dt = to_datetime(row.get("주문일시") or row.get("결제일시(입금확인일)"))
        if not sale_dt:
            continue

        if has_cancel_col:
            # '취소'·'부분취소' 행 → 제외(낱개·매출). 부분취소 품목 금액은 아래 안분 단계에서
            # 주문 최초 실결제금액에서 차감한다 — 낱개·매출 모두 '취소분 제외'로 통일
            # (2026-11-08 김재경 회신. 8월 낱개 150,601).
            _cx = to_str(row.get("취소구분"))
            is_cancel = _cx in ("취소", "부분취소")
            is_partial = _cx == "부분취소"
        else:
            pay_type = to_str(row.get("결제구분"))
            is_cancel = bool(pay_type and pay_type.upper() == "F")
            is_partial = False
            # 구양식엔 AN열이 없어 결제구분 T로 남은 취소 행을 못 가린다 →
            # 최초 실결제 > 0 인데 현재 [총 결제금액] == 0 이면 주문 전체 취소로 본다.
            # (2026-08 신양식 검증: 완전취소 637건 모두 총 결제금액 0, 정상 주문은 0 아님)
            if not is_cancel and "총 결제금액(KRW)" in row.index:
                if _order_total(row) > 0 and to_float(row.get("총 결제금액(KRW)") or 0) == 0:
                    is_cancel = True

        code = to_str(row.get("상품코드")) or None
        option = to_str(row.get("상품옵션"))
        line_amt = to_float(row.get("상품구매금액(KRW)") or row.get("판매가") or 0)
        extra_discount = to_float(row.get("상품별 추가할인금액") or 0)

        rows.append({
            "order_no": to_str(row.get("주문번호")),
            # line_no: 상품품목코드(SKU) > 상품코드 > 상품번호 + 같은 주문·SKU 안의 순번.
            #   (같은 주문에 동일 SKU 행 중복 시 dedup 탈락 방지. 파일 행 번호를 쓰면
            #    같은 달을 다시 받은 파일에서 키가 달라져 이중 적재됨 — 8월 주문 +87)
            "line_no": _seq_line_no(
                to_str(row.get("주문번호")),
                to_str(row.get("상품품목코드")) or code or to_str(row.get("상품번호")) or "",
            ),
            "sale_dt": sale_dt,
            "prod_name": prod_name,
            "option": option,
            "code": code,
            "qty": to_float(row.get("수량") or 1),
            "line_amt": line_amt,
            "weight": max(line_amt - extra_discount, 0.0),
            "order_total": _order_total(row),
            "is_cancel": is_cancel,
            "is_partial": is_partial,
        })

    # 주문별: 살아있는 행 목록 + 주문 실결제금액(주문 단위 값 — 첫 행 값 1회만)
    order_live: dict[str, list[int]] = {}
    order_total: dict[str, float] = {}
    partial_amt: dict[str, float] = {}  # 부분취소 품목 금액(상품구매금액−추가할인 = 그 품목 환불액)
    for i, r in enumerate(rows):
        key = r["order_no"] or f"__row{i}"
        r["_key"] = key
        order_total.setdefault(key, r["order_total"])
        if r["is_partial"]:
            partial_amt[key] = partial_amt.get(key, 0.0) + r["weight"]
        if not r["is_cancel"]:
            order_live.setdefault(key, []).append(i)

    # ── 주문 실결제금액 → 살아있는 행에 안분 (÷1.1) ─────────────────────
    #   완전취소 주문은 order_live에 없음 → 매출 0, 모든 행 취소로 방출.
    alloc: dict[int, float] = {}
    for key, idxs in order_live.items():
        total = max(order_total.get(key, 0.0) - partial_amt.get(key, 0.0), 0.0) / _VAT
        weights = [rows[i]["weight"] for i in idxs]
        wsum = sum(weights)
        if wsum <= 0:
            weights = [1.0] * len(idxs)
            wsum = float(len(idxs))
        acc = 0.0
        for n, i in enumerate(idxs):
            if n == len(idxs) - 1:
                alloc[i] = total - acc  # 마지막 행이 잔여분 흡수 → 주문 합계 정확히 일치
            else:
                share = total * weights[n] / wsum
                alloc[i] = share
                acc += share

    # ── 2패스: ParsedLine 방출 ──────────────────────────────────────────
    for i, r in enumerate(rows):
        group_buy = is_group_buy(r["code"], r["prod_name"])
        raw_row = {"판매구분": "공동구매" if group_buy else "자사몰", "상품코드": r["code"]}

        if r["is_cancel"]:
            yield ParsedLine(
                sale_date=r["sale_dt"].date(),
                sale_datetime=r["sale_dt"],
                order_no=r["order_no"],
                line_no=r["line_no"],
                raw_product_name=r["prod_name"],
                raw_option_name=r["option"],
                raw_qty=r["qty"],
                gross_amount=0,
                net_amount=0,
                refund_amount=r["weight"] / _VAT,
                is_cancelled=True,
                raw_row=raw_row,
            )
            continue

        net = alloc.get(i, 0.0)
        # ingest는 net이 0이면 gross로 대체하므로(net or gross), 안분액 0인 행은 gross도 0.
        gross = r["line_amt"] / _VAT if net else 0.0
        yield ParsedLine(
            sale_date=r["sale_dt"].date(),
            sale_datetime=r["sale_dt"],
            order_no=r["order_no"],
            line_no=r["line_no"],
            raw_product_name=r["prod_name"],
            raw_option_name=r["option"],
            raw_qty=r["qty"],
            gross_amount=gross,
            net_amount=net,
            unit_per_set=units_per_set(r["code"], r["prod_name"], r["option"]),
            raw_row=raw_row,
        )
