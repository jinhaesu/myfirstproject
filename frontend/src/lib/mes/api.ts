// MES 공용 API 클라이언트 — 모든 /mes 페이지는 이 헬퍼만 사용한다.
// base: /api/mes (next.config rewrites → 백엔드). 인증은 localStorage token Bearer.

const authHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
};

const BASE = '/api/mes';

export interface ApiResult<T = any> { ok: boolean; status: number; data: T; error?: string }

export async function mesGet<T>(path: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(`${BASE}${path}`, { headers: authHeaders(), cache: 'no-store' });
    if (!r.ok) return fallback;
    return (await r.json()) as T;
  } catch {
    return fallback;
  }
}

export async function mesGetRaw<T = any>(path: string): Promise<ApiResult<T>> {
  try {
    const r = await fetch(`${BASE}${path}`, { headers: authHeaders(), cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data, error: r.ok ? undefined : (data?.detail || r.statusText) };
  } catch (e: any) {
    return { ok: false, status: 0, data: {} as T, error: e?.message || 'network' };
  }
}

export async function mesSend<T = any>(path: string, method: 'POST' | 'PUT' | 'DELETE' | 'PATCH', body?: any): Promise<ApiResult<T>> {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: authHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    const err = !r.ok ? (typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail || r.statusText)) : undefined;
    return { ok: r.ok, status: r.status, data, error: err };
  } catch (e: any) {
    return { ok: false, status: 0, data: {} as T, error: e?.message || 'network' };
  }
}

export const mesPost = <T = any>(path: string, body?: any) => mesSend<T>(path, 'POST', body);
export const mesPut = <T = any>(path: string, body?: any) => mesSend<T>(path, 'PUT', body);
export const mesDelete = <T = any>(path: string) => mesSend<T>(path, 'DELETE');

// ── 공통 타입 (docs/MES_DESIGN.md §2 기준) ──
export type PopKind = 'mixing' | 'heating' | 'freezing' | 'metal' | 'packing';
export type WoStatus = 'planned' | 'released' | 'in_progress' | 'paused' | 'done' | 'cancelled';
export type ApprovalStatus = 'draft' | 'submitted' | 'reviewed' | 'approved' | 'rejected';

export interface MesProcess { id: number; code: string; name: string; process_class: string; floor?: string | null; is_ccp: boolean; ccp_code?: string | null; pop_kind?: PopKind | null; sub_kind?: string | null; sort_order: number; is_active: boolean; notes?: string | null }
export interface MesEquipment { id: number; code: string; name: string; process_id?: number | null; process_name?: string | null; floor?: string | null; unit_label?: string | null; eq_type?: string | null; maker?: string | null; model?: string | null; spec?: string | null; purchase_date?: string | null; purchase_amount?: number | null; plc_yn?: boolean; is_active: boolean; sort_order: number; notes?: string | null }
export interface MesWorker { id: number; name: string; department?: string | null; default_floor?: string | null; phone?: string | null; is_active: boolean; sort_order: number; health_cert_date?: string | null; health_cert_next?: string | null; notes?: string | null }
export interface MesCode { id: number; group_code: string; code: string; name: string; sort_order: number; is_active: boolean; extra?: Record<string, any> | null; notes?: string | null }
export interface MesLimit { id: number; process_id: number; process_name?: string; family_code?: string | null; name: string; param: string; min_value?: number | null; max_value?: number | null; unit?: string | null; check_cycle?: string | null; check_method?: string | null; corrective_action?: string | null; alarm_yn?: boolean; is_active: boolean; notes?: string | null }
export interface MesItem { id: number; name: string; code?: string | null; item_type?: string | null; category?: string | null; family_code?: string | null }

