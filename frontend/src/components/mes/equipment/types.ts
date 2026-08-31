// /mes/equipment 화면 전용 타입 — docs/MES_DESIGN.md §4 "설비" 섹션 응답 형태에 맞춤.
import type { MesEquipment } from '@/lib/mes/api';

export type EquipState = 'running' | 'idle' | 'down' | 'off';

export interface EquipStatusRow {
  equipment: MesEquipment;
  state: EquipState;
  current_run?: { id: number; item_name?: string | null; family_code?: string | null } | null;
  current_order?: { id: number; wo_no?: string; item_name?: string | null } | null;
  last_temp?: number | null;
  today_runs: number;
  today_fail: number;
  open_events: number;
}

export interface EquipRunSummaryRow {
  equipment_id: number;
  name: string;
  total: number;
  pass?: number;
  fail?: number;
  running?: number;
  done?: number;
}
