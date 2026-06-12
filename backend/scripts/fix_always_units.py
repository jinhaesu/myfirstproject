# -*- coding: utf-8 -*-
"""올웨이즈 낱개수량(입수) 정정 — 옵션 단위 매핑.

신양식(주문건별정산내역) 기준: 낱개 = J열 수량(주문수량) × 매핑 입수.
입수는 옵션 텍스트 우선, 없으면 상품명에서 추출. (검수 반영 2026-06-12)

사용:  python scripts/fix_always_units.py [--apply]
이후 /reprocess 로 재처리.
"""
import os
import re
import sys

import pandas as pd
import yaml
from sqlalchemy import create_engine, text

OW = "2e1586ad-223c-4ff3-b56a-09d844ae07c6"
XLSX = r"C:\Users\lion9\Downloads\올웨이즈_신양식.xlsx"


def extract_ups(txt: str) -> int | None:
    """텍스트에서 1주문당 낱개(입수) 추출. 우선순위 중요. 실패 시 None."""
    n = (txt or "").replace(" ", "")
    if not n:
        return None
    # 1) 괄호 총계 '(8구)' '(6개)' '(총12개)'
    m = re.search(r"\((?:총)?(\d+)(?:구|개|봉|병|입)\)", n)
    if m:
        return int(m.group(1))
    # 2) 명시적 총합 '총 N개/봉/병/구'
    m = re.search(r"총(\d+)(?:개|봉|병|구)", n)
    if m:
        return int(m.group(1))
    # 3) 합산 'N개입+N개입', 'N개+N개', 'N구+N구', 'N+N개', 'N+N구'
    for pat in (r"(\d+)개입\+(\d+)개입", r"(\d+)개\+(\d+)개", r"(\d+)구\+(\d+)구",
                r"(\d+)\+(\d+)개", r"(\d+)\+(\d+)구"):
        m = re.search(pat, n)
        if m:
            return int(m.group(1)) + int(m.group(2))
    # 3.5) '+' 혼합 옵션 — 단위 토큰 전부 합산
    #      '피스타치오4구+초코4구'(중간 텍스트), '플레인1개+흑임자1개+크랜베리1개+바질1개'
    if "+" in n:
        toks = re.findall(r"(\d+)(?:개입|구|개(?!당)|봉|병)", n)
        if len(toks) >= 2:
            return sum(int(t) for t in toks)
        m = re.search(r"(\d+)\+(\d+)(?!\d)", n)  # '3+3 (각 2개씩)' 류
        if m:
            return int(m.group(1)) + int(m.group(2))
    # 4) 'N구 M세트', 'N봉 M세트', 'N개 M세트', 'N종 M세트' (곱)
    m = re.search(r"(\d+)(?:구|봉|개|종)(\d+)세트", n)
    if m:
        return int(m.group(1)) * int(m.group(2))
    # 5) 'N개입'
    m = re.search(r"(\d+)개입", n)
    if m:
        return int(m.group(1))
    # 6) 'N구'
    m = re.search(r"(\d+)구", n)
    if m:
        return int(m.group(1))
    # 7) 'N봉' / 'N병'
    m = re.search(r"(\d+)봉", n) or re.search(r"(\d+)병", n)
    if m:
        return int(m.group(1))
    # 8) 단독 'N개' (개입/개당 제외)
    m = re.search(r"(\d+)개(?!입|당)", n)
    if m:
        return int(m.group(1))
    # 9) 'N종' (크림샌드 휘낭시에 8종 세트 등, 별도 개수 표기 없을 때만)
    m = re.search(r"(\d+)종", n)
    if m:
        return int(m.group(1))
    return None