export interface WorkOrder {
  id: number; wo_no: string; order_date: string; seq: number; item_id?: number | null; item_name: string; family_code?: string | null;
  process_id: number; process_name?: string; equipment_id?: number | null; equipment_name?: string | null;
  plan_qty: number; unit: string; batch_count?: number | null; status: WoStatus; priority: number;
  start_at?: string | null; end_at?: string | null; lot_no?: string | null; expiry_date?: string | null; notes?: string | null; created_by?: string | null;
  workers?: { id: number; name: string }[]; prod_qty?: number; good_qty?: number; defect_qty?: number; progress_pct?: number; downtime_minutes?: number; result_count?: number;
}
export interface WorkResult { id: number; work_order_id: number; result_no: string; start_at?: string | null; end_at?: string | null; prod_qty: number; good_qty: number; defect_qty: number; worker_id?: number | null; worker_name?: string | null; notes?: string | null }
export interface Defect { id: number; work_order_id: number; result_id?: number | null; defect_code: string; defect_name?: string; qty: number; notes?: string | null }
export interface Downtime { id: number; work_order_id?: number | null; equipment_id?: number | null; equipment_name?: string | null; downtime_code: string; downtime_name?: string; start_at?: string | null; end_at?: string | null; minutes?: number | null; reason?: string | null }
export interface MaterialIssue { id: number; work_order_id: number; material_type: string; material_id?: number | null; material_name: string; qty: number; unit?: string | null; lot_no?: string | null }

export interface ProcessRun {
  id: number; run_date: string; process_id: number; process_name?: string; pop_kind?: PopKind | null; equipment_id?: number | null; equipment_name?: string | null; work_order_id?: number | null;
  family_code?: string | null; item_name?: string | null; input_kg?: number | null; alcohol_g?: number | null; limit_value?: number | null; measured_value?: number | null;
  start_at?: string | null; end_at?: string | null; minutes?: number | null; judgment?: '적' | '부' | null; worker_id?: number | null; worker_name?: string | null;
  test_result?: 'pass' | 'detect' | 'test' | null; status: 'running' | 'done' | 'deleted'; notes?: string | null;
}
export interface Deviation { id: number; run_id?: number | null; work_order_id?: number | null; process_id: number; process_name?: string; equipment_id?: number | null; equipment_name?: string | null; occurred_at: string; deviation_code: string; deviation_name?: string; description?: string | null; limit_value?: number | null; measured_value?: number | null; corrective_action?: string | null; action_by?: string | null; action_at?: string | null; status: 'open' | 'in_progress' | 'closed' }
export interface CcpLog { id: number; log_date: string; process_id: number; process_name?: string; ccp_code?: string | null; equipment_id?: number | null; equipment_name?: string | null; status: ApprovalStatus; author?: string | null; approver?: string | null; submitted_at?: string | null; approved_at?: string | null; reject_reason?: string | null; summary?: any; notes?: string | null; run_count?: number; fail_count?: number }
export interface ChecklistItem { no: number; section?: string; item: string; standard?: string; type: 'ok' | 'num' | 'text'; unit?: string; ref?: string; min?: number | null; max?: number | null }
export interface ChecklistTemplate { id: number; code: string; name: string; category: string; cycle: 'daily' | 'weekly' | 'monthly' | 'asneeded'; items: ChecklistItem[]; approval?: { reviewer?: boolean; approver?: boolean }; is_active: boolean; sort_order: number; notes?: string | null }
export interface ChecklistEntry { id: number; template_id: number; template_code?: string; template_name?: string; cycle?: string; category?: string; check_date: string; shift: string; author?: string | null; status: ApprovalStatus; reviewer?: string | null; approver?: string | null; results: Record<string, { value: any; note?: string }>; remarks?: string | null; deviation_count: number; submitted_at?: string | null; approved_at?: string | null; reject_reason?: string | null }
export interface EquipmentEvent { id: number; equipment_id: number; equipment_name?: string; event_type: string; event_date: string; description?: string | null; part_name?: string | null; cost?: number | null; done_by?: string | null; downtime_minutes?: number | null; status: 'open' | 'closed' }
