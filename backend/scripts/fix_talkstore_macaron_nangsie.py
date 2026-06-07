"""톡스토어 마카롱↔뚱낭시에 매출 비중 뒤바뀜 정정.

원인: '널담 달콤한 디저트 마카롱/휘낭시에/르뱅쿠키...' 등 종합 리스팅이 통째로
뚱낭시에로 룰매핑됐으나, 실제 옵션은 대부분 뚱카롱(=마카롱)·르뱅쿠키·아메쿠키.
→ 옵션 단위로 정확한 표준 품목 + 입수(낱개)를 명시 매핑한다. 혼합 옵션은 다중 매핑.

사용:
  python scripts/fix_talkstore_macaron_nangsie.py           # DRY-RUN (분석만)
  python scripts/fix_talkstore_macaron_nangsie.py --apply    # 매핑/다중매핑 행 삽입
이후 채널 재처리(/reprocess?channel_id=...)로 raw_line 재구성.
"""
import os
import sys
import yaml
from sqlalchemy import create_engine, text

CID = "1fb4e720-feb0-4149-bd81-ee828d9562dc"  # 카카오톡스토어
L1 = "널담 달콤한 디저트 마카롱/휘낭시에/르뱅쿠키 쫀득달큰 인기 디저트 구성"
L2 = "[공동구매]널담 달콤한 마카롱/휘낭시에/르뱅쿠키/아메쿠키 인기 디저트 구성"

# 품목 id: 마카롱1 뚱낭시에2 르뱅쿠키6 아메쿠키9 두바이쫀득17 브라우니20
MAC, NANG, LEV, AME, JJON, BROW = 1, 2, 6, 9, 17, 20
EXCLUDE = "EXCLUDE"

# (raw_product, raw_option) -> 정정.  단일=[(pid, ups)], 혼합=2개 이상, 제외=EXCLUDE
CORRECTIONS: dict = {
    # ── 리스팅1 (283M, 전량 뚱낭시에 오매핑) ──
    (L1, "A. 세트 선택: 뚱카롱 16구 (사랑세트+감동세트)"): [(MAC, 16)],
    (L1, "A. 세트 선택: 뚱낭시에 8구 2세트 (총16구)"): [(NANG, 16)],
    (L1, "디저트 선택: 뚱카롱 16구 (사랑세트+감동세트)"): [(MAC, 16)],
    (L1, "A. 세트 선택: 고단백 르뱅쿠키 6개 2박스+쇼핑백1매"): [(LEV, 12)],
    (L1, "A. 세트 선택: 뚱낭시에 8구 1세트+쇼핑백 1매"): [(NANG, 8)],
    (L1, "A. 세트 선택: 두바이뚱카롱 초코4구+피스타치오4구+쇼핑백1매"): [(MAC, 8)],
    (L1, "A. 세트 선택: 뚱카롱 사랑이야 8구+쇼핑백 1매"): [(MAC, 8)],
    (L1, "A. 세트 선택: 아메리칸쿠키 6개 2박스+쇼핑백1매"): [(AME, 12)],
    (L1, "A. 세트 선택: 뚱카롱 감동이야 8구+쇼핑백 1매"): [(MAC, 8)],
    (L1, "디저트 선택: 뚱낭시에 8구 2세트 (총16구)"): [(NANG, 16)],
    (L1, "A. 세트 선택: 널담 브라우니 3개입 1세트"): [(BROW, 3)],
    (L1, "A. 세트 선택: 널담 브라우니 5개입 1세트"): [(BROW, 5)],
    (L1, "디저트 선택: 두바이뚱카롱 8구(다크초코+피스타치오)"): [(MAC, 8)],
    (L1, "디저트 선택: 뚱카롱 사랑이야 8구"): [(MAC, 8)],
    (L1, "디저트 선택: 고단백 르뱅쿠키 6개 2박스+쇼핑백1매"): [(LEV, 12)],
    (L1, "디저트 선택: 고단백 르뱅쿠키 6개 2박스"): [(LEV, 12)],
    (L1, "디저트 선택: 뚱낭시에 8구 1세트"): [(NANG, 8)],
    (L1, "디저트 선택: 아메리칸쿠키 6개 2박스"): [(AME, 12)],
    (L1, "디저트 선택: 뚱카롱 사랑이야 8구+쇼핑백 1매"): [(MAC, 8)],
    (L1, "디저트 선택: 아메리칸쿠키 6개 2박스+쇼핑백1매"): [(AME, 12)],
    (L1, "디저트 선택: 뚱낭시에 8구 1세트+쇼핑백 1매"): [(NANG, 8)],
    (L1, "디저트 선택: 봄카롱 체리블라썸 4구 2세트"): [(MAC, 8)],
    (L1, "디저트 선택: 저당 두바이 쫀득 쿠키 4개"): [(JJON, 4)],
    (L1, "디저트 선택: 뚱카롱 감동이야 8구"): [(MAC, 8)],
    (L1, "디저트 선택: 뚱카롱 감동이야 8구+쇼핑백 1매"): [(MAC, 8)],
    (L1, "디저트 선택: 봄카롱 피스타치오 4구 2세트"): [(MAC, 8)],
    (L1, "디저트 선택: 널담 브라우니 3개입 1세트"): [(BROW, 3)],
    (L1, "A. 세트 선택: 선물용 쇼핑백 6매"): EXCLUDE,
    (L1, "디저트 선택: 선물용 쇼핑백 6매"): EXCLUDE,
    (L1, "A. 세트 선택: 선물용 쇼핑백 10매"): EXCLUDE,
    # ── 리스팅2 (공동구매, 혼합세트 → 다중 매핑) ──
    (L2, "A. 세트 선택: [BEST] 뚱카롱16+뚱낭시에8+쿠키12"): [(MAC, 16), (NANG, 8), (LEV, 12)],
    (L2, "A. 세트 선택: [쿠키세트] 르뱅쿠키18+아메리칸쿠키6"): [(LEV, 18), (AME, 6)],
    (L2, "A. 세트 선택: [디저트세트] 뚱카롱16+뚱낭16"): [(MAC, 16), (NANG, 16)],
    (L2, "A. 세트 선택: 뚱카롱16+뚱낭시에8+르뱅쿠키6"): [(MAC, 16), (NANG, 8), (LEV, 6)],
    (L2, "A. 세트 선택: 뚱카롱16+뚱낭시에8+아메리칸쿠키6"): [(MAC, 16), (NANG, 8), (AME, 6)],
}

