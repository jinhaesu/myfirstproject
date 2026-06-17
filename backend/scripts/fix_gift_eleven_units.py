"""선물하기·11번가 낱개수량(입수) 정정.

상품명에 입수가 박혀 있음(마카롱 8구/16구, 휘낭시에 8종, 르뱅 총12개, 아메 9개입 등).
현재 입수=1(주문수량)로 잡혀 낱개 과소계상 → 상품 단위 매핑(raw_option=None)에
추출 입수를 등록. 혼합세트(마카롱+뚱낭시에, 베이글+식빵+스콘 등)는 다중 매핑.

사용:  python scripts/fix_gift_eleven_units.py [--apply]
이후 /reprocess 로 재처리.
"""
import os
import re
import sys
import yaml
from sqlalchemy import create_engine, text

GIFT = "dd0b248b-96ae-4578-b55e-e472e20c1ef6"  # 카카오선물하기
EL = "b056bf9e-f9c0-4467-ae83-7e456caf0840"     # 11번가
MAC, NANG, LEV, AME, BAGEL, SCONE, BREAD = 1, 2, 6, 9, None, None, None
# 품목 id (DB 조회로 채움)


def extract_ups(name: str) -> int:
    """상품명에서 1주문당 낱개(입수) 추출. 우선순위 중요."""
    n = (name or "").replace(" ", "")
    # 1) 명시적 총합 '총 N개/봉/병'
    m = re.search(r"총(\d+)(?:개|봉|병)", n)
    if m:
        return int(m.group(1))
    # 2) 합산 'N개입+N개입', 'N개+N개', 'N구+N구', 'N+N개', 'N+N구'
    for pat in (r"(\d+)개입\+(\d+)개입", r"(\d+)개\+(\d+)개", r"(\d+)구\+(\d+)구",
                r"(\d+)\+(\d+)개", r"(\d+)\+(\d+)구"):
        m = re.search(pat, n)
        if m:
            return int(m.group(1)) + int(m.group(2))
    # 3) 'N구 M세트', 'N봉 M세트', 'N개 M세트' (곱)
    m = re.search(r"(\d+)(?:구|봉|개)(\d+)세트", n)
    if m:
        return int(m.group(1)) * int(m.group(2))
    # 4) 'N개입'
    m = re.search(r"(\d+)개입", n)
    if m:
        return int(m.group(1))
    # 5) 'N구'
    m = re.search(r"(\d+)구", n)
    if m:
        return int(m.group(1))
    # 6) 'N봉' / 'N병'
    m = re.search(r"(\d+)봉", n) or re.search(r"(\d+)병", n)
    if m:
        return int(m.group(1))
    # 7) 단독 'N개' (개입/개당 제외) — '4종 8개', '쫀득쿠키 6개'
    m = re.search(r"(\d+)개(?!입|당)", n)
    if m:
        return int(m.group(1))
    # 8) 'N종' (휘낭시에 8종 등, 별도 개수 표기 없을 때만 도달)
    m = re.search(r"(\d+)종", n)
    if m:
        return int(m.group(1))
    return 1


def classify_pid(name: str, pm_name2id: dict) -> int:
    """상품명 키워드 → 표준 품목 id (현재 매핑 검증/보정용)."""
    n = name
    has_mac = ("뚱카롱" in n) or ("마카롱" in n)
    has_nang = ("뚱낭시에" in n) or ("휘낭시에" in n)
    if "르뱅" in n:
        return pm_name2id.get("르뱅쿠키")
    if "아메" in n:
        return pm_name2id.get("아메쿠키")
    if "슈톨렌" in n:
        return pm_name2id.get("슈톨렌")
    if has_mac and not has_nang:
        return pm_name2id.get("마카롱")
    if has_nang and not has_mac:
        return pm_name2id.get("뚱낭시에")
    if "베이글" in n:
        return pm_name2id.get("베이글")
    if "스콘" in n:
        return pm_name2id.get("스콘")
    if "식빵" in n:
        return pm_name2id.get("식빵")
    if "스파클링" in n or "티스파클링" in n:
        return pm_name2id.get("티스파클링")
    return None  # 미상 → 기존 유지


# 혼합세트(상품명) → 컴포넌트 [(품목명, 입수)] : 다중 매핑
MIXED = {
    # 11번가
    "[10분러시] 널담 뚱카롱 4.5cm 마카롱 8구/ 휘낭시에 4cm뚱낭시에 8구/두바이초코":
        [("마카롱", 8), ("뚱낭시에", 8)],
    "[10분러시] 널담 뚱카롱 4.5cm 고식이섬유 마카롱 8구 (사랑이야,감동이야)/뚱낭시에 4cm 휘낭시에 8구":
        [("마카롱", 8), ("뚱낭시에", 8)],
}
# '베이글 식빵 스콘 4개씩' 류는 키워드로 자동 감지(아래)


