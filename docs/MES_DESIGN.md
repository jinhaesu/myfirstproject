# Nuldam MES — 설계 계약서 (v1, 2026-08-31)

SMHACCP MES(nuldam1.smhaccp.co.kr)를 **myfirstproject 안의 MES 모듈**로 자체 재구현한다.
원본 명세: `C:\Users\lion9\Downloads\SMHACCP_MES_명세서.md`, 스크린샷 `Downloads\SMHACCP_MES_스크린샷\`.

## 0. 범위 결정 (대표 지시)
- **제외**: 영업관리(SA), 구매/자재관리(PC), 주문(OMS/ORDR), 택배(CUST/DVR), 시스템관리(SYS — 기존 admin/권한 사용).
- **기준정보는 myfirstproject 마스터에 병합/매핑**: 품목=`scm_products`(item_type 반제품/완제품/세트) + 품목류=`csa_product_master`, 원부재료=`scm_raw_materials`/`scm_sub_materials`, BOM=`scm_bom_lines`. MES 고유 기준(공정·설비·작업자·공통코드·CCP 한계기준·점검 템플릿)만 `mes_*` 테이블 신설.
- **고도화 대상(UX 최우선)**: POP 현장단말, 작업지시, 선행점검일지(SMART HACCP), CCP 점검일지, 모니터링 보드, 생산일보/OEE.
- 재고(생산창고 입출고)는 기존 `/inventory` 모듈에 링크만.

## 1. 코드 위치
- 백엔드: `backend/app/models/mes.py`(SQLAlchemy 모델, `from app.database import Base`), `backend/app/services/mes_service.py`, `backend/app/api/routes/mes.py`(`router = APIRouter(prefix="/mes")`, main.py에 `prefix="/api"`로 등록 → 실제 경로 `/api/mes/...`).
- 인증: 모든 엔드포인트 `user: dict = Depends(get_current_user)` (`from app.api.routes.auth import get_current_user`). user dict에서 이메일은 `user.get("email") or user.get("sub")`.
- DB 세션: `db: Session = Depends(get_db)` (`from app.database import get_db`). 테이블 생성은 `database.init_db()` create_all(Alembic 없음) → 모델을 init_db import 목록에 추가.
- 프론트: `frontend/src/app/mes/**/page.tsx`, 공용 `frontend/src/lib/mes/api.ts`·`frontend/src/lib/mes/ui.tsx`, 화면별 컴포넌트 `frontend/src/components/mes/<area>/`.
- 내비: `Navigation.tsx` navGroups key `mes`, admin.py MENUS에 `{"key":"mes","label":"MES 생산현장"}`.

## 2. 데이터 모델 (`mes_*`)
공통: `id Integer PK autoincrement`, `created_at DateTime default now`, `updated_at onupdate`. 날짜는 `Date`, 시각은 `DateTime`(naive, KST 기준 저장). JSON은 `Text`에 json.dumps(ensure_ascii=False).

| 테이블 | 컬럼 |
|---|---|
| `mes_process` 공정 | code(unique, 예 P_MIX), name(배합), process_class(배합/가열/급속동결/금속검출/포장가공/성형/냉각/기타), floor('1F'/'2F'/'3F'/null), is_ccp bool, ccp_code('CCP-2B'), pop_kind('mixing'/'heating'/'freezing'/'metal'/'packing'/null), sub_kind(가열 하위: '굽기'/'끓임'/'멜팅'/'터널', null), sort_order, is_active, notes |
| `mes_equipment` 설비 | code(unique), name('2F-로터리오븐 1호기'), process_id FK nullable, floor, unit_label('2F1호기'), eq_type(로터리오븐/터널오븐/데크오븐/배합기/금속검출기/급속동결기/냉각실/창고/기타), maker, model, spec, purchase_date Date, purchase_amount Float, plc_yn bool, is_active, sort_order, notes |
| `mes_worker` 작업자 | name, department, default_floor, phone, is_active, sort_order, health_cert_date Date, health_cert_next Date, notes |
| `mes_code` 공통코드 | group_code('DOWNTIME'/'DEFECT'/'DEVIATION'/'FAMILY'/'EQ_EVENT'), code, name, sort_order, is_active, extra(Text JSON: FAMILY→{"csa_category":"마카롱","pop_kinds":["mixing","heating"],"limit_temp":null}), notes. unique(group_code, code) |
| `mes_ccp_limit` 한계기준 | process_id FK, family_code(nullable, FAMILY 코드), name, param('temp'/'time'/'alcohol_ratio'/'metal'/'other'), min_value Float, max_value Float, unit, check_cycle, check_method, corrective_action, alarm_yn bool, is_active, notes |
| `mes_production_plan` 생산계획 | plan_date Date, item_id FK scm_products nullable, item_name, family_code, plan_qty Float, unit, notes. unique(plan_date, item_name) |
| `mes_work_order` 작업지시 | wo_no(unique, 'WO' + yymmdd + 3자리 seq, 예 WO260831001), order_date Date, seq int, item_id FK scm_products nullable, item_name, family_code, process_id FK, equipment_id FK nullable, plan_qty Float, unit('ea'), batch_count int(판수량), status('planned'/'released'/'in_progress'/'paused'/'done'/'cancelled'), priority int(1~5, 기본3), start_at, end_at, lot_no, expiry_date Date, notes, created_by |
| `mes_work_order_worker` | work_order_id FK, worker_id FK, role, joined_at |
| `mes_work_result` 실적 | work_order_id FK, result_no('R'+wo_no+'-'+n), start_at, end_at, prod_qty, good_qty, defect_qty, worker_id nullable, notes |
| `mes_defect` 불량 | work_order_id FK, result_id nullable, defect_code, qty, notes |
| `mes_downtime` 비가동 | work_order_id nullable, equipment_id nullable, downtime_code, start_at, end_at nullable, minutes Float, reason |
| `mes_material_issue` 자재투입 | work_order_id FK, material_type('raw'/'sub'/'semi'), material_id nullable, material_name, qty, unit, lot_no |
| `mes_process_run` 공정실행(POP) | run_date Date, process_id FK, equipment_id FK nullable, work_order_id nullable, family_code, item_name, input_kg Float, alcohol_g Float(배합 주정=원료kg×10g, 1%), limit_value Float(기준: 한계온도 등), measured_value Float, start_at, end_at, minutes Float, judgment('적'/'부'/null), worker_id nullable, test_result('pass'/'detect'/'test'/null 금속검출), status('running'/'done'/'deleted'), notes |
| `mes_deviation` 이탈 | run_id nullable, work_order_id nullable, process_id, equipment_id nullable, occurred_at, deviation_code, description, limit_value, measured_value, corrective_action, action_by, action_at, status('open'/'in_progress'/'closed') |
| `mes_ccp_log` CCP점검일지 | log_date Date, process_id FK, equipment_id nullable, status('draft'/'submitted'/'approved'/'rejected'), author, approver, submitted_at, approved_at, reject_reason, summary_json(Text: 해당일 run 스냅샷+집계), notes. unique(log_date, process_id, equipment_id) |
| `mes_checklist_template` 점검 템플릿 | code(unique 'JJ-PP-01-B'), name, category('선행요건'/'검수'/'위생'/'설비'/'기타'), cycle('daily'/'weekly'/'monthly'/'asneeded'), items_json(Text: [{no, section, item, standard, type:'ok'|'num'|'text', unit, ref}]), approval_json(Text: {"reviewer":true,"approver":true}), is_active, sort_order, notes |
| `mes_checklist_entry` 점검일지 | template_id FK, check_date Date, shift('주간'/'야간'/'-'), author, status('draft'/'submitted'/'reviewed'/'approved'/'rejected'), reviewer, approver, results_json(Text: {"<no>": {"value": "ok"|"ng"|number|text, "note": ""}}), remarks, deviation_count int, submitted_at, approved_at, reject_reason. unique(template_id, check_date, shift) |
| `mes_equipment_event` 설비이력 | equipment_id FK, event_type('고장'/'수리'/'부품교체'/'점검'/'청소소독'), event_date Date, description, part_name, cost Float, done_by, downtime_minutes Float, status('open'/'closed') |
| `mes_sensor_reading` 센서 | equipment_id FK, ts DateTime, kind('temp'/'metal_pass'/'metal_detect'/'metal_test'/'humidity'), value Float, source('pop'/'iot'/'manual') |

## 3. 시드 (`POST /api/mes/seed`, 멱등 — code 기준 upsert)
- 공정: P_MIX 배합(CCP-2B, mixing, 2F) · P_BAKE 굽기(가열, CCP-1B, heating/굽기) · P_BOIL 끓임(heating/끓임) · P_MELT 멜팅(heating/멜팅) · P_TUNNEL 터널(heating/터널) · P_FREEZE 급속동결(freezing) · P_METAL 금속검출(CCP-3P, metal) · P_PACK 포장가공(packing) · P_FORM 성형 · P_COOL 냉각.
- 설비: 2F 로터리오븐 1~4호기(RO-2F-1..4), 2F 터널오븐 5·6호기, 3F 로터리오븐 7~14호기, 3F 터널오븐, 데크오븐 상/중/하(2F), 배합기 1·2호기(2F), 크림100리터/크림VMI 배합기, 급속동결기 2F1호기, 금속검출기 2F 1~4호기·3F 1~4호기, 1F 상온창고, 2F 냉각실.
- 작업자: 임규식 아지 대니 임준혁 이영화 이완 김종민 줄리안토 리빤 앤디 박상훈 디안 무코코 반선 수리안토 리키 김종성.
- FAMILY 코드(POP 품명선택): 얼그레이잼, 커피커스터드, 가나슈, 뚱카롱꼬끄, 뚱낭시에, 쿠키류(르뱅/아메리칸/크럼블/쫀득), 통밀스콘, 브라우니/파운드, 통밀식빵/슈톨렌, 라이트번, 앙글레즈, 베이글/바게트/포카치아/사워도우/깜빠뉴/슬랩, 마카롱꼬끄, 쫀득빵, 마들렌, 크림(뚱카롱 크림류). extra에 csa_category 매핑(마카롱꼬끄→마카롱, 뚱낭시에→뚱낭시에, 쿠키류→르뱅쿠키, 브라우니/파운드→브라우니 등 이름 유사 매핑).
- DOWNTIME: 설비고장, 자재대기, 금형/세팅교체, 청소소독, 휴식, 정전, 기타. DEFECT: 형상불량, 소성불량(타짐/덜익음), 이물, 중량미달, 파손, 포장불량, 기타. DEVIATION: 온도이탈, 시간이탈, 금속검출, 주정비율이탈, 기록누락, 기타. EQ_EVENT: 고장/수리/부품교체/점검/청소소독.
- CCP 한계기준: 배합(P_MIX) 시간 ≤ 30분(적/부 판정: minutes ≤ max → 적), 주정비율 1%(alcohol_ratio min 0.9 max 1.1 %); 굽기(P_BAKE) 품온/오븐온도 ≥ family별 한계온도(기본 max=null, min=75℃, family별 있으면 override — 세부값은 시드에서 대표적 값 예: 뚱카롱꼬끄 150, 쿠키류 170, 통밀식빵 190, 마카롱꼬끄 140 등 예시값, notes에 '예시값 — 현장 확인 필요'); 급속동결 −18℃ 이하(param temp max −18); 금속검출 Fe 1.5mm/SUS 2.5mm 시편 통과(param metal).
- 점검 템플릿(선행요건, items 각 8~20개 실제 HACCP 항목): JJ-PP-01-B 조도 점검표(작업장별 조도 기준 220/110/540 lux 등 num), JJ-PP-02 작업장 위생관리점검표, JJ-PP-03 개인위생점검일지(작업자별 복장·손세척·건강 ok), JJ-PP-04 제조시설/기구 위생점검표, JJ-PP-05 방충방서점검표, JJ-PP-06 소독시설관리점검표, JJ-PP-07 작업장온도체크리스트(작업장별 온도 num), JJ-PP-08 출입문·창문점검, JJ-PP-09-C 고객불만처리일지(text), JJ-PP-10 작업도구위생, JJ-PP-11 부대시설관리점검, JJ-PP-12 원료·부재료 검수일지, JJ-PP-13 완제품검수일지, JJ-PP-14 관능평가서, JJ-PP-15 보건증관리, JJ-PP-16 연료사용현황. cycle은 일일/주간/월간 적절히.

## 4. API 계약 (`/api/mes`) — 응답은 JSON, 목록은 `{items:[...], total}` 또는 명시 형태
### 기준정보
- `GET /processes?active=1` → `{items:[Process]}`; `POST /processes`(body 전체, id 있으면 수정) → Process; `DELETE /processes/{id}`(soft: is_active=false)
- `GET /equipment?process_id&floor&active=1` → `{items:[Equipment(+process_name)]}`; `POST /equipment`; `DELETE /equipment/{id}`(soft)
- `GET /workers?active=1`; `POST /workers`; `DELETE /workers/{id}`(soft)
- `GET /codes?group=DOWNTIME` → `{items:[Code(extra 파싱된 dict)]}`; `POST /codes`; `DELETE /codes/{id}`(soft)
- `GET /limits?process_id` → `{items:[Limit(+process_name)]}`; `POST /limits`; `DELETE /limits/{id}`(soft)
- `GET /items?q=&item_type=` → 품목 후보 `{items:[{id, name, code, item_type, category, family_code(추정)}]}` — scm_products(is_active, item_type in 반제품/완제품/세트) + q 부분매칭, 최대 200
- `GET /materials?q=` → `{items:[{id, type:'raw'|'sub', name, unit, erp_code}]}` (scm_raw_materials/scm_sub_materials)
- `GET /items/{id}/bom` → `{lines:[{material_type, material_id, material_name, qty_per_unit, unit}]}` (scm_bom_lines 직접 라인만)
- `GET /templates`, `POST /templates`, `DELETE /templates/{id}`(soft)
- `POST /seed` → `{created:{...counts}}`

### 생산계획
- `GET /plans?month=2026-08` → `{items:[{plan_date, item_id, item_name, family_code, plan_qty, unit}], actual:{"<item_name>|<date>": qty}}` (actual = 해당 일 done 작업지시 good_qty 합)
- `POST /plans/bulk` body `{items:[{plan_date, item_id, item_name, family_code, plan_qty}]}` upsert(수량 0/빈 → 삭제)

### 작업지시
- `GET /work-orders?start&end&process_id&equipment_id&status&q` → `{items:[WorkOrder(+process_name, equipment_name, workers:[{id,name}], prod_qty, good_qty, defect_qty, progress_pct, downtime_minutes, result_count)]}`
- `POST /work-orders` body `{order_date, item_id?, item_name, family_code?, process_id, equipment_id?, plan_qty, unit?, batch_count?, priority?, lot_no?, expiry_date?, notes?, worker_ids?:[]}` → wo_no 자동채번. id 있으면 수정.
- `POST /work-orders/bulk` body `{items:[...]}` (생산계획→일괄 작업지시)
- `DELETE /work-orders/{id}` (status planned/cancelled만 물리삭제, 아니면 cancelled)
- `GET /work-orders/{id}` → 상세 `{order, results:[], defects:[], downtimes:[], materials:[], workers:[], runs:[]}`
- `POST /work-orders/{id}/start` → status in_progress, start_at=now(미설정 시); `/pause`, `/resume`, `/finish`(end_at=now, status done), `/cancel`
- `POST /work-orders/{id}/results` body `{prod_qty, defect_qty?, good_qty?(없으면 prod-defect), start_at?, end_at?, worker_id?, notes?}`; `DELETE /results/{rid}`
- `POST /work-orders/{id}/defects` body `{defect_code, qty, notes?}`; `DELETE /defects/{did}`
- `POST /work-orders/{id}/downtimes` body `{downtime_code, start_at?, end_at?, minutes?, reason?, equipment_id?}` (end 없으면 진행중; `POST /downtimes/{did}/end`로 종료 → minutes 계산); `DELETE /downtimes/{did}`
- `POST /work-orders/{id}/materials` body `{material_type, material_id?, material_name, qty, unit?, lot_no?}`; `POST /work-orders/{id}/materials/from-bom` (BOM×plan_qty 자동 산출 투입); `DELETE /materials/{mid}`
- `POST /work-orders/{id}/workers` body `{worker_ids:[...]}` (전체 교체)
- `GET /work-orders/timeline?date=` → 설비별 타임라인 `{equipment:[{id,name,floor,orders:[{id,wo_no,item_name,status,start_at,end_at,plan_qty,progress_pct}]}]}` (설비 미지정은 equipment id 0 '미배정')

### POP 공정실행
- `GET /runs?date=&pop_kind=&process_id=&equipment_id=&status=` → `{items:[Run(+process_name, equipment_name, worker_name)]}`
- `POST /runs` body `{run_date?, process_id, equipment_id?, work_order_id?, family_code?, item_name?, input_kg?, alcohol_g?, limit_value?, measured_value?, worker_id?, notes?}` → status running, start_at=now. (limit_value 미지정 시 process+family 한계기준에서 자동 채움; 배합이면 alcohol_g = input_kg×10 자동)
- `POST /runs/{id}/end` body `{measured_value?, test_result?, notes?}` → end_at=now, minutes, **judgment 자동**: 배합=minutes ≤ limit(max) → 적; 가열/급속동결=measured vs limit(min/max) 충족 → 적; 금속검출=test_result pass/test → 적, detect → 부. 부 판정이면 `mes_deviation` 자동 생성(status open, deviation_code 자동 매핑).
- `PUT /runs/{id}` (수정), `DELETE /runs/{id}` (status deleted)
- `GET /runs/summary?date=` → `{by_process:[{process_id, name, pop_kind, total, running, done, pass, fail, pass_rate}], by_equipment:[...], total, pass_rate}`

### 이탈·개선조치
- `GET /deviations?start&end&status&process_id` → `{items:[Deviation(+process_name, equipment_name)]}`
- `POST /deviations` (수동 등록/수정), `POST /deviations/{id}/close` body `{corrective_action, action_by}`; `GET /deviations/stats?start&end` → `{by_type:[{code,name,count}], by_process:[...], by_day:[{date,count}]}`

### CCP 점검일지
- `GET /ccp-logs?start&end&process_id&status` → `{items:[Log(+process_name, equipment_name, run_count, fail_count)]}`
- `POST /ccp-logs/generate` body `{date}` → 해당일 CCP 공정 run이 있는 (process, equipment) 조합마다 draft 로그 생성/갱신(summary_json 재계산). 응답 `{created, updated}`
- `GET /ccp-logs/{id}` → `{log, runs:[...], limits:[...]}`
- `POST /ccp-logs/{id}/submit`, `/approve`, `/reject` body `{reason}` (author/approver = 현재 사용자 이메일), `PUT /ccp-logs/{id}` notes 수정

### 선행점검일지
- `GET /checklists?start&end&template_id&status` → `{items:[Entry(+template_code, template_name, cycle, category)]}`
- `GET /checklists/calendar?month=` → `{templates:[{id,code,name,cycle}], days:{"2026-08-01":{"<template_id>":"approved"|"submitted"|"draft"|"missing"|"n/a"}}, completion_rate}` (daily 템플릿은 매일, weekly는 주 1회(해당 주에 1건 있으면 그 주 전체 충족), monthly 월 1회)
- `GET /checklists/today` → 오늘 작성해야 할 템플릿 + 상태
- `POST /checklists` body `{template_id, check_date, shift?, results_json(dict), remarks?}` (id 있으면 수정; deviation_count = ng 개수 자동)
- `GET /checklists/{id}` → `{entry, template}`; `POST /checklists/{id}/submit|review|approve|reject`; `DELETE /checklists/{id}`(draft만)

### 설비
- `GET /equipment-events?equipment_id&start&end`; `POST /equipment-events`; `POST /equipment-events/{id}/close`; `DELETE /equipment-events/{id}`
- `GET /equipment/status?date=` → `{items:[{equipment(+process), state:'running'|'idle'|'down'|'off', current_run, current_order, last_temp, today_runs, today_fail, open_events}]}`

### 모니터링·센서
- `GET /monitoring?floor=2F` → `{floor, groups:[{title:'CCP-2층', tiles:[{equipment_id,name,kind:'temp'|'metal', value, unit, updated_at, state, limit_min, limit_max, running_item}]}], updated_at}`
- `POST /sensors/ingest` body `{readings:[{equipment_code|equipment_id, kind, value, ts?}]}` (IoT/PLC 연동용, source='iot'); `GET /sensors?equipment_id&start&end&kind` → 시계열

### 생산일보·OEE
- `GET /production/daily?start&end&process_id&equipment_id&family_code` → `{rows:[{date, wo_no, item_name, process_name, equipment_name, plan_qty, prod_qty, good_qty, defect_qty, defect_rate, achievement_rate, load_minutes, downtime_minutes, run_minutes, availability, performance, quality, oee, workers}], totals:{...}}`
  - load_minutes = (end_at 또는 now) − start_at; run_minutes = load − downtime; availability = run/load; quality = good/prod; performance = min(1, prod_qty/plan_qty) (plan 0이면 1); oee = 곱 (0~1, 프론트에서 %)
- `GET /production/trend?start&end&granularity=day|week|month&family_code` → `{series:[{period, plan_qty, prod_qty, good_qty, defect_qty, oee, downtime_minutes, wo_count}]}`
- `GET /production/pareto?start&end` → `{defects:[{code,name,qty,pct,cum_pct}], downtimes:[{code,name,minutes,pct,cum_pct}]}`
- `GET /dashboard?date=` → MES 홈 `{date, orders:{total, planned, in_progress, done, cancelled, plan_qty, good_qty, achievement}, runs:{total, pass, fail, pass_rate, by_process:[...]}, deviations_open, checklists:{due, done, rate}, ccp_logs:{draft, submitted, approved}, equipment:{running, idle, down}, alerts:[{level:'warn'|'danger', text, href}]}`

## 5. 프론트 구성 (`/mes/*`)
| 경로 | 내용 |
|---|---|
| `/mes` | MES 홈 대시보드: KPI 타일, 오늘 작업지시 진행 바, 공정별 CCP 적합률 도넛, 미결 이탈/결재 알림 리스트, 설비 상태 미니타일, 빠른 이동(POP·작업지시·점검일지) |
| `/mes/pop` | **POP 현장단말**(태블릿, 큰 터치 타깃, 전체화면 토글로 내비 숨김). 상단: 공정 탭(배합/가열[굽기·끓임·멜팅·터널]/급속동결/금속검출/포장가공). 좌: 오늘 실행 목록(진행중=경과시간 실시간 타이머, 판정 적/부 컬러 배지, 이탈 탭). 우: 입력 패널(호기·품명(제품군 칩)·원료투입량 kg·주정 g 자동·한계온도 표시·측정값·담당자 칩) + 숫자 키패드. 포장가공 탭 = 작업지시 실행(작업조회/시작/실적등록/불량등록/비가동/작업종료/작업자등록/제품입고→inventory 링크) + 하단 현황 탭(작업자/자재투입/불량/생산실적). 상단 요약 스트립(오늘 건수·적합률·진행중). |
| `/mes/work-orders` | 작업지시: 뷰 토글(목록/칸반(status 컬럼 드래그 없이 버튼 이동)/설비 타임라인(간트, 시간축 06~24시)). 등록 모달(품목 검색 Combobox→family 자동, 공정·설비·수량·판수량·우선순위·작업자 다중선택·BOM 자재 자동투입 체크). 상세 드로어(진행률 바, 실적/불량/비가동/자재/작업자 탭, 액션 버튼 시작/일시정지/종료/취소). 생산계획→작업지시 일괄 생성. |
| `/mes/production` | 탭: 생산일보(일자별 표 + OEE 게이지 4개(가동률/성능/품질/OEE) + 공정·설비 필터 + 엑셀 CSV 다운로드) / 추이(계획 vs 실적 ComposedChart, OEE 라인, 비가동 바) / 파레토(불량·비가동 Pareto 차트) / 생산계획(월 그리드 품목×일, 셀 편집·저장, 실적 겹쳐 표시) |
| `/mes/haccp/ccp` | CCP 점검일지: 상단 [일지 생성(날짜)] → 목록(점검일자/공정/설비/건수/부적합/상태/작성자/승인자) + 상세 패널(해당일 run 표: 호기·품명·투입·기준·측정·시작·종료·시간·판정·담당 + 한계기준 박스 + 결재 액션 상신/승인/반려 + 인쇄용 뷰 `window.print`). 상태 필터 칩. |
| `/mes/haccp/checklists` | 선행점검일지: 탭 [오늘 점검 / 달력 / 일지 목록 / 템플릿]. 오늘: 템플릿 카드(작성 상태·버튼). 달력: 월 히트맵(템플릿 × 일자 셀 색상 approved/submitted/draft/missing) + 완료율. 작성 폼: 템플릿 items를 섹션별 표로, ok/ng 토글(큰 버튼), 숫자 입력(기준 비교 자동 NG 표시), 텍스트, 비고, 부적합 개수 실시간, 저장/상신. 결재: 검토/승인/반려. 인쇄 뷰. 템플릿 관리: 항목 편집(JSON 편집 UI 표) |
| `/mes/haccp/deviations` | 이탈·개선조치: 상태 칩(open/in_progress/closed), 목록, 개선조치 입력 모달(조치내용·조치자→close), 통계(유형별 바, 일별 추이, 공정별) |
| `/mes/monitoring` | 층별 모니터링 보드(2F / 3F 토글, 30초 자동 새로고침 토글): 오븐 온도 타일(값·한계 대비 색상, 진행중 품명), 금속검출기 타일(양품/검출/시편), 창고·냉각실 온도. 다크 배경 대형 숫자. 최근 온도 스파크라인(sensors 시계열). |
| `/mes/equipment` | 설비관리: 설비 카드(상태 running/idle/down, 오늘 실행수/부적합, 미결 이벤트), 고장/부품교체/점검 이력 등록·마감, 설비별 이력 타임라인, 가동시간 바 차트 |
| `/mes/master` | 기준정보: 탭 [공정 / 설비 / 작업자·보건증 / 제품군·품목매핑 / 공통코드 / CCP 한계기준 / 점검 템플릿 링크] 각 CRUD 표+모달. 제품군 탭에 csa_category 매핑 select(`/api/csa/...` 대신 `/mes/items`로 카테고리 목록 추출) + '시드 실행' 버튼(owner) |

### 프론트 공용 규약
- 페이지 상단: `const { user, isLoading } = useAuth(); useEffect(()=>{ if(!isLoading && !user) router.replace('/login') })`, `if (isLoading||!user) return <div className="min-h-screen bg-bg-0" />`, `<Navigation />` 후 `<main className="max-w-[1400px] mx-auto px-4 py-6">`. POP는 `max-w-none`.
- API 호출은 `@/lib/mes/api`의 `mesGet/mesPost/mesDelete` 사용(상대경로 `/api/mes/...`, Authorization Bearer localStorage token).
- UI 아톰은 `@/lib/mes/ui` (`C` 클래스 세트, StatCard, Pill, Modal, Tabs, EmptyState, ConfirmButton, fmt/won/pct, todayISO/iso, PeriodBar).
- 색: 테마 토큰 클래스만(`bg-bg-0/1/2`, `text-text-primary/secondary/tertiary`, `border-border-primary`, `bg-brand`, `text-success/warning/danger`). 하드코딩 hex는 Recharts 색상 배열(`COLORS`)만 허용.
- 차트: recharts(ResponsiveContainer). 상태 색: planned=text-tertiary, released=info, in_progress=brand, paused=warning, done=success, cancelled=danger. 판정 적=success, 부=danger.
- 모든 목록은 빈 상태 컴포넌트(EmptyState) 표시. 로딩은 `LoadingOverlay` 또는 skeleton.
- 태블릿 대응: POP는 버튼 min-h 56px, 글자 lg 이상, 키패드 4열.
