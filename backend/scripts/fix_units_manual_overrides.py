# -*- coding: utf-8 -*-
"""자동 추출이 불가능한 조합 수동 보정 (김재경 검수 2026-06-12).

- 토스: '1box'처럼 옵션에 입수 정보가 없는 박스 단위 상품
- 테무/농협: 'N박스' 옵션(제품 기본입수 × 박스수)
- 다중 세트(카페24 등): 컴포넌트 분할 매핑
- 카페24 적립금: 집계 제외
"""
import os
import sys

import yaml
from sqlalchemy import create_engine, text

APPLY = "--apply" in sys.argv

# (채널명, 상품 LIKE, 옵션 LIKE 또는 None=전체, 품목명 또는 None=유지, ups)
SINGLE = [
    # 토스 — 사랑/감동 박스(8구/box), 옵션에 box 수만 표기
    ("토스", "%대왕 마카롱 넌 사랑이야%", "1box%", "마카롱", 8),
    ("토스", "%대왕 마카롱 넌 사랑이야%", "2box%", "마카롱", 16),
    ("토스", "%뚱뚱한 마카롱 넌 감동이야 1box%", "1box%", "마카롱", 8),
    ("토스", "%뚱뚱한 마카롱 넌 감동이야 1box%", "2box%", "마카롱", 16),
    ("토스", "%마카롱 넌 사랑이야 2box%", "2박스%", "마카롱", 16),
    ("토스", "%마카롱 넌 감동이야 2box%", "2박스%", "마카롱", 16),
    # 토스 — 아메리칸쿠키 1box=6개입, 옵션 N개 = N박스
    ("토스", "%꾸덕 아메리칸쿠키 1box%", "1개%", "아메쿠키", 6),
    ("토스", "%꾸덕 아메리칸쿠키 1box%", "2개%", "아메쿠키", 12),
    ("토스", "%꾸덕 아메리칸쿠키 1박스%", "2box%", "아메쿠키", 12),
    # 테무 — 'N박스' 옵션 (제품 1박스=6개)
    ("테무", "%아메리칸 쿠키 6개 1박스%", "2박스%", "아메쿠키", 12),
    ("테무", "%르뱅 쿠키 6개 1/2박스%", "2박스%", "르뱅쿠키", 12),
    # 농협 — 식빵 2+1 (옵션 괄호가 8봉으로 오인)
    ("농협몰", "%통밀식빵 4봉*3SET%", None, "식빵", 12),
    # 베네피아 — 식빵 2+1
    ("베네피아", "%통밀식빵 4봉*3SET%", None, "식빵", 12),
    # 카페24 — 펄스랩 콜라보(콩단백 너겟은 자사 품목 아님 → 주력 품목 기준)
    ("카페24", "%널담X삼양 펄스랩%", "%바게트 10봉%", "네모바게트", 10),
    ("카페24", "%널담X삼양 펄스랩%", "%베이글 12봉%", "베이글", 12),
    ("카페24", "%널담X삼양 펄스랩%", "%슬랩 2개+후무스%", "슬랩", 2),
]

# (채널명, 상품 LIKE, 옵션 LIKE 또는 None, [(품목명, ups), ...])
MULTI = [
    ("카페24", "뚱카롱 8구 1박스 + 뚱낭시에 8개입 1박스%", None, [("마카롱", 8), ("뚱낭시에", 8)]),
    ("카페24", "[건강 패키지] 속세의 포카치아 6봉 + 영양가득 식빵 3봉%", None, [("포카치아", 6), ("식빵", 3)]),
    ("카페24", "[선착순 특가] 고단백 저당 베이글 2봉 + 바게트 2봉%", None, [("베이글", 2), ("네모바게트", 2)]),
    ("카페24", "[맛보기 세트] 고단백 저당 베이글 1봉 + 바게트 1봉%", None, [("베이글", 1), ("네모바게트", 1), ("슬랩", 1)]),
    ("카페24", "[두바이 세트] 두바이 쫀득 뚱카롱 8구 1박스+%", None, [("마카롱", 8), ("두바이 쫀득쿠키", 4)]),
    ("카페24", "%스타터팩 for 저당팩%", None, [("마카롱", 8), ("뚱낭시에", 8), ("르뱅쿠키", 6)]),
    ("카페24", "%널담X삼양 펄스랩%", "%싹-3 담기%", [("베이글", 7), ("네모바게트", 5), ("포카치아", 2), ("슬랩", 1)]),
    ("카페24", "[첫구매혜택]%통밀스콘 3개입%", "%스콘3+르뱅쿠키2%", [("스콘", 3), ("르뱅쿠키", 2), ("라이트번", 1)]),
    ("카페24", "[첫구매혜택]%통밀스콘 3개입%", "%스콘3+아메리칸쿠키2%", [("스콘", 3), ("아메쿠키", 2), ("라이트번", 1)]),
    ("베네피아", "%뚱카롱 마카롱 8구 2BOX(총 16구)+수제%", None, [("마카롱", 16), ("뚱낭시에", 8)]),
    ("농협몰", "%뚱카롱 마카롱 8구 2BOX(총 16구)+수제%", None, [("마카롱", 16), ("뚱낭시에", 8)]),
]

# 집계 제외 (상품 아님)
EXCLUDE = [
    ("카페24", "널담 적립금%", None),
]


