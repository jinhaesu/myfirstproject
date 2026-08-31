// POP 현장단말 전용 로컬 타입 (docs/MES_DESIGN.md §4 계약 기준, lib/mes/api.ts에 없는 것만)
import type { PopKind } from '@/lib/mes/api';

export interface RunsSummaryProcess { process_id: number; name: string; pop_kind?: PopKind | null; total: number; running: number; done: number; pass: number; fail: number; pass_rate: number }
export interface RunsSummary {
  by_process: RunsSummaryProcess[];
  by_equipment: { equipment_id: number; name: string; total: number; running: number; done: number; pass: number; fail: number; pass_rate: number }[];
  total: number;
  pass_rate: number;
}

export interface WoDetail {
  order: import('@/lib/mes/api').WorkOrder;
  results: import('@/lib/mes/api').WorkResult[];
  defects: import('@/lib/mes/api').Defect[];
  downtimes: import('@/lib/mes/api').Downtime[];
  materials: import('@/lib/mes/api').MaterialIssue[];
  workers: { id: number; name: string }[];
  runs: import('@/lib/mes/api').ProcessRun[];
}

export const POP_KIND_LABEL: Record<string, string> = {
  mixing: '배합',
  heating: '가열',
  freezing: '급속동결',
  metal: '금속검출',
  packing: '포장·작업지시',
};

export const SUB_KIND_LABEL: Record<string, string> = {
  '굽기': '굽기', '끓임': '끓임', '멜팅': '멜팅', '터널': '터널',
};
