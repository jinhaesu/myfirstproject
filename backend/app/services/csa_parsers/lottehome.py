"""롯데홈쇼핑 파서.

파일 형태별 처리:
  1. AES-128 암호화 .xlsx (OLE2 컨테이너)
     → 환경변수 LOTTE_EXCEL_PASSWORD 또는 빈 문자열로 복호화 시도.
     → msoffcrypto 미설치 or 비밀번호 불일치 시 ValueError 발생 (사용자에게 안내).
  2. 일반 .xlsx → openpyxl
  3. 일반 .xls → xlrd
  4. HTML 위장 .xls → read_html (StringIO 방식)

컬럼 우선순위:
  날짜 : 주문일시 > 결제일시 > 주문일자 > 매출일자 > 정산일
  상품명: 상품명 > 판매상품명
  수량  : 수량 > 주문수량
  gross : 결제금액 > 판매가 > 매출금액   ← 총액 컬럼 우선 (단가 사용 금지)
  net   : 정산금액 > 결제금액
"""
from __future__ import annotations
import io
import os
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_date, to_datetime, to_float, to_str


def _is_encrypted_ole2(path: str) -> bool:
    """OLE2 + EncryptedPackage 구조인지 확인."""
    try:
        import olefile
        ole = olefile.OleFileIO(path)
        has_enc = ole.exists("EncryptedPackage")
        ole.close()
        return has_enc
    except Exception:
        return False


def _decrypt(path: str) -> Optional[io.BytesIO]:
    """msoffcrypto로 복호화. 성공 시 BytesIO 반환, 실패 시 None."""
    try:
        import msoffcrypto  # type: ignore
    except ImportError:
        return None

    # 환경변수 우선, 없으면 빈 문자열(비밀번호 없음)
    passwords = []
    env_pw = os.environ.get("LOTTE_EXCEL_PASSWORD", "")
    if env_pw:
        passwords.append(env_pw)
    passwords.append("")  # 비밀번호 없는 경우

    for pw in passwords:
        try:
            with open(path, "rb") as f:
                of = msoffcrypto.OfficeFile(f)
                of.load_key(password=pw)
                buf = io.BytesIO()
                of.decrypt(buf)
                buf.seek(0)
                return buf
        except Exception:
            continue
    return None


def _read(path: str) -> pd.DataFrame:
    """롯데홈쇼핑 파일을 형태별로 안전하게 읽는다."""
    # 1) 암호화 OLE2 → msoffcrypto 복호화 시도
    if _is_encrypted_ole2(path):
        buf = _decrypt(path)
        if buf is None:
            raise ValueError(
                "롯데홈쇼핑 엑셀이 암호화되어 있습니다. "
                "환경변수 LOTTE_EXCEL_PASSWORD에 비밀번호를 설정하거나, "
                "암호가 제거된 파일을 업로드해주세요."
            )
        try:
            return pd.read_excel(buf, engine="openpyxl")
        except Exception as e:
            raise ValueError(f"복호화 후 엑셀 읽기 실패: {e}") from e

    # 2) 일반 xlsx
    if path.lower().endswith(".xlsx"):
        try:
            return pd.read_excel(path, engine="openpyxl")
        except Exception:
            pass

    # 3) 일반 xls (xlrd)
    try:
        return pd.read_excel(path, engine="xlrd")
    except Exception:
        pass

    # 4) HTML 위장 xls
    for enc in ("utf-8", "utf-8-sig", "cp949", "euc-kr"):
        try:
            with open(path, "r", encoding=enc) as f:
                content = f.read()
            tables = pd.read_html(io.StringIO(content), header=0)
            if tables:
                return tables[0]
        except Exception:
            continue

    return pd.DataFrame()


# 상품명(E열) → 낱개 입수. 롯데홈쇼핑은 옵션이 '맛 선택' 위주라 상품명 기준 매핑.
# (폼 2026-07-28 김재경/MD: 세트 미환산 158→1,174. 특정 substring 우선순위로 매칭)
_LOTTE_NAME_MAP = [
    ("통밀식빵 3종 4개입 2+1set", 12), ("통밀식빵 3종 택1", 3),
    ("쫀득 베이글 16개입", 16), ("베이글 7종 12개입", 12), ("베이글 7종 7개입", 7),
    ("배꼽 베이글 4개", 4), ("포카치아 8개", 8),
    ("6봉+6봉", 12), ("식이섬유 4봉", 4), ("식이섬유 5봉", 5),
    ("르뱅 쿠키 6종 12개입", 12), ("르뱅 쿠키 6종 1BOX", 6),
    ("아메리칸 쿠키 6봉 2박스", 12),
    ("휘낭시에 8개입 2박스", 16), ("휘낭시에 8개입 1박스", 8),
    ("8구 1BOX+뚱낭시에", 16), ("쫀득 마카롱 선물패키지", 8), ("벚꽃마카롱", 8),
    ("두바이 쫀득 뚱카롱 8구 1박스", 8), ("듀오에디션", 16),
    ("슬랩 600g 1+1개", 2), ("슬랩 600g 1개", 1),
]