def classify_pid(txt: str, pm: dict) -> int | None:
    """키워드 → 표준 품목 id. 옵션 텍스트 우선 호출."""
    n = txt or ""
    has_mac = ("뚱카롱" in n) or ("마카롱" in n)
    has_nang = ("뚱낭시에" in n) or ("휘낭시에" in n)
    if "르뱅" in n:
        return pm.get("르뱅쿠키")
    if "아메리칸" in n or "아메쿠키" in n:
        return pm.get("아메쿠키")
    if has_mac and not has_nang:
        return pm.get("마카롱")
    if has_nang and not has_mac:
        return pm.get("뚱낭시에")
    if "바게트" in n:
        return pm.get("네모바게트")
    if "슬랩" in n:
        return pm.get("슬랩")
    if "포카치아" in n or "포카지아" in n:
        return pm.get("포카치아")
    if "스콘" in n:
        return pm.get("스콘")
    if "베이글" in n:
        return pm.get("베이글")
    if "식빵" in n:
        return pm.get("식빵")
    if "쫀득빵" in n:
        return pm.get("쫀득빵")
    if "쫀득쿠키" in n:
        return pm.get("상온 쫀득쿠키")
    if "파운드" in n:
        return pm.get("파운드")
    if "크림빵" in n:
        return pm.get("크림빵")
    if "마들렌" in n:
        return pm.get("마들렌")
    if "브라우니" in n:
        return pm.get("브라우니")
    if "크루와상" in n or "크로와상" in n:
        return pm.get("크루와상")
    if "슈톨렌" in n:
        return pm.get("슈톨렌")
    if "드링크" in n:
        return pm.get("에너지드링크")
    if "라이트번" in n or "모닝빵" in n:
        return pm.get("라이트번")
    if "수제쿠키" in n or "수제 쿠키" in n:
        return pm.get("르뱅쿠키")
    return None


def main():
    apply = "--apply" in sys.argv
    d = yaml.safe_load(open(os.path.expandvars(r"$TEMP/cloudrun-env.yaml"), encoding="utf-8"))
    eng = create_engine(d["DATABASE_URL"])

    df = pd.read_excel(XLSX, header=0)
    combos = (
        df.groupby(["상품명", "옵션"], dropna=False)
        .agg(qty=("수량", "sum"), net=("상품 구매액", "sum"))
        .reset_index()
    )

    with eng.connect() as c:
        pm = {n: i for i, n in c.execute(text("SELECT id,name FROM csa_product_master")).fetchall()}
    pmname = {i: n for n, i in pm.items()}

    rows = []  # (raw_product, raw_option, pid, ups)
    for _, r in combos.iterrows():
        prod = str(r["상품명"]).strip()
        opt = None if pd.isna(r["옵션"]) else (str(r["옵션"]).strip() or None)
        pid = classify_pid(opt or "", pm) or classify_pid(prod, pm)
        ups = extract_ups(opt or "") or extract_ups(prod) or 1
        flag = "" if pid else " *품목미상→수동확인"
        rows.append((prod, opt, pid, ups))
        print(f"ups={ups:3d} [{pmname.get(pid, '?미상?')}] q={int(r['qty']):4d} net={int(r['net']):>9,}{flag}")
        print(f"      {prod[:46]} || {(opt or '-')[:46]}")

    unknown = [r for r in rows if not r[2]]
    print(f"\n총 {len(rows)} 조합 / 품목미상 {len(unknown)}")
    if not apply:
        print("[DRY-RUN] --apply 로 적용.")
        return
    if unknown:
        print("[중단] 품목미상 조합이 있어 적용하지 않음.")
        return

    with eng.begin() as c:
        for prod, opt, pid, ups in rows:
            ex = c.execute(text("""SELECT id FROM csa_channel_product_mapping
                WHERE channel_id=:c AND raw_product_name=:rp
                AND raw_option_name IS NOT DISTINCT FROM :ro"""),
                {"c": OW, "rp": prod, "ro": opt}).fetchone()
            if ex:
                c.execute(text("""UPDATE csa_channel_product_mapping
                    SET product_id=:p, unit_per_set=:u, confidence='manual', updated_at=now() WHERE id=:i"""),
                    {"p": pid, "u": ups, "i": ex[0]})
            else:
                c.execute(text("""INSERT INTO csa_channel_product_mapping
                    (channel_id,channel_name,raw_product_name,raw_option_name,product_id,unit_per_set,confidence,notes,created_at,updated_at)
                    VALUES (:c,'올웨이즈',:rp,:ro,:p,:u,'manual','입수 정정(2026-06-12)',now(),now())"""),
                    {"c": OW, "rp": prod, "ro": opt, "p": pid, "u": ups})
    print(f"[APPLIED] {len(rows)}건. /reprocess 필요.")


if __name__ == "__main__":
    main()
