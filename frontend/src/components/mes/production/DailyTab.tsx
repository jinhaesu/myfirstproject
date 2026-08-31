'use client';

import { useEffect, useState } from 'react';
import { mesGet, type MesCode, type MesEquipment, type MesProcess } from '@/lib/mes/api';
import { C, EmptyState, PeriodBar, StatCard, downloadCSV, fmt, todayISO } from '@/lib/mes/ui';
import { OeeGauge } from './OeeGauge';
import { DailyResponse, ratioPct, workersLabel } from './types';

const empty: DailyResponse = { rows: [], totals: { plan_qty: 0, prod_qty: 0, good_qty: 0, defect_qty: 0, defect_rate: 0, achievement_rate: 0, downtime_minutes: 0, availability: 0, performance: 0, quality: 0, oee: 0 } };

export function DailyTab({ processes, equipment }: { processes: MesProcess[]; equipment: MesEquipment[] }) {
  const [range, setRange] = useState({ start: todayISO(), end: todayISO() });
  const [processId, setProcessId] = useState<number | ''>('');
  const [equipmentId, setEquipmentId] = useState<number | ''>('');
  const [familyCode, setFamilyCode] = useState('');
  const [families, setFamilies] = useState<MesCode[]>([]);
  const [data, setData] = useState<DailyResponse>(empty);
  const [loading, setLoading] = useState(false);

  useEffect(() => { mesGet<{ items: MesCode[] }>('/codes?group=FAMILY', { items: [] }).then((r) => setFamilies(r.items || [])); }, []);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ start: range.start, end: range.end });
    if (processId !== '') params.set('process_id', String(processId));
    if (equipmentId !== '') params.set('equipment_id', String(equipmentId));
    if (familyCode) params.set('family_code', familyCode);
    mesGet<DailyResponse>(`/production/daily?${params.toString()}`, empty).then((r) => { setData(r); setLoading(false); });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range.start, range.end, processId, equipmentId, familyCode]);

  const filteredEquipment = processId === '' ? equipment : equipment.filter((e) => e.process_id === processId);
  const t = data.totals;

  const exportCSV = () => {
    downloadCSV(
      `production-daily_${range.start}_${range.end}.csv`,
      ['일자', '지시번호', '품명', '공정', '설비', '계획', '생산', '양품', '불량', '불량률', '달성률', '부하(분)', '비가동(분)', '가동(분)', '가동률', '성능', '품질', 'OEE', '작업자'],
      data.rows.map((r) => [r.date, r.wo_no, r.item_name, r.process_name || '', r.equipment_name || '', r.plan_qty, r.prod_qty, r.good_qty, r.defect_qty, `${ratioPct(r.defect_rate).toFixed(1)}%`, `${ratioPct(r.achievement_rate).toFixed(1)}%`, r.load_minutes, r.downtime_minutes, r.run_minutes, `${ratioPct(r.availability).toFixed(1)}%`, `${ratioPct(r.performance).toFixed(1)}%`, `${ratioPct(r.quality).toFixed(1)}%`, `${ratioPct(r.oee).toFixed(1)}%`, workersLabel(r.workers)])
    );
  };

  const oeeTone = (v: number) => (v >= 85 ? 'text-success' : v >= 60 ? 'text-warning' : 'text-danger');

  return (
    <div>
      <div className={`${C.cardPad} mb-4 flex flex-wrap items-center gap-2`}>
        <PeriodBar range={range} setRange={setRange} />
        <select className={C.select} value={processId} onChange={(e) => { setProcessId(e.target.value ? Number(e.target.value) : ''); setEquipmentId(''); }}>
          <option value="">전체 공정</option>
          {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className={C.select} value={equipmentId} onChange={(e) => setEquipmentId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">전체 설비</option>
          {filteredEquipment.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select className={C.select} value={familyCode} onChange={(e) => setFamilyCode(e.target.value)}>
          <option value="">전체 제품군</option>
          {families.map((f) => <option key={f.id} value={f.code}>{f.name}</option>)}
        </select>
        <div className="ml-auto"><button className={`${C.btn} ${C.btnGhost}`} onClick={exportCSV}>CSV</button></div>
      </div>

      <div className={`${C.cardPad} mb-4`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <OeeGauge label="가동률" value={ratioPct(t.availability)} />
          <OeeGauge label="성능" value={ratioPct(t.performance)} />
          <OeeGauge label="품질" value={ratioPct(t.quality)} />
          <OeeGauge label="OEE" value={ratioPct(t.oee)} />
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <StatCard label="계획" value={fmt(t.plan_qty)} />
          <StatCard label="생산" value={fmt(t.prod_qty)} />
          <StatCard label="양품" value={fmt(t.good_qty)} tone="text-success" />
          <StatCard label="불량률" value={`${ratioPct(t.defect_rate).toFixed(1)}%`} tone={ratioPct(t.defect_rate) > 5 ? 'text-danger' : undefined} />
          <StatCard label="달성률" value={`${ratioPct(t.achievement_rate).toFixed(0)}%`} />
          <StatCard label="비가동(분)" value={fmt(t.downtime_minutes)} tone="text-warning" />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-text-tertiary py-10 text-center">불러오는 중…</div>
      ) : data.rows.length === 0 ? (
        <EmptyState title="생산일보 데이터가 없습니다" sub="조회 조건을 변경해보세요" />
      ) : (
        <div className={`${C.card} overflow-x-auto`}>
          <table className="w-full border-collapse min-w-[1500px]">
            <thead>
              <tr>
                <th className={`${C.th} sticky left-0 bg-bg-1`}>일자</th>
                <th className={C.th}>지시번호</th>
                <th className={C.th}>품명</th>
                <th className={C.th}>공정</th>
                <th className={C.th}>설비</th>
                <th className={`${C.th} text-right`}>계획</th>
                <th className={`${C.th} text-right`}>생산</th>
                <th className={`${C.th} text-right`}>양품</th>
                <th className={`${C.th} text-right`}>불량</th>
                <th className={`${C.th} text-right`}>불량률</th>
                <th className={`${C.th} text-right`}>달성률</th>
                <th className={`${C.th} text-right`}>부하(분)</th>
                <th className={`${C.th} text-right`}>비가동(분)</th>
                <th className={`${C.th} text-right`}>가동(분)</th>
                <th className={`${C.th} text-right`}>가동률</th>
                <th className={`${C.th} text-right`}>성능</th>
                <th className={`${C.th} text-right`}>품질</th>
                <th className={`${C.th} text-right`}>OEE</th>
                <th className={C.th}>작업자</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="hover:bg-bg-inset/50">
                  <td className={`${C.td} sticky left-0 bg-bg-1`}>{r.date}</td>
                  <td className={`${C.td} font-semibold text-text-primary`}>{r.wo_no}</td>
                  <td className={C.td}>{r.item_name}</td>
                  <td className={C.td}>{r.process_name || '-'}</td>
                  <td className={C.td}>{r.equipment_name || '-'}</td>
                  <td className={C.tdNum}>{fmt(r.plan_qty)}</td>
                  <td className={C.tdNum}>{fmt(r.prod_qty)}</td>
                  <td className={C.tdNum}>{fmt(r.good_qty)}</td>
                  <td className={C.tdNum}>{fmt(r.defect_qty)}</td>
                  <td className={`${C.tdNum} ${ratioPct(r.defect_rate) > 5 ? 'text-danger' : ''}`}>{ratioPct(r.defect_rate).toFixed(1)}%</td>
                  <td className={C.tdNum}>{ratioPct(r.achievement_rate).toFixed(0)}%</td>
                  <td className={C.tdNum}>{fmt(r.load_minutes)}</td>
                  <td className={C.tdNum}>{fmt(r.downtime_minutes)}</td>
                  <td className={C.tdNum}>{fmt(r.run_minutes)}</td>
                  <td className={C.tdNum}>{ratioPct(r.availability).toFixed(0)}%</td>
                  <td className={C.tdNum}>{ratioPct(r.performance).toFixed(0)}%</td>
                  <td className={C.tdNum}>{ratioPct(r.quality).toFixed(0)}%</td>
                  <td className={`${C.tdNum} font-bold ${oeeTone(ratioPct(r.oee))}`}>{ratioPct(r.oee).toFixed(0)}%</td>
                  <td className={C.td}>{workersLabel(r.workers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
