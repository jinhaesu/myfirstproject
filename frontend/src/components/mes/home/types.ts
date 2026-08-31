// MES 홈 대시보드 전용 로컬 타입 (docs/MES_DESIGN.md §4 GET /dashboard, /equipment/status 계약 기준)

export interface DashRunByProcess { process_id?: number; name: string; pop_kind?: string | null; total: number; pass: number; fail: number; pass_rate: number }

export interface DashboardResp {
  date: string;
  orders: { total: number; planned: number; in_progress: number; done: number; cancelled: number; plan_qty: number; good_qty: number; achievement: number };
  runs: { total: number; pass: number; fail: number; pass_rate: number; by_process: DashRunByProcess[] };
  deviations_open: number;
  checklists: { due: number; done: number; rate: number };
  ccp_logs: { draft: number; submitted: number; approved: number };
  equipment: { running: number; idle: number; down: number };
  alerts: { level: 'warn' | 'danger'; text: string; href?: string }[];
}

export interface EquipmentStatusItem {
  equipment: { id: number; name: string; process_name?: string | null; floor?: string | null };
  state: 'running' | 'idle' | 'down' | 'off';
  current_run?: { item_name?: string | null } | null;
  current_order?: { wo_no?: string | null; item_name?: string | null } | null;
  last_temp?: number | null;
  today_runs: number;
  today_fail: number;
  open_events: number;
}