def main():
    d = yaml.safe_load(open(os.path.expandvars(r"$TEMP/cloudrun-env.yaml"), encoding="utf-8"))
    eng = create_engine(d["DATABASE_URL"])
    with eng.connect() as c:
        chs = dict(c.execute(text("SELECT name, id FROM channels")).fetchall())
        pm = {n: i for i, n in c.execute(text("SELECT id,name FROM csa_product_master")).fetchall()}

    def find_combos(c, cid, rp_like, ro_like):
        q = """SELECT DISTINCT TRIM(raw_product_name), TRIM(COALESCE(raw_option_name,''))
            FROM csa_sales_raw_lines WHERE channel_id=:c AND raw_product_name LIKE :rp"""
        params = {"c": cid, "rp": rp_like}
        if ro_like:
            q += " AND raw_option_name LIKE :ro"
            params["ro"] = ro_like
        return [(rp, ro or None) for rp, ro in c.execute(text(q), params).fetchall()]

    with eng.begin() as c:
        for ch, rp_like, ro_like, pname, ups in SINGLE:
            cid = chs[ch]
            pid = pm[pname] if pname else None
            for rp, ro in find_combos(c, cid, rp_like, ro_like):
                print(f"[단일] {ch} | {rp[:36]} || {(ro or '-')[:30]} -> {pname} x{ups}")
                if not APPLY:
                    continue
                ex = c.execute(text("""SELECT id FROM csa_channel_product_mapping
                    WHERE channel_id=:c AND raw_product_name=:rp AND raw_option_name IS NOT DISTINCT FROM :ro"""),
                    {"c": cid, "rp": rp, "ro": ro}).fetchone()
                if ex:
                    c.execute(text("""UPDATE csa_channel_product_mapping SET product_id=:p, unit_per_set=:u,
                        confidence='manual', updated_at=now() WHERE id=:i"""), {"p": pid, "u": ups, "i": ex[0]})
                else:
                    c.execute(text("""INSERT INTO csa_channel_product_mapping
                        (channel_id,channel_name,raw_product_name,raw_option_name,product_id,unit_per_set,confidence,notes,created_at,updated_at)
                        VALUES (:c,:ch,:rp,:ro,:p,:u,'manual','수동 보정(2026-06-12)',now(),now())"""),
                        {"c": cid, "ch": ch, "rp": rp, "ro": ro, "p": pid, "u": ups})

        for ch, rp_like, ro_like, parts in MULTI:
            cid = chs[ch]
            # 다중 매핑은 상품 단위(raw_option=None) 키로 등록 — multi_cache가
            # (rn, ro) 미스 시 (rn, None)으로 폴백하므로 모든 옵션에 적용됨.
            # 단, 옵션별로 구성이 다른 상품(펄스랩)은 옵션 키로 등록.
            combos = find_combos(c, cid, rp_like, ro_like)
            if not combos:
                print(f"[다중-없음] {ch} | {rp_like}")
                continue
            if ro_like:
                keys = combos  # 옵션 단위
            else:
                keys = sorted({(rp, None) for rp, _ in combos})  # 상품 단위
            for rp, ro in keys:
                ptxt = " + ".join(f"{n}({u})" for n, u in parts)
                print(f"[다중] {ch} | {rp[:36]} || {(ro or '*')[:24]} -> {ptxt}")
                if not APPLY:
                    continue
                c.execute(text("""DELETE FROM csa_channel_mapping_component
                    WHERE channel_id=:c AND raw_product_name=:rp AND raw_option_name IS NOT DISTINCT FROM :ro"""),
                    {"c": cid, "rp": rp, "ro": ro})
                for i, (pname, ups) in enumerate(parts):
                    c.execute(text("""INSERT INTO csa_channel_mapping_component
                        (channel_id,channel_name,raw_product_name,raw_option_name,product_id,unit_per_set,sort_order,created_at,updated_at)
                        VALUES (:c,:ch,:rp,:ro,:p,:u,:so,now(),now())"""),
                        {"c": cid, "ch": ch, "rp": rp, "ro": ro, "p": pm[pname], "u": ups, "so": i})

        for ch, rp_like, ro_like in EXCLUDE:
            cid = chs[ch]
            for rp, ro in find_combos(c, cid, rp_like, ro_like):
                print(f"[제외] {ch} | {rp[:40]}")
                if not APPLY:
                    continue
                ex = c.execute(text("""SELECT id FROM csa_channel_product_mapping
                    WHERE channel_id=:c AND raw_product_name=:rp AND raw_option_name IS NOT DISTINCT FROM :ro"""),
                    {"c": cid, "rp": rp, "ro": ro}).fetchone()
                if ex:
                    c.execute(text("UPDATE csa_channel_product_mapping SET is_excluded=true, product_id=NULL, updated_at=now() WHERE id=:i"), {"i": ex[0]})
                else:
                    c.execute(text("""INSERT INTO csa_channel_product_mapping
                        (channel_id,channel_name,raw_product_name,raw_option_name,product_id,unit_per_set,is_excluded,confidence,notes,created_at,updated_at)
                        VALUES (:c,:ch,:rp,:ro,NULL,1,true,'manual','적립금 등 비상품 제외',now(),now())"""),
                        {"c": cid, "ch": ch, "rp": rp, "ro": ro})

    print("\n" + ("[APPLIED]" if APPLY else "[DRY-RUN] --apply 로 적용."))


if __name__ == "__main__":
    main()
