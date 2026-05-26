#!/usr/bin/env node
/**
 * myfirstproject MCP Server (remote SSE mode for Railway)
 * BigQuery Chat Analytics + 채널 운영 통합
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

const BACKEND_URL = process.env.ANALYTICS_API_URL || process.env.BACKEND_URL || "http://localhost:8000";
const MCP_API_KEY = process.env.MCP_API_KEY || "joinandjoin-mcp-2026";
const PORT = parseInt(process.env.MCP_PORT || process.env.PORT || "3002");

async function api(path, token, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BACKEND_URL}${path}`, opts);
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
  return Object.entries(obj).slice(0, maxKeys).map(([k, v]) =>
    `${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 200) : v}`
  ).join('\n');
}

function createServer(apiToken) {
  const server = new McpServer({ name: "joinandjoin-analytics", version: "1.0.0" });
  const a = (path, method, body) => api(path, apiToken, method, body);

  server.tool("chat_analytics", "자연어 → BigQuery SQL → 분석", { question: z.string() }, async ({ question }) => {
    const r = await a(`/chat`, "POST", { message: question });
    const sql = r.sql || r.generated_sql || "";
    const rows = r.rows || r.data || [];
    let text = `질문: ${question}\n`;
    if (sql) text += `SQL: ${sql}\n`;
    text += `요약: ${r.summary || r.answer || ''}\n`;
    if (rows.length) text += `결과(${rows.length}):\n${rows.slice(0, 30).map(x => fmt(x, 6)).join('\n---\n')}`;
    return { content: [{ type: "text", text }] };
  });

  server.tool("execute_query", "BigQuery SQL 직접 실행", { sql: z.string() }, async ({ sql }) => {
    const r = await a(`/query`, "POST", { sql });
    const rows = r.rows || r.data || [];
    return { content: [{ type: "text", text: rows.length ? `${rows.length}행:\n${rows.slice(0, 30).map(x => fmt(x, 8)).join('\n---\n')}` : "결과 없음" }] };
  });

  server.tool("get_channel_sales_summary", "채널별 매출 요약",
    { start_date: z.string().optional(), end_date: z.string().optional() },
    async ({ start_date, end_date }) => {
      const qs = new URLSearchParams();
      if (start_date) qs.set("start_date", start_date);
      if (end_date) qs.set("end_date", end_date);
      const data = await a(`/channels/sales/summary?${qs}`);
      const arr = Array.isArray(data.items || data.summary || data) ? (data.items || data.summary || data) : [data];
      if (!arr.length) return { content: [{ type: "text", text: "데이터 없음" }] };
      return { content: [{ type: "text", text: arr.map(c => `${c.channel_name || c.name || '-'}: 매출 ${(c.total_sales || c.amount || 0).toLocaleString()}원 | 주문 ${c.orders || 0}건`).join('\n') }] };
    });

  server.tool("get_channel_sales_detail", "특정 채널 매출 상세",
    { channel_id: z.number().optional(), period: z.string().optional(), start_date: z.string().optional(), end_date: z.string().optional() },
    async ({ channel_id, period, start_date, end_date }) => {
      const qs = new URLSearchParams();
      if (channel_id) qs.set("channel_id", String(channel_id));
      if (period) qs.set("period", period);
      if (start_date) qs.set("start_date", start_date);
      if (end_date) qs.set("end_date", end_date);
      const data = await a(`/channels/sales/detail?${qs}`);
      const rows = data.rows || data.items || data || [];
      return { content: [{ type: "text", text: rows.length ? `${rows.length}행:\n${rows.slice(0, 50).map(r => `${r.date || r.period || '-'} | ${r.channel_name || '-'} | ${(r.amount || r.total_sales || 0).toLocaleString()}원`).join('\n')}` : "데이터 없음" }] };
    });

  server.tool("get_csa_dashboard", "CSA 채널 손익 대시보드", { year_month: z.string().optional() }, async ({ year_month }) => {
    const qs = year_month ? `?year_month=${year_month}` : "";
    const d = await a(`/api/csa/dashboard${qs}`);
    let text = `CSA ${year_month || ''}\n`;
    if (d.totals) text += `매출 ${d.totals.revenue?.toLocaleString() || '-'} | GP ${d.totals.gp_rate?.toFixed(1) || '-'}% | OP ${d.totals.operating_profit?.toLocaleString() || '-'}\n`;
    if (d.by_channel) {
      const arr = Array.isArray(d.by_channel) ? d.by_channel : Object.entries(d.by_channel).map(([k, v]) => ({ channel: k, ...v }));
      text += arr.slice(0, 15).map(c => `${c.channel || c.channel_name || '-'}: 매출 ${(c.revenue || 0).toLocaleString()} | GP ${c.gp_rate?.toFixed(1) || '-'}%`).join('\n');
    }
    return { content: [{ type: "text", text }] };
  });

  server.tool("list_csa_products", "CSA 제품 목록", {}, async () => {
    const data = await a(`/api/csa/products`);
    const items = Array.isArray(data) ? data : (data.products || data.items || []);
    return { content: [{ type: "text", text: items.length ? `제품 ${items.length}건:\n${items.map(p => `#${p.id} ${p.name || '-'} | 원가 ${p.cogs?.toLocaleString() || '-'} | 단가 ${p.price?.toLocaleString() || '-'}`).join('\n')}` : "없음" }] };
  });

  server.tool("get_account_overview", "전사 KPI 개요", {}, async () => {
    const d = await a(`/analytics/account-overview`);
    return { content: [{ type: "text", text: fmt(d, 20) }] };
  });

  server.tool("list_analytics_rules", "자동 분석 룰 목록", {}, async () => {
    const data = await a(`/analytics/rules`);
    const items = Array.isArray(data) ? data : (data.rules || []);
    return { content: [{ type: "text", text: items.length ? `룰 ${items.length}건:\n${items.map(r => `#${r.id} ${r.name || '-'} | ${r.is_active ? '활성' : '비활성'}`).join('\n')}` : "없음" }] };
  });

  server.tool("execute_analytics_rule", "분석 룰 실행", { rule_id: z.number() }, async ({ rule_id }) => {
    const r = await a(`/analytics/rules/execute`, "POST", { rule_id });
    return { content: [{ type: "text", text: `룰 #${rule_id}:\n${fmt(r, 25)}` }] };
  });

  server.tool("list_campaign_plans", "캠페인 플랜 목록", {}, async () => {
    const data = await a(`/campaign-planner/plans`);
    const items = Array.isArray(data) ? data : (data.plans || []);
    return { content: [{ type: "text", text: items.length ? `${items.length}건:\n${items.map(p => `#${p.id} ${p.name || p.title || '-'} | 예산 ${p.budget?.toLocaleString() || '-'} | ${p.status || '-'}`).join('\n')}` : "없음" }] };
  });

  server.tool("get_campaign_plan", "캠페인 플랜 상세", { plan_id: z.number() }, async ({ plan_id }) => {
    return { content: [{ type: "text", text: fmt(await a(`/campaign-planner/plans/${plan_id}`), 25) }] };
  });

  server.tool("generate_campaign_plan", "AI 캠페인 생성",
    { product_name: z.string(), budget: z.number(), target_channel: z.string().optional(), objective: z.string().optional() },
    async (args) => {
      const r = await a(`/campaign-planner/generate-plan`, "POST", args);
      return { content: [{ type: "text", text: fmt(r, 25) }] };
    });

  server.tool("list_market_keywords", "시장 키워드 목록", {}, async () => {
    const data = await a(`/market-analysis/keywords`);
    const items = Array.isArray(data) ? data : (data.keywords || []);
    return { content: [{ type: "text", text: items.length ? `키워드 ${items.length}개:\n${items.map(k => `#${k.id} ${k.keyword || '-'} | ${k.category || '-'}`).join('\n')}` : "없음" }] };
  });

  server.tool("get_keyword_metrics", "키워드 지표", { keyword_id: z.number() }, async ({ keyword_id }) => {
    return { content: [{ type: "text", text: fmt(await a(`/market-analysis/keywords/${keyword_id}/metrics`), 25) }] };
  });

  server.tool("get_coupang_status", "쿠팡 윙 연동 상태", {}, async () => {
    return { content: [{ type: "text", text: fmt(await a(`/coupang-wing/status`), 15) }] };
  });

  server.tool("get_cafe24_status", "카페24 연동 상태", {}, async () => {
    return { content: [{ type: "text", text: fmt(await a(`/cafe24/status`), 15) }] };
  });

  server.tool("get_sabangnet_stats", "사방넷 CS 통계", {}, async () => {
    return { content: [{ type: "text", text: fmt(await a(`/sabangnet/inquiries/total-stats`), 20) }] };
  });

  server.tool("ai_summary", "AI 텍스트 요약",
    { text: z.string(), context: z.string().optional() },
    async (args) => {
      const r = await a(`/ai/summary`, "POST", args);
      return { content: [{ type: "text", text: r.summary || r.answer || JSON.stringify(r) }] };
    });

  server.tool("ai_advice", "AI 비즈니스 조언",
    { situation: z.string(), question: z.string().optional() },
    async (args) => {
      const r = await a(`/ai/advice`, "POST", args);
      return { content: [{ type: "text", text: r.advice || r.answer || JSON.stringify(r) }] };
    });

  return server;
}

const app = express();
// NOTE: do NOT mount express.json() globally — SSEServerTransport reads
// the raw POST body on /mcp/messages, and a json middleware in front
// consumes the stream and causes 400 Bad Request on every message.
// This server only exposes MCP endpoints, so no other route needs json.

app.get("/health", (_, res) => res.json({ ok: true, name: "joinandjoin-analytics-mcp", version: "1.0.0" }));

// Auth — only on the SSE handshake. The MCP SDK does NOT pass ?key= when
// POSTing to /mcp/messages (it uses the endpoint URL emitted by the
// SSEServerTransport, registered as bare "/mcp/messages"), so a blanket
// app.use("/mcp", auth) middleware blocks every message POST with 401.
// Authentication still happens at handshake time, and the messages
// endpoint is protected by sessionId lookup (transports map), matching
// the pattern used by the attendance backend.
const transports = new Map();
app.get("/mcp/sse", async (req, res) => {
  const key = req.query.key || req.headers["x-mcp-key"];
  if (key !== MCP_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const apiToken = req.query.token || req.headers["x-api-token"] || "";
  const transport = new SSEServerTransport("/mcp/messages", res);
  transports.set(transport.sessionId, transport);
  res.on("close", () => transports.delete(transport.sessionId));
  const server = createServer(apiToken);
  await server.connect(transport);
});

app.post("/mcp/messages", async (req, res) => {
  const transport = transports.get(req.query.sessionId);
  if (!transport) return res.status(404).json({ error: "Session not found" });
  // Pass req/res only — the SDK reads the raw body itself.
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`Analytics MCP server listening on :${PORT}`);
  console.log(`Backend: ${BACKEND_URL}`);
});

