'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

const getAuthHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
};
const fmt = (n: number) => Number(n || 0).toLocaleString('ko-KR');
const wonShort = (n: number) => { const a = Math.abs(n || 0); if (a >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '억'; if (a >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만'; return '₩' + Math.round(n || 0).toLocaleString('ko-KR'); };
const numShort = (n: number) => { const a = Math.abs(n || 0); if (a >= 1e8) return (n / 1e8).toFixed(2).replace(/\.00$/, '') + '억'; if (a >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '만'; return Math.round(n || 0).toLocaleString('ko-KR'); };

interface Row {
  id: number; name: string; category: string; code: string; aliases: string[];
  sales_channels: number; sales_qty: number; sales_amount: number;
  prod_qty: number; stock: number; bom_finished: number; bom_semi: number; bom_set: number; bom_total: number;
  bom_items: { name: string; item_type: string; code: string }[];
  linked: { sales: boolean; production: boolean; bom: boolean }; link_score: number;
}
interface Overview { rows: Row[]; count: number; summary: { sales_linked: number; production_linked: number; bom_linked: number; fully_linked: number }; }

const C = { card: 'bg-[#0F1011] border border-[#23252A] rounded-xl', th: 'text-left text-xs font-semibold text-[#8A8F98] px-3 py-2 border-b border-[#23252A] whitespace-nowrap', td: 'px-3 py-2 text-sm text-[#D0D6E0] border-b border-[#1A1B1E] whitespace-nowrap' };

function Dot({ on, label }: { on: boolean; label: string }) {
  return <span className={`inline-flex items-center gap-1 text-[11px] ${on ? 'text-[#3FBE5B]' : 'text-[#62666D]'}`}><span className={`w-2 h-2 rounded-full ${on ? 'bg-[#27A644]' : 'bg-[#3A3A3A]'}`} />{label}</span>;
}

export default function MappingPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [ov, setOv] = useState<Overview | null>(null);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyGap, setOnlyGap] = useState(false);

  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);
  const load = useCallback(async () => {
    const r = await fetch('/api/inventory/mapping-overview', { headers: getAuthHeaders() }).then((x) => x.ok ? x.json() : null).catch(() => null);
    setOv(r);
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  const automap = async () => {
    if (!confirm('BOM(scm_products)을 품목에 자동 연결합니다. 진행할까요?')) return;
    setBusy(true);
    const r = await fetch('/api/inventory/mapping-automap', { method: 'POST', headers: getAuthHeaders() }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r) { alert(`BOM 자동연결 ${r.updated}건 · 미매칭 ${r.unmatched?.length || 0}종`); load(); }
  };

  if (isLoading || !user) return <div className="min-h-screen bg-[#08090A]" />;
  const rows = (ov?.rows || []).filter((r) => (!q || r.name.includes(q) || r.category.includes(q)) && (!onlyGap || r.link_score < 3));

  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-[#F7F8F8]">품목 매핑 관계</h1>
            <p className="text-sm text-[#8A8F98] mt-0.5">한 품목이 영업(매출)·생산·물류재고·BOM(세트)에서 어떻게 연결되는지 한눈에.</p>
          </div>
          <button onClick={automap} disabled={busy} className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#5E6AD2] hover:bg-[#4d58bd] text-white">{busy ? '연결 중…' : 'BOM 자동매핑'}</button>
        </div>

        {ov && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className={`${C.card} p-4`}><div className="text-xs text-[#8A8F98]">영업 연결</div><div className="text-2xl font-bold text-[#828FFF]">{ov.summary.sales_linked}<span className="text-sm text-[#62666D]">/{ov.count}</span></div></div>
            <div className={`${C.card} p-4`}><div className="text-xs text-[#8A8F98]">생산 연결</div><div className="text-2xl font-bold text-[#F0BF00]">{ov.summary.production_linked}<span className="text-sm text-[#62666D]">/{ov.count}</span></div></div>
            <div className={`${C.card} p-4`}><div className="text-xs text-[#8A8F98]">BOM 연결</div><div className="text-2xl font-bold text-[#00B8CC]">{ov.summary.bom_linked}<span className="text-sm text-[#62666D]">/{ov.count}</span></div></div>
            <div className={`${C.card} p-4`}><div className="text-xs text-[#8A8F98]">완전 연결(3/3)</div><div className="text-2xl font-bold text-[#3FBE5B]">{ov.summary.fully_linked}<span className="text-sm text-[#62666D]">/{ov.count}</span></div></div>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목/카테고리 검색" className="bg-[#08090A] border border-[#23252A] rounded-lg px-3 py-2 text-sm text-[#F7F8F8] w-64" />
          <label className="text-xs text-[#8A8F98] flex items-center gap-1.5"><input type="checkbox" checked={onlyGap} onChange={(e) => setOnlyGap(e.target.checked)} /> 미완결(연결 누락)만</label>
          <span className="text-xs text-[#62666D] ml-auto">{rows.length}개 품목</span>
        </div>

        <div className={`${C.card} overflow-x-auto`}>
          <table className="w-full">
            <thead><tr>
              <th className={C.th}>품목</th><th className={C.th}>카테고리</th>
              <th className={C.th}>영업(채널·매출)</th><th className={C.th}>생산량</th><th className={C.th}>재고</th>
              <th className={C.th}>BOM(완/반/세트)</th><th className={C.th}>연결</th><th className={C.th}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <>
                  <tr key={r.id} className="hover:bg-[#0F1011] cursor-pointer" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    <td className={`${C.td} text-[#F7F8F8] font-medium`}>{r.name}{r.code && <span className="text-[10px] text-[#62666D] ml-1">{r.code}</span>}</td>
                    <td className={C.td}>{r.category}</td>
                    <td className={C.td}><span className="text-[#828FFF]">{r.sales_channels}채널</span> · {wonShort(r.sales_amount)}</td>
                    <td className={C.td}>{numShort(r.prod_qty)}</td>
                    <td className={`${C.td} ${r.stock < 0 ? 'text-[#EB5757]' : ''}`}>{numShort(r.stock)}</td>
                    <td className={C.td}>{r.bom_total > 0 ? <span className="text-[#00B8CC]">완{r.bom_finished}/반{r.bom_semi}/세트{r.bom_set}</span> : <span className="text-[#EB5757] text-xs">미연결</span>}</td>
                    <td className={C.td}><div className="flex gap-2"><Dot on={r.linked.sales} label="영업" /><Dot on={r.linked.production} label="생산" /><Dot on={r.linked.bom} label="BOM" /></div></td>
                    <td className={C.td}><span className="text-[#62666D] text-xs">{openId === r.id ? '▲' : '▼'}</span></td>
                  </tr>
                  {openId === r.id && (
                    <tr key={`${r.id}-d`} className="bg-[#08090A]">
                      <td colSpan={8} className="px-4 py-3 border-b border-[#1A1B1E]">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <div className="text-xs font-semibold text-[#8A8F98] mb-1">BOM 연결 품목 ({r.bom_total})</div>
                            {r.bom_items.length === 0 ? <div className="text-xs text-[#62666D]">연결된 BOM 품목이 없습니다. 상단 [BOM 자동매핑]을 실행하거나 SCM 품목관리에서 연결하세요.</div> : (
                              <div className="flex flex-wrap gap-1.5">
                                {r.bom_items.map((b, i) => (
                                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-[#141516] border border-[#23252A] text-[#D0D6E0]">
                                    <span className={b.item_type?.includes('세트') ? 'text-[#828FFF]' : b.item_type?.includes('완제품') ? 'text-[#3FBE5B]' : 'text-[#F0BF00]'}>[{b.item_type}]</span> {b.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-[#8A8F98] mb-1">별칭 / 판매 매핑</div>
                            <div className="text-[11px] text-[#62666D]">별칭 {r.aliases.length}개 · 판매채널 {r.sales_channels} · 누적매출 {wonShort(r.sales_amount)} · 생산 {numShort(r.prod_qty)}개</div>
                            <div className="text-[11px] text-[#62666D] mt-1">{r.aliases.slice(0, 12).join(', ')}{r.aliases.length > 12 ? ' …' : ''}</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[#62666D] mt-3">연결 = 영업(판매채널/매출)·생산(생산실적)·BOM(scm_products) 세 축. 세 축 모두 있으면 완전 연결. 재고는 물류 재고 시스템 기준.</p>
      </main>
    </div>
  );
}
