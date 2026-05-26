# myfirstproject MCP Server

조인앤조인 BigQuery Chat Analytics + 채널 운영 통합(사방넷·카페24·쿠팡·스마트스토어·CSA·캠페인 플래너)을 MCP로 노출합니다.

## 노출 도구 (19종)

### 자연어 분석 / SQL
- `chat_analytics(question)` — 자연어 질문 → SQL → BigQuery 실행 + AI 요약
- `execute_query(sql)` — Raw SQL 직접 실행

### 채널 매출
- `get_channel_sales_summary(start_date?, end_date?)` — 채널별 매출 요약
- `get_channel_sales_detail(channel_id?, period?, start_date?, end_date?)` — 채널 상세 매출

### CSA (채널별 손익)
- `get_csa_dashboard(year_month?)` — 채널별 손익 대시보드
- `list_csa_products()` — 등록 제품 목록

### 분석 룰 / 자동화
- `get_account_overview()` — 전사 KPI 개요
- `list_analytics_rules()` — 자동 분석 룰 목록
- `execute_analytics_rule(rule_id)` — 룰 즉시 실행

### 캠페인 플래너
- `list_campaign_plans()` — 캠페인 플랜 목록
- `get_campaign_plan(plan_id)` — 플랜 상세
- `generate_campaign_plan(product_name, budget, target_channel?, objective?)` — AI 자동 생성

### 시장 분석
- `list_market_keywords()` — 추적 키워드 목록
- `get_keyword_metrics(keyword_id)` — 키워드 지표 (검색량/CPC 등)

### 외부 채널 연동 상태
- `get_coupang_status()` — 쿠팡 윙 연동 상태
- `get_cafe24_status()` — 카페24 연동 상태
- `get_sabangnet_stats()` — 사방넷 CS 통계

### AI
- `ai_summary(text, context?)` — 텍스트/데이터 AI 요약
- `ai_advice(situation, question?)` — 비즈니스 상황 조언

## 실행 모드

### Local (stdio)
```bash
ANALYTICS_API_URL=http://localhost:8000 ANALYTICS_API_TOKEN=eyJ... node index.mjs
```

`.mcp.json`:
```json
{
  "mcpServers": {
    "analytics": {
      "command": "node",
      "args": ["C:/Users/lion9/myfirstproject/mcp-server/index.mjs"],
      "env": {
        "ANALYTICS_API_URL": "https://myfirstproject-production.up.railway.app",
        "ANALYTICS_API_TOKEN": "..."
      }
    }
  }
}
```

### Remote (SSE) — Railway
```bash
ANALYTICS_API_URL=https://myfirstproject-production.up.railway.app \
MCP_API_KEY=joinandjoin-mcp-2026 \
PORT=3002 \
node server.mjs
```

`.mcp.json` (다른 서비스에서):
```json
{
  "mcpServers": {
    "analytics": {
      "url": "https://myfirstproject-mcp.up.railway.app/mcp/sse?key=joinandjoin-mcp-2026&token=<USER_JWT>"
    }
  }
}
```

## Railway 배포

1. 새 서비스 생성 → GitHub `jinhaesu/myfirstproject` 연결
2. **Root directory**: `mcp-server`
3. **Dockerfile** 자동 감지
4. **환경변수**:
   - `ANALYTICS_API_URL` = 백엔드 URL
   - `MCP_API_KEY` = 클라이언트 키 (반드시 변경)
5. 도메인 생성 후 SSE URL을 다른 서비스에 등록

## 백엔드 endpoint 매핑

| MCP tool | Backend endpoint |
|---|---|
| chat_analytics | POST /chat |
| execute_query | POST /query |
| get_channel_sales_* | GET /channels/sales/* |
| get_csa_dashboard | GET /api/csa/dashboard |
| list_csa_products | GET /api/csa/products |
| get_account_overview | GET /analytics/account-overview |
| list_analytics_rules | GET /analytics/rules |
| execute_analytics_rule | POST /analytics/rules/execute |
| list_campaign_plans | GET /campaign-planner/plans |
| generate_campaign_plan | POST /campaign-planner/generate-plan |
| list_market_keywords | GET /market-analysis/keywords |
| get_keyword_metrics | GET /market-analysis/keywords/{id}/metrics |
| get_coupang_status | GET /coupang-wing/status |
| get_cafe24_status | GET /cafe24/status |
| get_sabangnet_stats | GET /sabangnet/inquiries/total-stats |
| ai_summary | POST /ai/summary |
| ai_advice | POST /ai/advice |
