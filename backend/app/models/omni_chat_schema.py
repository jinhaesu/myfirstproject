"""전사 통합 AI 비서(OMNI)용 정적 스키마 설명.

매출(CSA) · 구매/원가 · 생산 · 물류 · 재고 도메인을 한 번에 질의할 수 있도록
CSA 스키마에 운영 테이블을 추가한 큐레이션 텍스트다.

⚠️ 보안 정책 (CEO 지정): BOM 정확한 배합비(자재 소요량/비율)는 절대 노출하지 않는다.
그래서 scm_bom_lines / scm_raw_materials / scm_sub_materials 등 배합 구성 테이블은
이 스키마에 **의도적으로 문서화하지 않는다** (모델이 질의하지 못하도록). 실행 계층에도
해당 테이블 참조를 차단하는 블록리스트가 있다 (csa_query_service.BLOCKED_TABLES).

실제 컬럼명은 app/db_models.py 기준. 컬럼 변경 시 이 파일도 함께 갱신할 것.
이 모듈은 순수 문자열 상수만 포함하며 import 시점에 DB 접속을 하지 않는다.
"""

from app.models.csa_chat_schema import CSA_SCHEMA_TEXT

OMNI_EXTRA_SCHEMA_TEXT = """

## ─────────────────────────────────────────────
## 추가 운영 도메인: 구매/원가 · 생산 · 물류 · 재고 (매출은 위 CSA 테이블 사용)
## ─────────────────────────────────────────────

### 10. purchase_record — 구매일보(원부재료 매입 실적). 1행 = 1매입 전표 (★ 구매/원가/매입단가 질문의 기본 테이블)
  - pdate (date): 구매일자. 기간 필터 기준.
  - warehouse (varchar): 창고(F1/F2)
  - vendor_name (varchar): 거래처(공급업체)명
  - mclass (varchar): 구분 — '원재료' 또는 '부재료'
  - staff (varchar): 담당자
  - item_code (varchar): 품목코드
  - item_name (varchar): 품목명[규격]
  - unit (varchar): 매입 단위(kg/ea/box 등). ★ 같은 품목이라도 단위가 다르면 단가 기준이 다르므로 단가 비교는 (item_code, unit)를 함께 묶을 것.
  - qty (float): 매입 수량
  - unit_price (float): 매입 단가(전표 표기)
  - supply_amount (float): 공급가액(VAT 별도). ★ "매입액/구매액"은 기본적으로 supply_amount의 합.
  - vat (float), total_amount (float): 부가세, 합계(VAT 포함)
  - note (varchar): 적요
  * "매입단가 추이"는 (item_code, unit)별 pdate 순 unit_price 변화를 본다.

### 11. inventory_production — 생산 실적(생산일보). 1행 = 1생산작업 (★ 생산량/생산원가/노무비 질문)
  - prod_date (date): 생산일자
  - worker (varchar): 담당자
  - location (varchar): 생산위치(2층/3층)
  - category (varchar): 품목류(마스터 매핑키)
  - product_name (varchar): 품목명(상세)
  - qty (float): 생산량(낱개)
  - hours (float): 소요시간
  - unit_price (float): 개당단가
  - prod_amount (float): 생산액
  - labor_cost (float): 노무비
  - unit_cost (float): 개당원가
  - total_cost (float): 원가총액
  - grade (varchar): 등급(최고/중간)
  - product_id (int, FK → csa_product_master.id, nullable): 매칭된 표준품목
  - warehouse_id (int, nullable)

### 12. inventory_logistics_work — 물류 작업 실적(물류일보). 1행 = 1작업 (★ 물류 작업량/작업비/노무비 질문)
  - work_date (date): 작업일자
  - worker (varchar): 책임자
  - team (varchar): 소속 조(1조/2조/3조)
  - work_type (varchar): 작업 종류(B2B/단상자/택배 등)
  - work_name (varchar): 작업명(상세)
  - qty (float): 작업량
  - hours (float): 작업 투여 총 시간
  - unit_price (float): 작업 단가
  - amount (float): 총 작업액
  - labor_cost (float): 노무비(시급×시간, 야간 1.5배)
  - shift (varchar): 주간/야간

### 13. inventory_stock_ledger — 재고 원장(입출고 이동). 1행 = 1이동 (★ 현재고/입출고 질문)
  - warehouse_id (int, FK → inventory_warehouse.id)
  - product_id (int, FK → csa_product_master.id)
  - movement_date (date): 이동일자
  - movement_type (varchar): 이동유형(production/sale/count/adjust 등)
  - qty_delta (float): 수량 증감(+입고/생산, −출고/판매). ★ 현재고 = SUM(qty_delta) GROUP BY product_id(, warehouse_id).
  - ref_type (varchar), ref_id (varchar): 근거(count_session/upload_batch 등)
  - reason (text)

### 14. inventory_warehouse — 창고 마스터
  - id (int, PK), name (varchar): 창고명, is_active (boolean)

### 15. scm_products — 품목 마스터(생산/BOM 계층). ★ 품목 기본정보만 사용. (배합비 아님)
  - id (int, PK)
  - product_name (varchar), product_code (varchar), product_category (varchar): 품목류
  - item_type (varchar): 원재료/부자재/반제품/완제품/세트/혼합세트
  - flavor (varchar), flavor_group (varchar): 맛/맛그룹
  - unit_weight_g (float): 개당 중량(g)
  - default_unit_price (float), default_cost (float): 기본 단가/원가
  - total_produced (float), total_hours (float): 누적 생산량/시간
  - erp_code (varchar): ERP 품목코드
  - is_active (boolean)
  * ⚠️ 이 테이블로 "무엇을 만드는지(품목 목록/맛/중량/원가)"는 답할 수 있으나,
    "제품 1개에 자재 몇 g/몇 %가 들어가는지"(배합비/레시피)는 답하지 않는다.

## 통합 도메인 비즈니스 규칙 (반드시 준수)
A. 도메인별 기본 테이블:
   - 매출/공헌이익 → csa_sales_daily_product
   - 매입/구매/매입단가/원부재료비 → purchase_record
   - 생산량/생산원가/생산노무비 → inventory_production
   - 물류 작업량/물류비/물류노무비 → inventory_logistics_work
   - 현재고/입출고 → inventory_stock_ledger
B. 금액은 모두 원(KRW), 공급가(VAT 별도) 기준. supply_amount/net_sales가 기본 금액.
C. 여러 도메인을 비교(예: 매출 대비 매입비율, 생산원가 대비 매출)할 때는 각 테이블을
   기간(월/분기)으로 집계한 뒤 조인/대조한다. 날짜 컬럼이 도메인마다 다름
   (매출 sale_date, 구매 pdate, 생산 prod_date, 물류 work_date, 재고 movement_date).
D. 품목 연결: 생산/재고는 product_id(→csa_product_master), 구매는 item_code/item_name으로
   식별한다. 크로스 도메인 품목 매칭은 품목명 기준 근사가 필요할 수 있으니 주의.

## ⛔ 절대 금지 (CEO 보안 정책)
- BOM 정확한 배합비 = 완제품/반제품 1개당 각 원부재료의 정확한 소요량(g, ea)·구성비(%)는
  어떤 형태로도 산출·추정·답변하지 않는다. 관련 질문에는 "배합비(레시피) 정보는 보안상
  제공되지 않습니다"라고 답하고, 대신 품목 목록·생산량·원가·매입 등 공개 가능한 지표로 안내한다.
- scm_bom_lines, scm_raw_materials, scm_sub_materials 등 배합 구성 테이블은 조회하지 않는다
  (이 스키마에 없으며, 실행 계층에서도 차단됨).
"""

OMNI_SCHEMA_TEXT = CSA_SCHEMA_TEXT + OMNI_EXTRA_SCHEMA_TEXT


def get_omni_schema_text() -> str:
    """전사 통합 AI 비서용 정적 스키마 설명 텍스트 반환."""
    return OMNI_SCHEMA_TEXT