PNAME = {MAC: "마카롱", NANG: "뚱낭시에", LEV: "르뱅쿠키", AME: "아메쿠키",
         JJON: "두바이쫀득", BROW: "브라우니"}


def main():
    apply = "--apply" in sys.argv
    d = yaml.safe_load(open(os.path.expandvars(r"$TEMP/cloudrun-env.yaml"), encoding="utf-8"))
    eng = create_engine(d["DATABASE_URL"])

    delta: dict = {}  # pid -> [net, pcs]
    excl_net = 0.0
    multi_rows = []
    single_rows = []

    with eng.connect() as c:
        for (rp, ro), corr in CORRECTIONS.items():
            agg = c.execute(text("""
                SELECT COALESCE(SUM(net_amount),0), COALESCE(SUM(raw_qty),0),
                       COALESCE(MIN(product_id),0)
                FROM csa_sales_raw_lines
                WHERE channel_id=:cid AND raw_product_name=:rp AND raw_option_name=:ro
                  AND mapping_status='matched'
            """), {"cid": CID, "rp": rp, "ro": ro}).fetchone()
            net, rqty, cur_pid = float(agg[0]), float(agg[1]), agg[2]
            if corr == EXCLUDE:
                excl_net += net
                print(f"  [제외] net={int(net):>11,}  | {ro}")
                continue
            # 단일/혼합 모두 net을 입수 비율로 안분(다중매핑 안분식과 동일)
            tot_ups = sum(u for _, u in corr) or 1
            parts = []
            for pid, ups in corr:
                p_net = net * ups / tot_ups
                p_pcs = rqty * ups
                delta.setdefault(pid, [0.0, 0.0])
                delta[pid][0] += p_net
                delta[pid][1] += p_pcs
                parts.append(f"{PNAME[pid]}({ups})={int(p_net):,}")
            tag = "다중" if len(corr) > 1 else "단일"
            print(f"  [{tag}] net={int(net):>11,} cur={cur_pid} -> {' + '.join(parts)}  | {ro[:34]}")
            if len(corr) > 1:
                multi_rows.append((rp, ro, corr))
            else:
                single_rows.append((rp, ro, corr[0][0], corr[0][1]))

        print("\n=== 정정 후 품목 순증감(이 리스팅들 기준) ===")
        for pid, (n, q) in sorted(delta.items(), key=lambda x: -x[1][0]):
            print(f"  {PNAME[pid]:8s}  +net {int(n):>13,}  +pcs {int(q):>8,}")
        print(f"  (제외 쇼핑백 net {int(excl_net):,})")

        cur1 = c.execute(text("SELECT COALESCE(SUM(net_amount),0),COALESCE(SUM(pcs_qty),0) FROM csa_sales_raw_lines WHERE channel_id=:c AND product_id=1 AND mapping_status='matched'"), {"c": CID}).fetchone()
        cur2 = c.execute(text("SELECT COALESCE(SUM(net_amount),0),COALESCE(SUM(pcs_qty),0) FROM csa_sales_raw_lines WHERE channel_id=:c AND product_id=2 AND mapping_status='matched'"), {"c": CID}).fetchone()
        # 정정: 리스팅 전체가 현재 뚱낭시에(2)에 있으므로, 2에서 빠지고 각 품목으로 재배분.
        moved_from_2 = sum(n for pid, (n, q) in delta.items()) + excl_net
        new1 = float(cur1[0]) + delta.get(1, [0, 0])[0]
        new2 = float(cur2[0]) - moved_from_2 + delta.get(2, [0, 0])[0]
        print("\n=== 마카롱/뚱낭시에 총계 변화(추정) ===")
        print(f"  마카롱   net {int(float(cur1[0])):>13,}  ->  {int(new1):>13,}")
        print(f"  뚱낭시에 net {int(float(cur2[0])):>13,}  ->  {int(new2):>13,}")

    if not apply:
        print("\n[DRY-RUN] --apply 를 붙이면 매핑 행을 삽입합니다 (이후 재처리 필요).")
        return

    CH = "카카오톡스토어"
    ins_single = ins_multi = ins_excl = 0
    with eng.begin() as c:
        def upsert_single(rp, ro, pid, ups, excl=False, note=""):
            ex = c.execute(text("""SELECT id FROM csa_channel_product_mapping
                WHERE channel_id=:cid AND raw_product_name=:rp AND raw_option_name=:ro"""),
                {"cid": CID, "rp": rp, "ro": ro}).fetchone()
            if ex:
                c.execute(text("""UPDATE csa_channel_product_mapping
                    SET product_id=:pid, unit_per_set=:ups, is_excluded=:ex,
                        confidence='manual', notes=:note, updated_at=now()
                    WHERE id=:id"""),
                    {"pid": pid, "ups": ups, "ex": excl, "note": note, "id": ex[0]})
            else:
                c.execute(text("""INSERT INTO csa_channel_product_mapping
                    (channel_id, channel_name, raw_product_name, raw_option_name,
                     product_id, unit_per_set, is_excluded, confidence, notes, created_at, updated_at)
                    VALUES (:cid,:ch,:rp,:ro,:pid,:ups,:ex,'manual',:note,now(),now())"""),
                    {"cid": CID, "ch": CH, "rp": rp, "ro": ro, "pid": pid,
                     "ups": ups, "ex": excl, "note": note})

        for rp, ro, pid, ups in single_rows:
            upsert_single(rp, ro, pid, ups, note="마카롱/뚱낭시에 정정(2026-06-07)")
            ins_single += 1
        for (rp, ro), corr in CORRECTIONS.items():
            if corr != EXCLUDE:
                continue
            upsert_single(rp, ro, None, 1, excl=True, note="쇼핑백 제외(2026-06-07)")
            ins_excl += 1
        for rp, ro, corr in multi_rows:
            c.execute(text("""DELETE FROM csa_channel_mapping_component
                WHERE channel_id=:cid AND raw_product_name=:rp AND raw_option_name=:ro"""),
                {"cid": CID, "rp": rp, "ro": ro})
            for i, (pid, ups) in enumerate(corr):
                c.execute(text("""INSERT INTO csa_channel_mapping_component
                    (channel_id, channel_name, raw_product_name, raw_option_name,
                     product_id, unit_per_set, sort_order, created_at, updated_at)
                    VALUES (:cid,:ch,:rp,:ro,:pid,:ups,:so,now(),now())"""),
                    {"cid": CID, "ch": CH, "rp": rp, "ro": ro, "pid": pid, "ups": ups, "so": i})
            ins_multi += 1
    print(f"\n[APPLIED] 단일 {ins_single}건 + 제외 {ins_excl}건 + 다중 {ins_multi}건 삽입.")
    print("다음: /reprocess?channel_id=" + CID + " 로 재처리하세요.")


if __name__ == "__main__":
    main()
