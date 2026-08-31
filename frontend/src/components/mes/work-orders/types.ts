// /mes/work-orders 전용 타입 — docs/MES_DESIGN.md §4(작업지시) 응답 계약을 따른다.
import type { WorkOrder, WorkResult, Defect, Downtime, MaterialIssue, ProcessRun } from '@/lib/mes/api';

export type ViewMode = 'list' | 'kanban' | 'timeline';

export interface WorkOrderDetail {
  order: WorkOrder;
  results: WorkResult[];
  defects: Defect[];
  downtimes: Downtime[];
  materials: MaterialIssue[];
  workers: { id: number; name: string }[];
  runs: ProcessRun[];
}

export interface TimelineOrder {
  id: number;
  wo_no: string;
  item_name: string;
  status: string;
  start_at?: string | null;
  end_at?: string | null;
  plan_qty: number;
  progress_pct?: number;
}

export interface TimelineEquipment {
  id: number;
  name: string;
  floor?: string | null;
  orders: TimelineOrder[];
}

export interface TimelineResponse {
  equipment: TimelineEquipment[];
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

export type WoAction = 'start' | 'pause' | 'resume' | 'finish' | 'cancel';

export const STATUS_ORDER: WorkOrder['status'][] = ['planned', 'released', 'in_progress', 'paused', 'done', 'cancelled'];

export const PRIORITY_COLOR: Record<number, string> = {
  1: 'bg-text-quaternary',
  2: 'bg-info',
  3: 'bg-brand',
  4: 'bg-warning',
  5: 'bg-danger',
};
