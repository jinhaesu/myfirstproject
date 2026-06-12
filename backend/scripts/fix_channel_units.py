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
    # 4) 'N구 M세트', 'N봉 M세트', 'N개 M세트', 'N종 M세트', 'N종 M개씩' (곱)
    m = re.search(r"(\d+)(?:구|봉|개|종)(\d+)세트", n)
    if m:
        return int(m.group(1)) * int(m.group(2))
    m = re.search(r"(\d+)종(\d+)개씩", n)
    if m:
        return int(m.group(1)) * int(m.group(2))
    # 4.5) 'N개입/N구 M박스' (곱) — '체리블라썸 4구 2박스' = 8
    m = re.search(r"(\d+)(?:개입|구)(\d+)(?:BOX|box|Box|박스)", n)
    if m:
        return int(m.group(1)) * int(m.group(2))
    # 3.5) 복수 단위 토큰 합산 — '+', '/', ',' 나열 모두 ('4EA/4EA', '3봉,3봉,3봉')
    #      단, 최대 토큰 = 나머지 합이면 총량+내역 병기로 보고 최대값 채택
    #      (예: '8구 1박스(초코 4구+피스타치오 4구)' → 8)
    toks = [int(t) for t in re.findall(r"(\d+)(?:개입|구|개(?!당)|봉|병|캔|ea|EA|Ea)", n)]
    if len(toks) >= 2:
        mx = max(toks)
        rest = sum(toks) - mx
        if len(toks) >= 3 and mx == rest:
            return mx
        return sum(toks)
    m = re.search(r"(\d+)\+(\d+)(?!\d)", n)
    if m:
        return int(m.group(1)) + int(m.group(2))
    # 5) 'N개입' / 'N구' / 'N봉' / 'N병' / 'N팩' / 'N캔'
    for pat in (r"(\d+)개입", r"(\d+)구", r"(\d+)봉", r"(\d+)병", r"(\d+)팩", r"(\d+)캔"):
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


def classify_pid(txt: str, pm: dict) -> int | None:
    """키워드 → 표준 품목 id (미매칭 조합 보정용)."""
    n = (txt or "").replace(" ", "")
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
    if "두바이" in n and "쫀득쿠키" in n:
        return pm.get("두바이 쫀득쿠키")
    if "쫀득빵" in n:
        return pm.get("쫀득빵")
    if "쫀득쿠키" in n:
        return pm.get("상온 쫀득쿠키")
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
    if "파운드" in n:
        return pm.get("파운드")
    if "크림빵" in n:
        return pm.get("크림빵")
    if "드링크" in n:
        return pm.get("에너지드링크")
    if "라이트번" in n or "모닝빵" in n:
        return pm.get("라이트번")
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

    pm = {n: i for i, n in pmname.items()}
    rows = []
    for rp, ro, cur_pid, q, net in combos:
        ro = ro or None
        ups = extract_ups(ro or "") or extract_ups(rp) or 1
        pid = cur_pid or classify_pid(f"{rp} {ro or ''}", pm)
        flag = " *품목보정" if (pid and not cur_pid) else ("" if pid else " *미상")
        rows.append((rp, ro, pid, ups))
        print(f"ups={ups:3d} [{pmname.get(pid, '미상')}] q={int(q or 0):5d} net={int(net or 0):>10,}{flag}")
        print(f"      {rp[:48]} || {(ro or '-')[:48]}")

    print(f"\n{ch_name}: 총 {len(rows)} 조합")
    if not apply:
        print("[DRY-RUN] --apply 로 적용.")
        return

    with eng.begin() as c:
        for rp, ro, pid, ups in rows:
            if not pid:
                print("  [건너뜀-미상]", rp[:40], ro)
                continue
            ex = c.execute(text("""SELECT id FROM csa_channel_product_mapping
                WHERE channel_id=:c AND raw_product_name=:rp
                AND raw_option_name IS NOT DISTINCT FROM :ro"""),
                {"c": cid, "rp": rp, "ro": ro}).fetchone()
            if ex:
                c.execute(text("""UPDATE csa_channel_product_mapping
                    SET product_id=:p, unit_per_set=:u, confidence='manual', updated_at=now() WHERE id=:i"""),
                    {"p": pid, "u": ups, "i": ex[0]})
            else:
                c.execute(text("""INSERT INTO csa_channel_product_mapping
                    (channel_id,channel_name,raw_product_name,raw_option_name,product_id,unit_per_set,confidence,notes,created_at,updated_at)
                    VALUES (:c,:ch,:rp,:ro,:p,:u,'manual','입수 정정(2026-06-12)',now(),now())"""),
                    {"c": cid, "ch": ch_name, "rp": rp, "ro": ro, "p": pid, "u": ups})
    print(f"[APPLIED] {ch_name} {len(rows)}건. /reprocess 필요.")


if __name__ == "__main__":
    main()
