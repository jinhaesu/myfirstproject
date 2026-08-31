// 모니터링 보드 전용 로컬 타입 (docs/MES_DESIGN.md §4 /monitoring, /sensors 계약 기준)

export type TileState = 'normal' | 'warn' | 'danger' | 'off';
export type TileKind = 'temp' | 'metal' | 'other';

export interface MonitorTile {
  equipment_id: number;
  name: string;
  kind: TileKind;
  value?: number | null;
  unit?: string | null;
  updated_at?: string | null;
  state: TileState;
  limit_min?: number | null;
  limit_max?: number | null;
  running_item?: string | null;
  pass?: number | null;
  detect?: number | null;
  test?: number | null;
}

export interface MonitorGroup { title: string; tiles: MonitorTile[] }
export interface MonitoringResp { floor: string; groups: MonitorGroup[]; updated_at?: string | null }

export interface SensorPoint { ts: string; value: number; kind?: string }
export interface SensorResp { items: SensorPoint[] }
