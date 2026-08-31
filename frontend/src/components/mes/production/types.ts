// /mes/production 전용 타입 — docs/MES_DESIGN.md §4(생산일보·OEE) 응답 계약을 따른다.

export interface DailyRow {
  date: string;
  wo_no: string;
  item_name: string;
  process_name?: string | null;
  equipment_name?: string | null;
  plan_qty: number;
  prod_qty: number;
  good_qty: number;
  defect_qty: number;
  defect_rate: number;
  achievement_rate: number;
  load_minutes: number;
  downtime_minutes: number;
  run_minutes: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  workers?: string[] | string | null;
}

export interface DailyTotals {
  plan_qty: number;
  prod_qty: number;
  good_qty: number;
  defect_qty: number;
  defect_rate: number;
  achievement_rate: number;
  downtime_minutes: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

export interface DailyResponse {
  rows: DailyRow[];
  totals: DailyTotals;
}

export interface TrendPoint {
  period: string;
  plan_qty: number;
  prod_qty: number;
  good_qty: number;
  defect_qty: number;
  oee: number;
  downtime_minutes: number;
  wo_count: number;
}

export interface TrendResponse {
  series: TrendPoint[];
}

export interface ParetoItem {
  code: string;
  name: string;
  qty?: number;
  minutes?: number;
  pct: number;
  cum_pct: number;
}

export interface ParetoResponse {
  defects: ParetoItem[];
  downtimes: ParetoItem[];
}

export interface PlanRow {
  plan_date: string;
  item_id?: number | null;
  item_name: string;
  family_code?: string | null;
  plan_qty: number;
  unit?: string;
}

export interface PlansResponse {
  items: PlanRow[];
  actual: Record<string, number>;
}

export const workersLabel = (w?: string[] | string | null): string => {
  if (!w) return '-';
  if (Array.isArray(w)) return w.join(', ') || '-';
  return w;
};

export const ratioPct = (v: number | null | undefined): number => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return 0;
  const n = Number(v);
  return n <= 1.5 ? n * 100 : n;
};
