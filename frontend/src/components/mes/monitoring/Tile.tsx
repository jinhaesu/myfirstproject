'use client';

import type { MonitorTile, TileState } from './types';

const STATE_CLS: Record<TileState, string> = {
  normal: 'border-success/40 text-success',
  warn: 'border-warning/40 text-warning',
  danger: 'border-danger/60 text-danger',
  off: 'border-border-primary text-text-quaternary',
};

/** 모니터링 타일 — 온도/금속검출/창고·냉각실 공용 */
export function Tile({ tile, onClick }: { tile: MonitorTile; onClick?: () => void }) {
  const isMetal = tile.kind === 'metal';
  const pulse = tile.state === 'danger';
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border-2 bg-bg-1 px-4 py-3.5 transition-colors hover:border-brand/60 ${STATE_CLS[tile.state]} ${pulse ? 'animate-pulse' : ''}`}
    >
      <div className="text-sm font-semibold text-text-secondary truncate mb-1">{tile.name}</div>
      {isMetal ? (
        <div className="space-y-0.5">
          <div className="text-sm"><span className="text-success font-bold">양품</span> {tile.pass ?? '-'}</div>
          <div className={`text-sm ${(tile.detect || 0) > 0 ? 'text-danger font-bold' : ''}`}><span className="text-danger font-bold">검출</span> {tile.detect ?? '-'}</div>
          <div className="text-sm"><span className="text-info font-bold">시편</span> {tile.test ?? '-'}</div>
        </div>
      ) : (
        <div className={`text-3xl font-black tabular-nums ${STATE_CLS[tile.state].split(' ')[1]}`}>
          {tile.value != null ? tile.value.toFixed(1) : '—'}{tile.unit || '℃'}
        </div>
      )}
      {(tile.limit_min != null || tile.limit_max != null) && (
        <div className="text-[11px] text-text-quaternary mt-1">
          기준 {tile.limit_min != null ? `${tile.limit_min}${tile.unit || '℃'} 이상` : ''}{tile.limit_min != null && tile.limit_max != null ? ' · ' : ''}{tile.limit_max != null ? `${tile.limit_max}${tile.unit || '℃'} 이하` : ''}
        </div>
      )}
      {tile.running_item && <div className="text-xs text-text-tertiary mt-1 truncate">진행중: {tile.running_item}</div>}
    </button>
  );
}