def _lotte_units(prod: str):
    p = prod or ""
    for key, u in _LOTTE_NAME_MAP:
        if key in p:
            return u
    return None  # 미매핑


def _parse_integrated_admin(df: pd.DataFrame) -> Iterable[ParsedLine]:
    """인터넷-TV 통합 어드민 신양식 (2026-07 기준변경요청서, 김재경).

    컬럼: 순번/주문번호/상품코드/단품/상품명/단품상세/과세/수량/판매금액/매입금액/매입수수료
    - 과세='합계'인 소계 행 제외(포함 시 매출 2배)
    - 날짜 컬럼 없음 → 주문번호 앞 8자리(YYYYMMDD)가 주문일
    - 순매출 = 판매금액(i열) ÷1.1(VAT). 낱개 = 상품명 매핑 입수 × 수량.
    - 완전 반품쌍(동일 주문번호+상품코드에 +금액/−금액 공존) → 매출·낱개·행수에서 제외.
    """
    from collections import defaultdict
    rows = []
    for _idx, (_, row) in enumerate(df.iterrows()):
        tax = to_str(row.get("과세")) or ""
        if "합계" in tax:
            continue
        order_no = to_str(row.get("주문번호")) or ""
        digits = order_no[:8]
        sale_d = to_date(digits) if len(digits) == 8 and digits.isdigit() else None
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        code = to_str(row.get("상품코드")) or ""
        rows.append((_idx, sale_d, order_no, code, prod,
                     to_str(row.get("단품상세")), to_str(row.get("단품")),
                     to_float(row.get("수량") or 1), to_float(row.get("판매금액") or 0)))

    amts = defaultdict(list)
    for r in rows:
        amts[(r[2], r[3])].append(r[8])
    refund_keys = {k for k, a in amts.items() if any(x > 0 for x in a) and any(x < 0 for x in a)}

    for _idx, sale_d, order_no, code, prod, danpum_detail, danpum, qty, gross in rows:
        if (order_no, code) in refund_keys:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            line_no=f"{code}|{danpum}-{_idx}",
            raw_product_name=prod,
            raw_option_name=danpum_detail,
            raw_qty=qty,
            unit_per_set=_lotte_units(prod) or 1,   # 상품명 기준 낱개 입수(세트환산)
            gross_amount=gross,
            net_amount=gross,
        )


@register("롯데홈쇼핑")
@register("롯데 홈쇼핑")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read(path)  # 암호화 파일이면 ValueError 발생 → 상위 레이어가 처리
    if df.empty:
        return

    # 통합 어드민 신양식 감지: 판매금액+과세+주문번호 있고 날짜 컬럼 없음
    cols = {str(c).strip() for c in df.columns}
    if {"판매금액", "과세", "주문번호"} <= cols and not (
        {"주문일시", "결제일시", "주문일자", "매출일자"} & cols
    ):
        yield from _parse_integrated_admin(df)
        return

    for _idx, (_, row) in enumerate(df.iterrows()):
        # 날짜
        sale_dt = to_datetime(row.get("주문일시") or row.get("결제일시"))
        sale_d = sale_dt.date() if sale_dt else (
            to_date(row.get("주문일자"))
            or to_date(row.get("매출일자"))
            or to_date(row.get("정산일"))
        )
        if not sale_d:
            continue

        prod = to_str(row.get("상품명") or row.get("판매상품명"))
        if not prod:
            continue

        # 수량: 주문수량(W) 우선
        qty = to_float(row.get("주문수량") or row.get("수량") or 1)

        # 매출 = 판매단가(V) × 주문수량(W). (총액 컬럼이 없는 양식이라 단가×수량으로 산출)
        unit = to_float(row.get("판매단가") or row.get("판매가") or row.get("단가") or 0)
        if unit > 0:
            gross = unit * qty
        else:
            # 구버전 양식 fallback: 총액 컬럼
            gross = to_float(
                row.get("결제금액") or row.get("매출금액")
                or row.get("주문금액") or row.get("판매금액") or 0
            )
        net = gross

        # 취소/반품 행 — is_cancelled로 표시(매출 제외, 건수·금액 보존)
        # E열 [주문진행상태]가 표준 양식 (검수 반영 2026-06-12)
        status = to_str(
            row.get("주문진행상태") or row.get("주문상태") or row.get("진행상태")
            or row.get("주문상태명") or row.get("상태") or row.get("클레임상태") or ""
        ) or ""
        is_cancel = any(k in status for k in ("취소", "반품"))
        # 취소수량(X)·반품수량(Y)이 전량이면 취소건으로 간주
        c_qty = to_float(row.get("취소수량") or 0) + to_float(row.get("반품수량") or 0)
        if c_qty and qty and c_qty >= qty:
            is_cancel = True

        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            # 같은 주문에 동일 상품·금액 행 중복 시 dedup 탈락 방지 — 행 시퀀스 부여
            line_no=f"{to_str(row.get('상품코드')) or ''}-{_idx}",
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션") or row.get("단품명")),
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
        )
