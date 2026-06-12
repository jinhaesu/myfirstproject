# -*- coding: utf-8 -*-
"""범용 낱개수량(입수) 정정 — (상품, 옵션) 조합 단위 매핑.

DB raw_lines의 distinct (raw_product_name, raw_option_name)에서 입수를
추출(옵션 우선, 없으면 상품명)해 csa_channel_product_mapping을 upsert.
김재경 검수(2026-06-12): 카페24/토스/크림/테무/삼성카드/농협/베네피아.

사용:  python scripts/fix_channel_units.py <채널명> [--apply]
이후 /reprocess 로 재처리.
"""
import os
import re
import sys

import yaml
from sqlalchemy import create_engine, text


def extract_ups(txt: str) -> int | None:
    """텍스트에서 1주문당 낱개(입수) 추출. 우선순위 중요. 실패 시 None."""
    n = (txt or "").replace(" ", "")
    if not n:
        return None
    # 0) 'NEA x Mbox' / 'Nea×Mbox'
    m = re.search(r"(\d+)(?:ea|EA|Ea)[x×\*](\d+)(?:box|BOX|박스)", n)
    if m:
        return int(m.group(1)) * int(m.group(2))
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
    # 3.5) '+'/'||' 혼합 옵션 — 단위 토큰 전부 합산
    if "+" in n or "||" in n:
        toks = re.findall(r"(\d+)(?:개입|구|개(?!당)|봉|병)", n)
        if len(toks) >= 2:
            return sum(int(t) for t in toks)
        m = re.search(r"(\d+)\+(\d+)(?!\d)", n)
        if m:
            return int(m.group(1)) + int(m.group(2))
    # 4) 'N구 M세트', 'N봉 M세트', 'N개 M세트', 'N종 M세트', 'N개입 M box' (곱)
    m = re.search(r"(\d+)(?:구|봉|개|종)(\d+)세트", n)
    if m:
        return int(m.group(1)) * int(m.group(2))
    m = re.search(r"(\d+)개입(\d+)(?:BOX|box|Box|박스)", n)
    if m:
        return int(m.group(1)) * int(m.group(2))
    # 5) 'N개입' / 'N구' / 'N봉' / 'N병' / 'N팩'
    for pat in (r"(\d+)개입", r"(\d+)구", r"(\d+)봉", r"(\d+)병", r"(\d+)팩"):
        m = re.search(pat, n)
        if m:
            return int(m.group(1))
    # 6) 단독 'N개' (개입/개당 제외)
    m = re.search(r"(\d+)개(?!입|당)", n)
    if m:
        return int(m.group(1))
    # 7) 'N종'
    m = re.search(r"(\d+)종", n)
    if m:
        return int(m.group(1))
    # 8) 'NEA'
    m = re.search(r"(\d+)(?:ea|EA|Ea)", n)
    if m:
        return int(m.group(1))
    return None


def main():
    if len(sys.argv) < 2:
        print("사용: python scripts/fix_channel_units.py <채널명> [--apply]")
        return
    ch_name = sys.argv[1]
    apply = "--apply" in sys.argv
    d = yaml.safe_load(open(os.path.expandvars(r"$TEMP/cloudrun-env.yaml"), encoding="utf-8"))
    eng = create_engine(d["DATABASE_URL"])

    with eng.connect() as c:
        ch = c.execute(text("SELECT id FROM channels WHERE name=:n"), {"n": ch_name}).fetchone()
        if not ch:
            print("채널 없음:", ch_name)
            return
        cid = ch[0]
        pmname = {i: n for i, n in c.execute(text("SELECT id,name FROM csa_product_master")).fetchall()}
        combos = c.execute(text("""SELECT TRIM(raw_product_name), TRIM(COALESCE(raw_option_name,'')),
                MIN(product_id), SUM(raw_qty), SUM(net_amount)
            FROM csa_sales_raw_lines WHERE channel_id=:c
            GROUP BY 1,2 ORDER BY 5 DESC"""), {"c": cid}).fetchall()

    rows = []
    for rp, ro, cur_pid, q, net in combos:
        ro = ro or None
        ups = extract_ups(ro or "") or extract_ups(rp) or 1
        rows.append((rp, ro, cur_pid, ups))
        print(f"ups={ups:3d} [{pmname.get(cur_pid, '미매칭')}] q={int(q or 0):5d} net={int(net or 0):>10,}")
        print(f"      {rp[:48]} || {(ro or '-')[:48]}")

    print(f"\n{ch_name}: 총 {len(rows)} 조합")
    if not apply:
        print("[DRY-RUN] --apply 로 적용.")
        return

    with eng.begin() as c:
        for rp, ro, cur_pid, ups in rows:
            ex = c.execute(text("""SELECT id FROM csa_channel_product_mapping
                WHERE channel_id=:c AND raw_product_name=:rp
                AND raw_option_name IS NOT DISTINCT FROM :ro"""),
                {"c": cid, "rp": rp, "ro": ro}).fetchone()
            if ex:
                c.execute(text("""UPDATE csa_channel_product_mapping
                    SET unit_per_set=:u, confidence='manual', updated_at=now() WHERE id=:i"""),
                    {"u": ups, "i": ex[0]})
            elif cur_pid:
                c.execute(text("""INSERT INTO csa_channel_product_mapping
                    (channel_id,channel_name,raw_product_name,raw_option_name,product_id,unit_per_set,confidence,notes,created_at,updated_at)
                    VALUES (:c,:ch,:rp,:ro,:p,:u,'manual','입수 정정(2026-06-12)',now(),now())"""),
                    {"c": cid, "ch": ch_name, "rp": rp, "ro": ro, "p": cur_pid, "u": ups})
            else:
                print("  [건너뜀-미매칭]", rp[:40], ro)
    print(f"[APPLIED] {ch_name} {len(rows)}건. /reprocess 필요.")


if __name__ == "__main__":
    main()