def main():
    apply = "--apply" in sys.argv
    d = yaml.safe_load(open(os.path.expandvars(r"$TEMP/cloudrun-env.yaml"), encoding="utf-8"))
    eng = create_engine(d["DATABASE_URL"])

    single_rows = []   # (cid, ch_name, raw_product, pid, ups)
    multi_rows = []    # (cid, ch_name, raw_product, [(pid,ups)])

    with eng.connect() as c:
        pm = {n: i for i, n in c.execute(text("SELECT id,name FROM csa_product_master")).fetchall()}
        pmname = {i: n for n, i in pm.items()}
        for cid, chn in [(GIFT, "카카오선물하기"), (EL, "11번가")]:
            rows = c.execute(text("""SELECT raw_product_name, MIN(product_id), SUM(raw_qty), SUM(net_amount)
                FROM csa_sales_raw_lines WHERE channel_id=:c AND mapping_status='matched'
                GROUP BY raw_product_name ORDER BY SUM(net_amount) DESC"""), {"c": cid}).fetchall()
            print(f"\n######## {chn} ({len(rows)} 상품) ########")
            for rp, cur_pid, q, net in rows:
                name = rp or ""
                # 혼합 감지 (키워드 기반)
                comp = None
                has_mac = ("뚱카롱" in name) or ("마카롱" in name)
                has_nang = ("뚱낭시에" in name) or ("휘낭시에" in name)
                has_b = "베이글" in name
                has_s = "식빵" in name
                has_k = "스콘" in name
                if (has_b + has_s + has_k) >= 2:
                    cc = []
                    if has_b: cc.append(("베이글", 4))
                    if has_s: cc.append(("식빵", 4))
                    if has_k: cc.append(("스콘", 4))
                    comp = cc
                elif has_mac and has_nang:
                    # 마카롱+뚱낭시에 혼합세트 — 각 8개입
                    comp = [("마카롱", 8), ("뚱낭시에", 8)]
                if comp:
                    parts = [(pm.get(nm), u) for nm, u in comp if pm.get(nm)]
                    multi_rows.append((cid, chn, name, parts))
                    ptxt = " + ".join(f"{nm}({u})" for nm, u in comp)
                    print(f"  [다중] cur={pmname.get(cur_pid)} -> {ptxt} | net={int(net or 0):,} | {name[:46]}")
                    continue
                ups = extract_ups(name)
                pid = classify_pid(name, pm) or cur_pid
                flag = "" if pid == cur_pid else f" *품목보정 {pmname.get(cur_pid)}->{pmname.get(pid)}"
                single_rows.append((cid, chn, name, pid, ups))
                print(f"  ups={ups:3d} [{pmname.get(pid)}] q={int(q or 0):6d} net={int(net or 0):>11,}{flag} | {name[:42]}")

    if not apply:
        print(f"\n[DRY-RUN] 단일 {len(single_rows)} / 다중 {len(multi_rows)}. --apply 로 적용.")
        return

    with eng.begin() as c:
        for cid, chn, rp, pid, ups in single_rows:
            ex = c.execute(text("""SELECT id FROM csa_channel_product_mapping
                WHERE channel_id=:c AND raw_product_name=:rp AND raw_option_name IS NULL"""),
                {"c": cid, "rp": rp}).fetchone()
            if ex:
                c.execute(text("""UPDATE csa_channel_product_mapping
                    SET product_id=:p, unit_per_set=:u, confidence='manual', updated_at=now() WHERE id=:i"""),
                    {"p": pid, "u": ups, "i": ex[0]})
            else:
                c.execute(text("""INSERT INTO csa_channel_product_mapping
                    (channel_id,channel_name,raw_product_name,raw_option_name,product_id,unit_per_set,confidence,notes,created_at,updated_at)
                    VALUES (:c,:ch,:rp,NULL,:p,:u,'manual','입수 정정(2026-06-08)',now(),now())"""),
                    {"c": cid, "ch": chn, "rp": rp, "p": pid, "u": ups})
        for cid, chn, rp, parts in multi_rows:
            c.execute(text("""DELETE FROM csa_channel_mapping_component
                WHERE channel_id=:c AND raw_product_name=:rp AND raw_option_name IS NULL"""),
                {"c": cid, "rp": rp})
            for i, (pid, ups) in enumerate(parts):
                c.execute(text("""INSERT INTO csa_channel_mapping_component
                    (channel_id,channel_name,raw_product_name,raw_option_name,product_id,unit_per_set,sort_order,created_at,updated_at)
                    VALUES (:c,:ch,:rp,NULL,:p,:u,:so,now(),now())"""),
                    {"c": cid, "ch": chn, "rp": rp, "p": pid, "u": ups, "so": i})
    print(f"\n[APPLIED] 단일 {len(single_rows)}건 + 다중 {len(multi_rows)}건. /reprocess 필요.")


if __name__ == "__main__":
    main()
