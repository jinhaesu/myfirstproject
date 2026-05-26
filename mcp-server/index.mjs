#!/usr/bin/env node
/**
 * myfirstproject MCP Server (stdio mode)
 * BigQuery Chat Analytics + 채널 운영 통합 (사방넷·카페24·쿠팡·스마트스토어·CSA)
 *
 * Environment variables:
 *   - ANALYTICS_API_URL: backend URL (default: http://localhost:8000)
 *   - ANALYTICS_API_TOKEN: JWT bearer token from /auth/login
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.ANALYTICS_API_URL || "http://localhost:8000";
const API_TOKEN = process.env.ANALYTICS_API_TOKEN || "";

async function api(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(API_TOKEN && { Authorization: `Bearer ${API_TOKEN}` }),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} ${path}: ${text.slice(0, 300)}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

function fmt(obj, maxKeys = 12) {
  if (obj == null) return "(none)";
  if (typeof obj !== "object") return String(obj);
  const entries = Object.entries(obj).slice(0, maxKeys);
  return entries.map(([k, v]) =>
    `${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 200) : v}`
  ).join('\n');
}

const server = new McpServer({
  name: "joinandjoin-analytics",
  version: "1.0.0",
});

// ===== 자연어 챗 분석 (BigQuery NL → SQL) =====
server.tool(
  "chat_analytics",
  "자연어 질문을 BigQuery SQL로 변환하여 데이터를 분석합니다. 예: '지난주 채널별 매출 알려줘'",
  { question: z.string().describe("자연어 질문") },
  async ({ question }) => {
    const result = await api(`/chat`, "POST", { message: question });
    const sql = result.sql || result.generated_sql || "";
    const summary = result.summary || result.answer || "";
    const rows = result.rows || result.data || [];
    let text = `질문: ${question}\n\n`;
    if (sql) text += `생성 SQL:\n${sql}\n\n`;
    text += `요약: ${summary}\n\n`;
    if (rows.length > 0) {
      text += `결과 (${rows.length}행):\n`;
      text += rows.slice(0, 30).map(r => fmt(r, 6)).join('\n---\n');
    }
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "execute_query",
  "BigQuery SQL을 직접 실행합니다 (raw SQL)",
  { sql: z.string().describe("BigQuery 호환 SQL") },
  async ({ sql }) => {
    const result = await api(`/query`, "POST", { sql });
    const rows = result.rows || result.data || [];
    if (rows.length === 0) return { content: [{ type: "text", text: "결과 없음" }] };
    const text = `${rows.length}행 반환:\n${rows.slice(0, 30).map(r => fmt(r, 8)).join('\n---\n')}`;
    return { content: [{ type: "text", text }] };
  }
);

// ===== 채널 매출 =====
server.tool(
  "get_channel_sales_summary",
  "전 채널 매출 요약 (기간 지정 가능)",
  {
    start_date: z.string().optional().describe("시작일 YYYY-MM-DD"),
    end_date: z.string().optional().describe("종료일 YYYY-MM-DD"),
  },
  async ({ start_date, end_date }) => {
    const qs = new URLSearchParams();
    if (start_date) qs.set("start_date", start_date);
    if (end_date) qs.set("end_date", end_date);
    const data = await api(`/channels/sales/summary?${qs}`);
    const items = data.items || data.summary || data || [];
    const arr = Array.isArray(items) ? items : [items];
    if (arr.length === 0) return { content: [{ type: "text", text: "데이터 없음" }] };
    const lines = arr.map(c =>
      `${c.channel_name || c.name || '-'}: 매출 ${(c.total_sales || c.amount || 0).toLocaleString()}원 | 주문 ${c.orders || 0}건 | ROAS ${c.roas?.toFixed(2) || '-'}`
    );
    return { content: [{ type: "text", text: `채널별 매출 요약:\n${lines.join('\n')}` }] };
  }
);

server.tool(
  "get_channel_sales_detail",
  "특정 채널 일별/월별 매출 상세",
  {
    channel_id: z.number().optional().describe("채널 ID"),
    period: z.string().optional().describe("기간 (daily/weekly/monthly)"),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
  },
  async ({ channel_id, period, start_date, end_date }) => {
    const qs = new URLSearchParams();
    if (channel_id) qs.set("channel_id", String(channel_id));
    if (period) qs.set("period", period);
    if (start_date) qs.set("start_date", start_date);
    if (end_date) qs.set("end_date", end_date);
    const data = await api(`/channels/sales/detail?${qs}`);
    const rows = data.rows || data.items || data || [];
    if (!rows.length) return { content: [{ type: "text", text: "데이터 없음" }] };
    const lines = rows.slice(0, 50).map(r =>
      `${r.date || r.period || '-'} | ${r.channel_name || '-'} | 매출 ${(r.amount || r.total_sales || 0).toLocaleString()} | 주문 ${r.orders || 0}`
    );
    return { content: [{ type: "text", text: `매출 상세 (${rows.length}행):\n${lines.join('\n')}` }] };
  }
);

// ===== CSA (Channel Sales Analytics) =====
server.tool(
  "get_csa_dashboard",
  "CSA(채널별 손익 분석) 종합 대시보드",
  {
    year_month: z.string().optional().describe("연월 (예: 2026-04)"),
  },
  async ({ year_month }) => {
    const qs = year_month ? `?year_month=${year_month}` : "";
    const data = await api(`/api/csa/dashboard${qs}`);
    let text = `CSA 대시보드 ${year_month ? `(${year_month})` : ''}\n\n`;
    if (data.totals) {
      text += `매출: ${data.totals.revenue?.toLocaleString() || '-'}원\n`;
      text += `매출원가: ${data.totals.cogs?.toLocaleString() || '-'}원\n`;
      text += `매출총이익: ${data.totals.gross_profit?.toLocaleString() || '-'}원 (${data.totals.gp_rate?.toFixed(1) || '-'}%)\n`;
      text += `영업이익: ${data.totals.operating_profit?.toLocaleString() || '-'}원\n\n`;
    }
    if (data.by_channel) {
      text += "채널별:\n";
      const arr = Array.isArray(data.by_channel) ? data.by_channel : Object.entries(data.by_channel).map(([k, v]) => ({ channel: k, ...v }));
      for (const c of arr.slice(0, 15)) {
        text += `  ${c.channel || c.channel_name || '-'}: 매출 ${(c.revenue || 0).toLocaleString()} | GP ${c.gp_rate?.toFixed(1) || '-'}% | OP ${(c.operating_profit || 0).toLocaleString()}\n`;
      }
    }
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "list_csa_products",
  "CSA 등록 제품 목록",
  {},
  async () => {
    const data = await api(`/api/csa/products`);
    const items = Array.isArray(data) ? data : (data.products || data.items || []);
    if (!items.length) return { content: [{ type: "text", text: "제품 없음" }] };
    const lines = items.map(p =>
      `#${p.id} ${p.name || '-'} | 원가 ${p.cogs?.toLocaleString() || '-'} | 단가 ${p.price?.toLocaleString() || '-'}`
    );
    return { content: [{ type: "text", text: `CSA 제품 (${items.length}건):\n${lines.join('\n')}` }] };
  }
);

// ===== 분석 룰 / 자동 분석 =====
server.tool(
  "get_account_overview",
  "전사 운영 KPI 개요 (매출/주문/광고비/ROAS)",
  {},
  async () => {
    const data = await api(`/analytics/account-overview`);
    let text = `전사 KPI 개요:\n${fmt(data, 20)}`;
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "list_analytics_rules",
  "자동 분석 룰 목록",
  {},
  async () => {
    const data = await api(`/analytics/rules`);
    const items = Array.isArray(data) ? data : (data.rules || []);
    if (!items.length) return { content: [{ type: "text", text: "룰 없음" }] };
    const lines = items.map(r =>
      `#${r.id} ${r.name || '-'} | 조건: ${(r.condition || r.criteria || '-').slice(0, 80)} | 활성: ${r.is_active ? '✓' : '✗'}`
    );
    return { content: [{ type: "text", text: `룰 (${items.length}건):\n${lines.join('\n')}` }] };
  }
);

server.tool(
  "execute_analytics_rule",
  "분석 룰을 즉시 실행하여 결과를 받습니다",
  { rule_id: z.number().describe("룰 ID") },
  async ({ rule_id }) => {
    const result = await api(`/analytics/rules/execute`, "POST", { rule_id });
    const text = `룰 #${rule_id} 실행 결과:\n${fmt(result, 25)}`;
    return { content: [{ type: "text", text }] };
  }
);

// ===== 캠페인 플래너 =====
server.tool(
  "list_campaign_plans",
  "광고 캠페인 플랜 목록",
  {},
  async () => {
    const data = await api(`/campaign-planner/plans`);
    const items = Array.isArray(data) ? data : (data.plans || []);
    if (!items.length) return { content: [{ type: "text", text: "캠페인 플랜 없음" }] };
    const lines = items.map(p =>
      `#${p.id} ${p.name || p.title || '-'} | 예산 ${p.budget?.toLocaleString() || '-'}원 | 채널: ${p.channel || '-'} | 상태: ${p.status || '-'}`
    );
    return { content: [{ type: "text", text: `캠페인 (${items.length}건):\n${lines.join('\n')}` }] };
  }
);

server.tool(
  "get_campaign_plan",
  "캠페인 플랜 상세",
  { plan_id: z.number().describe("플랜 ID") },
  async ({ plan_id }) => {
    const p = await api(`/campaign-planner/plans/${plan_id}`);
    const text = `캠페인 #${plan_id}:\n${fmt(p, 25)}`;
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "generate_campaign_plan",
  "AI 기반 캠페인 플랜 자동 생성",
  {
    product_name: z.string().describe("제품명"),
    budget: z.number().describe("예산 (원)"),
    target_channel: z.string().optional().describe("타겟 채널 (예: 자사몰, 쿠팡, 네이버)"),
    objective: z.string().optional().describe("목표 (예: 신규 유입, 재구매, 신제품 런칭)"),
  },
  async ({ product_name, budget, target_channel, objective }) => {
    const result = await api(`/campaign-planner/generate-plan`, "POST", {
      product_name, budget, target_channel, objective,
    });
    const text = `캠페인 생성 완료:\n${fmt(result, 25)}`;
    return { content: [{ type: "text", text }] };
  }
);

// ===== 시장 분석 (키워드) =====
server.tool(
  "list_market_keywords",
  "추적 중인 시장 키워드 목록",
  {},
  async () => {
    const data = await api(`/market-analysis/keywords`);
    const items = Array.isArray(data) ? data : (data.keywords || []);
    if (!items.length) return { content: [{ type: "text", text: "키워드 없음" }] };
    const lines = items.map(k =>
      `#${k.id} ${k.keyword || '-'} | 카테고리: ${k.category || '-'} | 최근 수집: ${(k.last_collected_at || '').slice(0, 10) || '-'}`
    );
    return { content: [{ type: "text", text: `키워드 (${items.length}개):\n${lines.join('\n')}` }] };
  }
);

server.tool(
  "get_keyword_metrics",
  "키워드 지표 (검색량/경쟁도/CPC 등)",
  { keyword_id: z.number().describe("키워드 ID") },
  async ({ keyword_id }) => {
    const data = await api(`/market-analysis/keywords/${keyword_id}/metrics`);
    const text = `키워드 #${keyword_id} 지표:\n${fmt(data, 25)}`;
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "compare_keywords",
  "여러 키워드를 한 번에 비교 분석",
  {},
  async () => {
    const data = await api(`/market-analysis/compare`);
    const text = `키워드 비교:\n${fmt(data, 30)}`;
    return { content: [{ type: "text", text }] };
  }
);

// ===== 외부 채널 상태 =====
server.tool(
  "get_coupang_status",
  "쿠팡 윙(Wing) 연동 상태 조회",
  {},
  async () => {
    const data = await api(`/coupang-wing/status`);
    const text = `쿠팡 윙 상태:\n${fmt(data, 15)}`;
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "get_cafe24_status",
  "카페24 연동 상태 조회",
  {},
  async () => {
    const data = await api(`/cafe24/status`);
    const text = `카페24 상태:\n${fmt(data, 15)}`;
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "get_sabangnet_stats",
  "사방넷 문의(CS) 통계 조회",
  {},
  async () => {
    const data = await api(`/sabangnet/inquiries/total-stats`);
    const text = `사방넷 CS 통계:\n${fmt(data, 20)}`;
    return { content: [{ type: "text", text }] };
  }
);

// ===== AI 도구 =====
server.tool(
  "ai_summary",
  "긴 텍스트나 데이터를 AI가 요약합니다",
  {
    text: z.string().describe("요약 대상 텍스트"),
    context: z.string().optional().describe("추가 컨텍스트"),
  },
  async ({ text, context }) => {
    const result = await api(`/ai/summary`, "POST", { text, context });
    return { content: [{ type: "text", text: result.summary || result.answer || JSON.stringify(result) }] };
  }
);

server.tool(
  "ai_advice",
  "특정 비즈니스 상황에 대한 AI 조언",
  {
    situation: z.string().describe("상황 설명"),
    question: z.string().optional().describe("구체적 질문"),
  },
  async ({ situation, question }) => {
    const result = await api(`/ai/advice`, "POST", { situation, question });
    return { content: [{ type: "text", text: result.advice || result.answer || JSON.stringify(result) }] };
  }
);

// Start stdio server
const transport = new StdioServerTransport();
await server.connect(transport);
