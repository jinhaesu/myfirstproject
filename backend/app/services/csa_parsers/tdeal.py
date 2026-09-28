"""T deal 파서 — 신규 채널(기준변경요청서 #63 2026-09-23, 임현정 / 2026-09-28 반영).

원본: T deal(SKT 딜커머스) 파트너 어드민 '주문통합 주문번호별 리스트' xlsx(57열).
열은 **헤더명**으로 읽는다 — 폼의 'AF=수량'은 오기(AF=추가할인적용가, 수량은 AG).
  쇼핑몰구분(B) / 주문번호(G) / 주문상태(N) / 클레임상태(O) / 상품명(W) /
  옵션명:옵션값(AA) / 주문상품옵션번호(AB) / 수량(AG) / 상품합계(AH) / 주문일시(AU)
  · 쇼핑몰구분 컬럼이 있으면 'T deal' 행만(주문통합 양식에 타 쇼핑몰이 섞일 수 있음).
  · 주문자·수령자 이름/연락처/주소 열은 읽지 않는다(개인정보 미적재).

순매출: 상품합계(AH) — 소비자가(VAT 포함) 라인 총액(=추가할인적용가×수량).
  파서는 원천 금액 그대로 내보내고, 적재 시 ÷1.1(VAT_INCLUDED_CHANNELS 'T deal').
행수(주문건수): 주문번호 고유값. line_no = 주문상품옵션번호(샘플 669행 전부 고유).
취소: 주문상태 '취소완료' 또는 주문상태/클레임상태가 '취소완료'·'반품완료'로 시작
  → is_cancelled, refund = 상품합계. 취소 행은 분해하지 않는다(취소건수 = 행수 보존).

낱개(입수) — 폼에 산식이 없어 감사 제안 규칙 적용(담당자 확정 전 추정):
  ① 옵션명을 '|'로 파트 분할, 파트별 계산 후 합산.
  ② 파트의 '옵션선택:'/'구성:'/'선택N:'/'옵션:' 접두, '01.' 항목번호, 무게·용량(500g·15ml) 제거.
  ③ '총 N구/개' → N.
  ④ 괄호 밖 N(구|개|개입|봉) 합. 괄호 밖에 없을 때만 괄호 안 합
     ('두쫀뚱 8구 (초코 4구+피스타치오 4구)' → 8, '사랑(8구)+감동(8구)' → 16).
  ⑤ × 'M세트/박스/box'.
  ⑥ 휘낭시에·뚱낭시에 박스에 개수 표기가 없으면 8(스마트스토어 관행, '뚱낭시에 1박스' → 8).
  ⑦ 옵션에서 못 찾으면 상품명(증정 구문 앞)의 'N개입×M박스'('르뱅쿠키(6개입×2박스)' → 12).
     그것도 없으면 상품명의 '품목N' 구성('마카롱2＋휘낭시에2＋쿠키2/1박스' → 품목별 2씩, 합 6).
  ⑧ 개수 없는 부속 파트('+발사믹 오일 15ml') 0.  ⑨ 증정품 파트(…증정) 0.

품목 분해(오매핑 방지): 룰베이스 '가장 긴 일치'는 상품명 '베이글/바게트/포카치아 모음전'을
  통째로 포카치아에, '사랑+휘낭시에' 옵션을 뚱낭시에에, '르뱅쿠키+아메리칸 쿠키'를
  아메쿠키에 몰아준다(감사 2026-09-28). → 낱개>0 파트가 2개 이상이면 파트별 ParsedLine으로
  분해하고 product_hint로 품목을 확정한다. 단일 파트 행도 같은 힌트 규칙.
  · '|' 파트 안의 괄호 밖 '+' 구성은 품목이 서로 다를 때만 다시 나눈다
    ('사랑(8구)+휘낭시에(8구)' → 마카롱 8 / 뚱낭시에 8, '황치즈(4구)+초코홀릭(4구)' → 마카롱 8).
  · 매출 = 파트 낱개 비율 안분(원 단위 반올림, 잔여는 마지막 라인). line_no = f'{옵션번호}-{i}'.
  · 첫 분해 라인만 order_no 유지 — 일자×품목 DISTINCT 합산 시 주문건수 부풀림 방지.
  · 힌트 순서: 파트 품목어(유일할 때) → 상품명 대표 품목어(유일할 때) → 마카롱 맛 이름 → None.
    raw_product_name = 파트 텍스트(상품명 전체는 넣지 않음 — '포카치아' 선점 방지),
    raw_option_name = None(다른 파트의 품목어가 룰베이스에 섞이지 않게). 원문은 raw_row에.
    예외: 힌트 미확정 + 상품명에 품목어가 전혀 없으면(선점 위험 없음) (상품명, 파트 텍스트)로
    남긴다 — '기본' 같은 범용 옵션이 상품 간 한 미매핑 키로 섞이지 않게.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_datetime, to_float, to_str,
)

_WEIGHT = re.compile(r"\d+(?:\.\d+)?\s*(?:kg|g|ml|l)(?![a-zA-Z가-힣0-9])", re.I)
_PREFIX = re.compile(r"^\s*(?:옵션선택|구성|선택\s*\d*|옵션\s*\d*)\s*:\s*")
_ITEMNO = re.compile(r"^\s*\d{1,2}\s*\.(?!\d)\s*")
_TOTAL = re.compile(r"총\s*(\d+)\s*(?:개입|구|개|봉)")
_CNT = re.compile(r"(\d+)\s*(?:개입|구|개|봉)")
_SET = re.compile(r"(\d+)\s*(?:세트|셋트|박스|box|set)", re.I)
_PAREN = re.compile(r"\([^)]*\)")
# 상품명 'N개입×M박스'
_PACK = re.compile(r"(\d+)\s*(?:개입|구|개|봉)\s*[×xX*]\s*(\d+)\s*(?:박스|box|세트|set)", re.I)
# 상품명 '품목N' 구성('마카롱2＋ 휘낭시에2＋쿠키2/1박스') — 뒤에 단위가 붙은 숫자는 제외
_ITEM_N = re.compile(
    r"([가-힣A-Za-z]+)\s*(\d+)"
    r"(?!\s*(?:\d|[,.]|개입|구|개|봉|세트|셋트|박스|box|set|종|kg|g|ml|%))", re.I,
)
# 상품명 증정 구문('＋통밀식빵 1봉 랜덤 증정(…)', '(베이글 1개 증정)')·한정수량 표기·[브랜드]
_GIFT_TAIL = re.compile(r"\s*[＋+][^＋+]*증정.*$")
_GIFT_PAREN = re.compile(r"\([^)]*증정[^)]*\)")
_LIMIT = re.compile(r"\([^)]*한정[^)]*\)")
_BRAND = re.compile(r"^\s*\[[^\]]*\]\s*")
_FIN = ("휘낭시에", "뚱낭시에")

# 품목어 → 표준 품목명(ProductMaster.name — GET /api/csa/products 2026-09-28 확인)
_HINT_KW: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("마카롱", ("마카롱", "뚱카롱", "두쫀뚱")),
    ("뚱낭시에", ("휘낭시에", "뚱낭시에", "피낭시에")),
    ("르뱅쿠키", ("르뱅", "크럼블쿠키")),
    ("아메쿠키", ("아메리칸", "아메쿠키")),
    ("두바이 쫀득쿠키", ("두바이쫀득쿠키", "두바이쿠키")),
    ("상온 쫀득쿠키", ("쫀득쿠키",)),
    ("베이글", ("베이글",)),
    ("네모바게트", ("바게트",)),
    ("포카치아", ("포카치아",)),
    ("슬랩", ("슬랩",)),
    ("깜빠뉴", ("깜빠뉴", "캄파뉴")),
    ("식빵", ("식빵",)),
    ("스콘", ("스콘",)),
    ("치아바타", ("치아바타",)),
    ("크루와상", ("크루와상", "크로와상")),
    ("브라우니", ("브라우니",)),
    ("마들렌", ("마들렌",)),
    ("사워도우", ("사워도우",)),
    ("라이트번", ("라이트번",)),
    ("크림빵", ("크림빵",)),
    ("쫀득빵", ("쫀득빵",)),
    ("슈톨렌", ("슈톨렌",)),
)
# 쿠키 계열 표준 품목 — 종류 미상 '쿠키' 파트는 쿠키 상품의 대표어로만 확정(_hint)
_COOKIE = {"르뱅쿠키", "아메쿠키", "두바이 쫀득쿠키", "상온 쫀득쿠키"}
# 마카롱 맛 이름 — 품목어 없는 파트('사랑(8구)', '초코홀릭(4구)')의 보조 판정
_MACARON_FLAVOR = ("사랑", "감동", "황치즈", "초코홀릭", "솔티드", "블루베리", "피스타치오", "체리블라썸")

_MALL_OK = {"tdeal", "t-deal", "t딜", "티딜"}


def _norm(v) -> str:
    return re.sub(r"\s+", "", str(v))


def _id(v) -> Optional[str]:
    """주문번호·옵션번호 — 숫자 셀이 float로 읽혀도 '123.0' 꼬리 제거."""
    s = to_str(v)
    if s and re.fullmatch(r"\d+\.0", s):
        s = s[:-2]
    return s


def _cnt_sum(t: str) -> int:
    return sum(int(c) for c in _CNT.findall(t) if 1 <= int(c) <= 200)


def _base_cnt(s: str, fin_default: bool = True) -> int:
    """④⑥ 괄호 밖 개수 합 → 없으면 괄호 안 합 → 휘낭시에 무수량 8 (s: 무게 제거본)."""
    n = _cnt_sum(_PAREN.sub(" ", s))
    if n == 0:
        n = sum(_cnt_sum(x) for x in _PAREN.findall(s))
    if n == 0 and fin_default and any(k in s for k in _FIN):
        n = 8
    return n


def _set_mult(s: str) -> int:
    """⑤ 괄호 밖 'M세트/박스/box' 배수(없으면 1)."""
    m = _SET.search(_PAREN.sub(" ", s))
    return int(m.group(1)) if m and 1 <= int(m.group(1)) <= 20 else 1


def _split_plus(s: str) -> list[str]:
    """괄호 밖 '+'/'＋'로만 분리 — '황치즈매니아(4구+4구)'의 괄호 안 '+'는 유지."""
    out: list[str] = []
    buf: list[str] = []
    depth = 0
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch in "+＋" and depth == 0:
            out.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    out.append("".join(buf))
    return [x.strip() for x in out if x.strip()]


def _kw_products(text: str) -> set[str]:
    """텍스트에 등장한 표준 품목 집합. 더 긴 품목어에 포함된 짧은 품목어는 무시
    ('두바이쫀득쿠키' ⊃ '쫀득쿠키')."""
    t = _norm(text or "").lower()
    spans: list[tuple[int, int, str]] = []
    for name, kws in _HINT_KW:
        for kw in kws:
            for m in re.finditer(re.escape(kw), t):
                spans.append((m.start(), m.end(), name))
    return {
        n for s, e, n in spans
        if not any(s2 <= s and e <= e2 and (e2 - s2) > (e - s) and n2 != n
                   for s2, e2, n2 in spans)
    }


def _has_item_word(text: str) -> bool:
    return bool(_kw_products(text)) or any(f in text for f in _MACARON_FLAVOR)


def _hint(text: str, prod_hint: Optional[str]) -> Optional[str]:
    """파트 품목어(유일) → 상품명 대표 품목어 → 마카롱 맛 이름 → None."""
    ps = _kw_products(text)
    if len(ps) == 1:
        return next(iter(ps))
    if ps:
        return None  # 한 파트에 품목어 2개 이상(더 못 나눔) — 추정하지 않고 미확정
    if "쿠키" in _norm(text or ""):
        # 종류 미상 '쿠키'(초코칩 쿠키 등) — 쿠키 상품의 대표어만 허용. 마카롱 모음전
        # (외 26종, 쿠키 옵션 포함)의 쿠키 옵션이 마카롱으로 강제 확정되지 않게(리뷰 2026-09-28)
        return prod_hint if prod_hint in _COOKIE else None
    if prod_hint:
        return prod_hint
    if any(f in text for f in _MACARON_FLAVOR):
        return "마카롱"
    return None


def _clean(part: str) -> str:
    """② 접두('옵션선택:' 등)·항목번호('01.') 제거. 무게는 표시용으로 남긴다."""
    p = (part or "").replace("（", "(").replace("）", ")")
    p = _PREFIX.sub("", p)
    p = _ITEMNO.sub("", p)
    return p.strip()


def _prod_text(prod: Optional[str]) -> str:
    """상품명에서 증정 구문·한정수량·[브랜드] 제거 — 대표 품목어·⑦ 폴백용."""
    t = (prod or "").replace("（", "(").replace("）", ")")
    t = _GIFT_TAIL.sub("", t)
    t = _GIFT_PAREN.sub(" ", t)
    t = _LIMIT.sub(" ", t)
    t = _BRAND.sub("", t)
    return t.strip()


def _part_comps(part: str, prod_hint: Optional[str]) -> list[tuple[str, float, Optional[str]]]:
    """옵션 '|' 파트 하나 → [(표시 텍스트, 세트당 낱개, 품목 힌트)]."""
    p = _clean(part)
    if not p or "증정" in p:
        return []  # ⑨ 증정품 파트는 낱개·매출 0
    s = _WEIGHT.sub(" ", p)
    m = _TOTAL.search(s)
    if m and 1 <= int(m.group(1)) <= 500:
        return [(p, float(m.group(1)), _hint(p, prod_hint))]  # ③
    mult = _set_mult(s)
    subs = _split_plus(p)
    if len(subs) >= 2:
        sc = [(x, _base_cnt(_WEIGHT.sub(" ", x)), _hint(x, prod_hint)) for x in subs]
        valid = [c for c in sc if c[1] > 0]
        # 개수 없는 구성은 부속(발사믹 오일 등)일 때만 버림 — 품목어가 있으면 분리 포기
        stray = [c for c in sc if c[1] == 0 and _has_item_word(c[0])]
        if valid and not stray and len({c[2] for c in valid}) > 1:
            return [(x, float(n * mult), h) for x, n, h in valid]
    return [(p, float(_base_cnt(s) * mult), _hint(p, prod_hint))]


def _prod_fallback(pt: str, opt_txt: str, opt_mult: int,
                   prod_hint: Optional[str]) -> list[tuple[str, float, Optional[str]]]:
    """⑦ 옵션에서 낱개를 못 찾은 행 — 상품명(증정 구문 제거본)에서."""
    s = _WEIGHT.sub(" ", pt)
    m = _TOTAL.search(s)
    if m and 1 <= int(m.group(1)) <= 500:
        return [(opt_txt, float(m.group(1)), _hint(opt_txt, prod_hint))]
    m = _PACK.search(s)
    if m and 1 <= int(m.group(1)) <= 200 and 1 <= int(m.group(2)) <= 20:
        return [(opt_txt, float(int(m.group(1)) * int(m.group(2))), _hint(opt_txt, prod_hint))]
    # 상품명에 배수 표기가 없으면 옵션의 박스 수를 곱함
    mult = _set_mult(s) if _SET.search(_PAREN.sub(" ", s)) else opt_mult
    n = _base_cnt(s, fin_default=False)
    if n:
        return [(opt_txt, float(n * mult), _hint(opt_txt, prod_hint))]
    # '품목N' 구성(황치즈 에디션 '마카롱2＋ 휘낭시에2＋쿠키2/1박스') — 품목별 분해.
    # 휘낭시에 무수량 8(⑥)보다 먼저 봐야 '휘낭시에2'가 8로 잡히지 않음
    comps: list[tuple[str, float, Optional[str]]] = []
    for word, k in _ITEM_N.findall(s):
        if not (_kw_products(word) or word.endswith("쿠키")) or not (1 <= int(k) <= 50):
            continue
        comps.append((f"{opt_txt} [{word} {k}]", float(int(k) * opt_mult), _hint(f"{word} {k}", None)))
    if comps:
        return comps
    if any(k in s for k in _FIN):
        return [(opt_txt, float(8 * mult), _hint(opt_txt, prod_hint))]  # ⑥ 상품명 휘낭시에 무수량
    return []


def _raw_names(txt: str, hint: Optional[str], pt: str,
               keep_prod: bool) -> tuple[str, Optional[str]]:
    """(raw_product_name, raw_option_name). 기본은 파트 텍스트만 — 상품명의 '포카치아' 등
    룰베이스 선점 방지. 힌트 미확정 + 상품명에 품목어가 전혀 없으면(keep_prod, 선점 위험 없음)
    (상품명, 파트)로 남겨 '기본' 같은 범용 옵션이 상품 간 한 매핑 키로 섞이지 않게 한다."""
    if hint is None and keep_prod:
        return pt, txt
    return txt, None


def _alloc(amount: float, weights: list[float]) -> list[float]:
    """금액을 낱개 비율로 안분 — 원 단위 반올림, 잔여는 마지막 라인(합계 보존)."""
    tot = sum(weights)
    out: list[float] = []
    acc = 0.0
    for i, w in enumerate(weights):
        if i == len(weights) - 1:
            out.append(amount - acc)
        else:
            a = float(round(amount * w / tot))
            out.append(a)
            acc += a
    return out


def _read(path: str) -> pd.DataFrame:
    """헤더명 기준 읽기(열 문자 금지). 상단 제목행이 있으면 '주문번호' 헤더 행을 찾아 재지정."""
    df = read_excel_safe(path, header=0, dtype=str)
    if not {"주문번호", "상품합계"} <= {_norm(c) for c in df.columns}:
        for i in range(min(len(df), 15)):
            vals = [_norm(v) for v in df.iloc[i].tolist()]
            if "주문번호" in vals and "상품합계" in vals:
                df.columns = df.iloc[i].tolist()
                df = df.iloc[i + 1:].reset_index(drop=True)
                break
    df.columns = [_norm(c) for c in df.columns]
    return df


@register("T deal")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read(path)
    has_mall = "쇼핑몰구분" in df.columns
    seen_fallback: dict[str, int] = {}
    for _, row in df.iterrows():
        # 주문통합 양식 — T deal 행만 (폼 #63)
        if has_mall and _norm(to_str(row.get("쇼핑몰구분")) or "").lower() not in _MALL_OK:
            continue
        sale_dt = to_datetime(row.get("주문일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        opt = to_str(row.get("옵션명:옵션값")) or to_str(row.get("옵션명")) or to_str(row.get("옵션"))
        if opt in ("-",):
            opt = None
        if not prod and not opt:
            continue
        order_no = _id(row.get("주문번호"))
        qty = to_float(row.get("수량")) or 1.0
        # 매출 = 상품합계(AH, 수량 반영 총액·VAT 포함). 열이 비면 추가할인적용가×수량 폴백
        amt_raw = row.get("상품합계")
        if to_str(amt_raw) is None:
            unit = to_float(row.get("추가할인적용가")) or to_float(row.get("판매가(할인적용가)"))
            gross = unit * qty
        else:
            gross = to_float(amt_raw)

        # line_no = 주문상품옵션번호(행 고유). 없으면 주문번호·옵션번호 + 파일 내 등장 순번(결정적)
        base = _id(row.get("주문상품옵션번호"))
        if not base:
            key = f"{order_no or ''}:{_id(row.get('상품옵션번호')) or _id(row.get('상품번호')) or ''}"
            seen_fallback[key] = seen_fallback.get(key, 0) + 1
            base = f"{key}:{seen_fallback[key]}"

        # 취소: 주문상태 '취소완료' / 주문상태·클레임상태 '취소완료'·'반품완료'로 시작 (폼 #63)
        st = to_str(row.get("주문상태")) or ""
        cl = to_str(row.get("클레임상태")) or ""
        is_cancel = any(x.startswith(("취소완료", "반품완료")) for x in (st, cl))

        pt = _prod_text(prod)
        _ph = _kw_products(pt)
        prod_hint = next(iter(_ph)) if len(_ph) == 1 else None

        # 낱개·품목 구성 (규칙 ①~⑨). 옵션이 없으면 상품명 규칙(⑦)만
        if opt:
            comps = [c for part in opt.split("|") for c in _part_comps(part, prod_hint)]
            comps = [c for c in comps if c[1] > 0]
            opt_txt = " | ".join(x for x in (_clean(p) for p in opt.split("|")) if x) or pt
            if not comps:
                comps = _prod_fallback(pt, opt_txt, _set_mult(_WEIGHT.sub(" ", opt)), prod_hint)
        else:
            opt_txt = pt
            comps = _prod_fallback(pt, pt, 1, prod_hint)
        comps = [c for c in comps if c[1] > 0]
        ups_total = sum(c[1] for c in comps)

        if is_cancel:
            # 취소 행은 1라인(품목 미귀속·취소건수=행수). 상품명/옵션 원문 보존
            yield ParsedLine(
                sale_date=sale_dt.date(),
                sale_datetime=sale_dt,
                order_no=order_no,
                line_no=base,
                raw_product_name=prod,
                raw_option_name=opt,
                raw_qty=qty,
                gross_amount=0,
                net_amount=0,
                refund_amount=gross,
                is_cancelled=True,
                unit_per_set=ups_total or None,
            )
            continue

        raw_row = {"상품명": prod, "옵션명": opt}  # 원문 추적용(개인정보 열 제외)
        if len(comps) <= 1:
            # 낱개 미상(comps 없음)이면 입수 None → 매핑 입수 사용
            txt, ups, hint = comps[0] if comps else (opt_txt, 0.0, _hint(opt_txt, prod_hint))
            rp, ro = _raw_names(txt, hint, pt, bool(opt) and not _ph)
            yield ParsedLine(
                sale_date=sale_dt.date(),
                sale_datetime=sale_dt,
                order_no=order_no,
                line_no=base,
                raw_product_name=rp,
                raw_option_name=ro,
                raw_qty=qty,
                gross_amount=gross,
                net_amount=gross,
                refund_amount=0,
                is_cancelled=False,
                unit_per_set=ups or None,
                raw_row=raw_row,
                product_hint=hint,
            )
            continue

        # 파트별 분해 — 매출은 낱개 비율 안분, 첫 라인만 주문번호(주문건수 부풀림 방지)
        amts = _alloc(gross, [c[1] for c in comps])
        for i, ((txt, ups, hint), amt) in enumerate(zip(comps, amts), start=1):
            rp, ro = _raw_names(txt, hint, pt, bool(opt) and not _ph)
            yield ParsedLine(
                sale_date=sale_dt.date(),
                sale_datetime=sale_dt,
                order_no=order_no if i == 1 else None,
                line_no=f"{base}-{i}",
                raw_product_name=rp,
                raw_option_name=ro,
                raw_qty=qty,
                gross_amount=amt,
                net_amount=amt,
                refund_amount=0,
                is_cancelled=False,
                unit_per_set=ups,
                raw_row=raw_row,
                product_hint=hint,
            )
