"""CSA(채널별 매출 취합) AI 채팅용 정적 스키마 설명.

BigQuery 기반 AI 채팅을 PostgreSQL(CSA 테이블) 기반으로 전환하면서,
동적으로 BigQuery API를 조회하던 스키마 설명을 정적 큐레이션 텍스트로 대체한다.
실제 컬럼명은 app/db_models.py 기준으로 작성되었다 (추측 금지 — 컬럼 추가/변경 시 이 파일도 함께 갱신할 것).

주의: 이 모듈은 순수 문자열 상수만 포함하며 import 시점에 DB 접속을 하지 않는다.
"""

CSA_SCHEMA_TEXT = """
## 데이터베이스: PostgreSQL (Supabase). 아래는 CSA(채널별 매출 취합) 도메인의 핵심 테이블입니다.

### 1. csa_sales_daily_product — 일×채널×품목 매출 집계 (★ 매출 질문의 기본 테이블)
  - sale_date (date): 매출 일자. 기간 필터는 이 컬럼 기준.
  - year (int), month (int), quarter (int)
  - channel_id (varchar): channels.id 참조
  - channel_name (varchar): 채널명 (카페24, 쿠팡 등)
  - channel_category (varchar, nullable): 채널 카테고리
  - product_id (int, FK → csa_product_master.id, nullable)
  - product_name (varchar, nullable)
  - raw_qty (float): 채널 원본 표기 판매수량
  - pcs_qty (float): 낱개 환산 수량 (raw_qty × 세트당 낱개수). "판매수량", "낱개수량" 질문은 이 컬럼을 사용.
  - gross_sales (float): 총 판매가 (할인 반영 전)
  - net_sales (float): 순매출 (공급가, VAT 별도, 취소/반품 제외). ★ "매출"이라는 질문은 기본적으로 net_sales의 합을 의미함.
  - settlement_amount (float): 실제 정산금액(입금액)
  - commission (float): raw 단계 채널 수수료
  - refund_amount (float): 환불 금액
  - order_count (int): 주문건수. "주문수"는 이 컬럼.
  - variable_cost (float): 변동비 합계
  - contribution_margin (float): 공헌이익 (net_sales - variable_cost 계열)
  - cost_cogs (float): 원가
  - cost_labor (float): 노무비
  - cost_overhead (float): 제조간접비
  - cost_logistics_work (float): 물류작업비
  - cost_logistics_oh (float): 물류간접비
  - cost_advertising (float): 광고비
  - cost_commission_rate (float): 정률 판매수수료
  - cost_commission_fixed (float): 정액 판매수수료
  - cost_shipping (float): 운반비/택배비
  - cost_packaging (float): 포장비
  - cost_platform_fee (float): 판매수수료(월정액)
  - revenue_deduction (float): 매출차감형 월정액 배분액 (정산 시 매출에서 직접 차감되는 항목. 표시매출 = net_sales - revenue_deduction)
  - updated_at (timestamp)
  * Unique: (sale_date, channel_id, product_id)

### 2. channels — 채널 마스터
  - id (varchar, PK)
  - name (varchar): 채널명 (카페24, 쿠팡, 스마트스토어 등)
  - category (varchar): 카테고리 (오픈마켓, 홈쇼핑, B2B 등)
  - integration_type (varchar): api / rpa / manual
  - is_active (boolean): 활성화 여부
  - created_at, updated_at (timestamp)

### 3. csa_product_master — 표준 품목 마스터
  - id (int, PK)
  - code (varchar): 자체 품목 코드
  - name (varchar): 표준 품목명 (마카롱, 뚱낭시에 등)
  - category (varchar, nullable)
  - default_unit_size (int): 기본 입수 (낱개=1)
  - is_active (boolean)
  - sort_order (int)
  - created_at, updated_at (timestamp)

### 4. csa_employee — 직원 마스터
  - id (int, PK)
  - email (varchar, unique): 로그인 이메일
  - name (varchar)
  - role (varchar): admin / manager / staff
  - is_active (boolean)
  - created_at, updated_at (timestamp)

### 5. csa_employee_channel — 직원↔채널 담당 매핑 (★ "담당자별 매출" 질문은 이 테이블을 csa_employee, csa_sales_daily_product와 조인)
  - id (int, PK)
  - employee_id (int, FK → csa_employee.id)
  - channel_id (varchar): channels.id
  - channel_name (varchar)
  - is_active (boolean): ★ 현재 담당 여부. 담당자 매출 집계 시 반드시 is_active = true 조건을 걸 것.
  - created_at, updated_at (timestamp)
  * Unique: (employee_id, channel_id)

### 6. csa_channel_group — 채널 구분 그룹 (온라인 위탁/사입, 오프라인 마트/CVS/창고형/급식/기타)
  - id (int, PK)
  - code (varchar, unique): online_consign / online_purchase / offline_mart 등
  - name (varchar, unique): 그룹명
  - big_group (varchar): 온라인 / 오프라인
  - sort_order (int)
  - created_at (timestamp)

### 7. csa_channel_group_membership — 채널→그룹 매핑 (채널 1개는 그룹 1개에 속함)
  - id (int, PK)
  - channel_id (varchar)
  - channel_name (varchar)
  - group_id (int, FK → csa_channel_group.id)
  - created_at, updated_at (timestamp)
  * Unique: channel_id

### 8. csa_upload_batches — 채널 엑셀 업로드 이력
  - id (varchar(64), PK, uuid)
  - channel_id (varchar)
  - channel_name (varchar)
  - file_name (varchar)
  - file_size (int)
  - period_start, period_end (date, nullable)
  - status (varchar): pending / parsing / done / failed
  - row_total, row_inserted, row_duplicate, row_unmatched, row_excluded, row_cancelled (int)
  - error_message (text, nullable)
  - uploaded_by (varchar, nullable)
  - created_at (timestamp), completed_at (timestamp, nullable)

## 비즈니스 규칙 (반드시 준수)
1. "매출"은 특별한 언급이 없는 한 csa_sales_daily_product.net_sales의 합(원 단위, 공급가 기준, VAT 별도)을 의미한다. gross_sales는 "총매출"을 명시적으로 물을 때만 사용.
2. "판매수량", "낱개수량"은 pcs_qty를 사용한다 (raw_qty는 채널 원본 표기 수량으로 세트/박스 단위일 수 있어 품목 간 비교에 부적합).
3. "주문수", "주문건수"는 order_count를 사용한다.
4. 기간(연/월/분기/특정일자) 필터는 sale_date (또는 필요 시 year/month/quarter 컬럼)를 사용한다.
5. "담당자별", "누가 담당하는" 매출/실적 질문은 csa_sales_daily_product를 csa_employee_channel(is_active = true)과 channel_id로 조인하고, 다시 csa_employee와 employee_id로 조인해 이름을 가져온다.
6. "채널 구분", "온라인/오프라인" 등 그룹 질문은 csa_channel_group_membership을 channel_id로 조인 후 csa_channel_group과 group_id로 조인한다.
7. "공헌이익"은 contribution_margin, "변동비"는 variable_cost를 사용한다. 세부 변동비 항목별 질문은 cost_* 컬럼을 사용한다.
8. 금액은 모두 원(KRW) 단위이며 정수 표시가 자연스럽다 (ROUND로 소수점 정리 권장).
"""


def get_csa_schema_text() -> str:
    """CSA 채팅용 정적 스키마 설명 텍스트 반환."""
    return CSA_SCHEMA_TEXT
