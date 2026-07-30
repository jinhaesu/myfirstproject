'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, AreaChart, Area,
} from 'recharts';

type TabKey = 'roas' | 'budget' | 'channel' | 'ltv';

interface ChannelRow {
  name: string;
  fee: number;
  returnRate: number;
}

const PANEL = 'bg-bg-1 rounded-xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-border-primary';
const SUBPANEL = 'bg-bg-0 rounded-lg border border-border-primary';

export default function ContributionMarginPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [user, authLoading, router]);

  const [tab, setTab] = useState<TabKey>('roas');
  const [roasHover, setRoasHover] = useState<{ x: number; y: number } | null>(null);

  const [cm1, setCm1] = useState(50);
  const [roas, setRoas] = useState(400);
  const [adBudget, setAdBudget] = useState(5_000_000);
  const [organicRevenue, setOrganicRevenue] = useState(0);
  const [targetMargin, setTargetMargin] = useState(25);

  const [aov, setAov] = useState(35_000);
  const [cac, setCac] = useState(8_000);
  const [repurchase, setRepurchase] = useState(2.5);

  const [channels, setChannels] = useState<ChannelRow[]>([
    { name: '쿠팡', fee: 10.8, returnRate: 3 },
    { name: '마켓컬리', fee: 35, returnRate: 1 },
    { name: 'B마트', fee: 25, returnRate: 2 },
    { name: '자사몰', fee: 3.3, returnRate: 2 },
  ]);

  const updateChannel = (idx: number, field: keyof ChannelRow, value: string | number) => {
    setChannels((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  };

  const metrics = useMemo(() => {
    const adRevenue = (roas * adBudget) / 100;
    const revenue = organicRevenue + adRevenue;
    const gp1 = (revenue * cm1) / 100;
    const finalCm = gp1 - adBudget;
    const finalCmRate = revenue > 0 ? (finalCm / revenue) * 100 : 0;
    const adOnlyBeRoas = cm1 > 0 ? (100 / cm1) * 100 : 0;
    const realBeRoas =
      adBudget > 0 ? ((adBudget / (cm1 / 100) - organicRevenue) / adBudget) * 100 : 0;
    const blendedRoas = adBudget > 0 ? (revenue / adBudget) * 100 : 0;
    const denom = (cm1 - targetMargin) / 100;
    const targetRoas =
      denom > 0 && adBudget > 0
        ? ((adBudget / denom - organicRevenue) / adBudget) * 100
        : null;
    return {
      adRevenue,
      revenue,
      gp1,
      finalCm,
      finalCmRate,
      adOnlyBeRoas,
      realBeRoas,
      blendedRoas,
      targetRoas,
    };
  }, [cm1, roas, adBudget, organicRevenue, targetMargin]);

  const roasCurveData = useMemo(() => {
    const data: Array<Record<string, number>> = [];
    const cmLow = cm1 - 10;
    const cmHigh = cm1 + 10;
    for (let r = 150; r <= 800; r += 25) {
      const adRev = (r * adBudget) / 100;
      const total = organicRevenue + adRev;
      const ratio = total > 0 ? (adBudget / total) * 100 : 0;
      data.push({
        roas: r,
        cmLow: total > 0 ? cmLow - ratio : 0,
        cmMid: total > 0 ? cm1 - ratio : 0,
        cmHigh: total > 0 ? cmHigh - ratio : 0,
      });
    }
    return data;
  }, [adBudget, organicRevenue, cm1]);

  const budgetSensitivity = useMemo(() => {
    const data: Array<{ budget: number; revenue: number; finalCm: number }> = [];
    const maxBudget = Math.max(adBudget * 2, 10_000);
    const step = Math.max(maxBudget / 40, 1);
    for (let b = 0; b <= maxBudget; b += step) {
      const adRev = (roas * b) / 100;
      const totalRev = organicRevenue + adRev;
      const finalCm = (totalRev * cm1) / 100 - b;
      data.push({ budget: b, revenue: totalRev, finalCm });
    }
    return data;
  }, [roas, cm1, organicRevenue, adBudget]);

  const channelData = channels.map((ch) => ({
    name: ch.name,
    실공헌이익율: +(cm1 - ch.fee - ch.returnRate).toFixed(1),
    수수료: ch.fee,
    반품손실: ch.returnRate,
  }));

  const ltv = aov * repurchase * (cm1 / 100);
  const ltvCac = cac > 0 ? ltv / cac : 0;
  const paybackData = useMemo(() => {
    const data: Array<{ month: string; cumulative: number }> = [];
    const monthlyCm = aov * (cm1 / 100) * (repurchase / 12);
    let cumulative = -cac;
    for (let m = 0; m <= 12; m++) {
      if (m > 0) cumulative += monthlyCm;
      data.push({ month: `M${m}`, cumulative: +cumulative.toFixed(0) });
    }
    return data;
  }, [aov, cm1, repurchase, cac]);

  const fmtC = (n: number | null | undefined) => {
    if (n === null || n === undefined || isNaN(n)) return '-';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 100_000_000) {
      const v = abs / 100_000_000;
      return `${sign}${v >= 100 ? v.toFixed(0) : v.toFixed(2)}억`;
    }
    if (abs >= 10_000) {
      const v = abs / 10_000;
      return `${sign}${v >= 100 ? v.toFixed(0) : v.toFixed(1)}만`;
    }
    return `${sign}${new Intl.NumberFormat('ko-KR').format(Math.round(abs))}`;
  };
  const fmt = (n: number) => new Intl.NumberFormat('ko-KR').format(Math.round(n));
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  const tabs: { id: TabKey; label: string }[] = [
    { id: 'roas', label: '01  ROAS 분석' },
    { id: 'budget', label: '02  광고예산 민감도' },
    { id: 'channel', label: '03  채널별 수익성' },
    { id: 'ltv', label: '04  LTV / Payback' },
  ];

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-bg-0 to-bg-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-text-tertiary">로딩 중...</p>
        </div>
      </div>
    );
  }
  if (!user) return null;

  const tooltipStyle = {
    background: 'var(--color-bg-level-1)',
    border: '1px solid var(--color-border-primary)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--color-text-secondary)',
  } as const;

  return (
    <main className="min-h-screen bg-gradient-to-br from-bg-0 to-bg-0 text-text-primary">
      <Navigation />

      <div className="max-w-[1400px] mx-auto px-4 py-6">
        {/* 헤더 */}
        <div className={`${PANEL} px-6 py-5 mb-6 flex items-baseline justify-between`}>
          <div>
            <div className="text-[11px] tracking-[0.2em] text-text-quaternary uppercase mb-1.5 font-mono">
              E-Commerce Economics Dashboard
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
              공헌이익 시뮬레이션
            </h1>
          </div>
          <div className="text-right text-[11px] text-text-quaternary font-mono space-y-0.5">
            <div>조인앤조인 · 널담</div>
            <div>v1.2 / 2026</div>
          </div>
        </div>

        {/* KPI 바 */}
        <div className={`${PANEL} px-6 py-5 mb-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6`}>
          <Kpi
            label="총매출"
            value={`₩${fmtC(metrics.revenue)}`}
            sub={`자연 ₩${fmtC(organicRevenue)} + 광고 ₩${fmtC(metrics.adRevenue)}`}
          />
          <Kpi label="1차 공헌이익" value={`₩${fmtC(metrics.gp1)}`} sub={`${cm1}% 적용`} />
          <Kpi
            label="최종 공헌이익"
            value={`₩${fmtC(metrics.finalCm)}`}
            sub={fmtPct(metrics.finalCmRate)}
            tone={metrics.finalCm > 0 ? 'pos' : 'neg'}
          />
          <Kpi label="Blended ROAS" value={`${fmt(metrics.blendedRoas)}%`} sub="총매출/광고비" />
          <Kpi
            label="광고 BE ROAS"
            value={`${fmt(metrics.adOnlyBeRoas)}%`}
            sub={roas >= metrics.adOnlyBeRoas ? '광고 단독 안전' : '광고 단독 적자'}
            tone={roas >= metrics.adOnlyBeRoas ? 'pos' : 'neg'}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 좌측 컨트롤 */}
          <aside className={`${PANEL} p-5 lg:col-span-3 space-y-6 h-fit`}>
            <div className="text-[11px] tracking-[0.2em] text-text-quaternary uppercase font-mono">
              기본 변수
            </div>

            <SliderWithHelp
              label="1차 공헌이익율"
              help="매출에서 제품 전체 변동비(원재료·포장·생산 변동비·채널수수료 등)를 차감한 비율. 광고비는 아직 빠지기 전."
              value={cm1}
              onChange={setCm1}
              min={20}
              max={80}
              suffix="%"
            />
            <SliderWithHelp
              label="광고 ROAS"
              help="광고 기여 매출 ÷ 광고비. 광고로만 발생한 매출의 효율."
              value={roas}
              onChange={setRoas}
              min={100}
              max={800}
              step={10}
              suffix="%"
            />
            <NumberInput
              label="광고 예산"
              help="기간 내 집행 광고비 총액. 숫자 직접 입력 가능."
              value={adBudget}
              onChange={setAdBudget}
              presets={[
                { label: '1천만', v: 10_000_000 },
                { label: '5천만', v: 50_000_000 },
                { label: '1억', v: 100_000_000 },
                { label: '5억', v: 500_000_000 },
              ]}
            />
            <NumberInput
              label="자연유입 매출"
              help="광고 없이 발생하는 매출 (검색·재구매·직접유입 등). 총매출 = 자연유입 + 광고매출."
              value={organicRevenue}
              onChange={setOrganicRevenue}
              presets={[
                { label: '0', v: 0 },
                { label: '1억', v: 100_000_000 },
                { label: '5억', v: 500_000_000 },
                { label: '10억', v: 1_000_000_000 },
              ]}
            />
            <SliderWithHelp
              label="목표 공헌이익율"
              help="달성하고자 하는 최종 공헌이익율 목표."
              value={targetMargin}
              onChange={setTargetMargin}
              min={5}
              max={45}
              suffix="%"
            />

            <div className="border-t border-border-primary pt-5 space-y-3">
              <div className="text-[11px] tracking-[0.2em] text-text-quaternary uppercase font-mono">
                계산 결과
              </div>
              <ResultRow label="광고 BE ROAS" value={`${fmt(metrics.adOnlyBeRoas)}%`} />
              <ResultRow
                label="실질 BE ROAS"
                value={`${fmt(Math.max(metrics.realBeRoas, 0))}%`}
                sub="자연유입 고려"
              />
              <ResultRow
                label="목표 달성 ROAS"
                value={
                  metrics.targetRoas !== null
                    ? `${fmt(Math.max(metrics.targetRoas, 0))}%`
                    : '달성 불가'
                }
                tone={metrics.targetRoas === null ? 'neg' : undefined}
              />
              <ResultRow label="현재 최종 공헌이익율" value={fmtPct(metrics.finalCmRate)} />
            </div>

            {tab === 'channel' && (
              <div className="border-t border-border-primary pt-5 space-y-4">
                <div className="text-[11px] tracking-[0.2em] text-text-quaternary uppercase font-mono">
                  채널별 설정
                </div>
                {channels.map((ch, idx) => (
                  <div key={idx} className="border-l-2 border-brand pl-3 space-y-2.5">
                    <input
                      value={ch.name}
                      onChange={(e) => updateChannel(idx, 'name', e.target.value)}
                      className="text-sm font-semibold bg-transparent border-b border-border-primary w-full focus:outline-none focus:border-brand text-text-primary pb-1 transition-colors"
                    />
                    <MiniSlider
                      label="수수료"
                      value={ch.fee}
                      onChange={(v) => updateChannel(idx, 'fee', v)}
                      min={0}
                      max={50}
                      step={0.1}
                      suffix="%"
                    />
                    <MiniSlider
                      label="반품율"
                      value={ch.returnRate}
                      onChange={(v) => updateChannel(idx, 'returnRate', v)}
                      min={0}
                      max={15}
                      step={0.1}
                      suffix="%"
                    />
                  </div>
                ))}
              </div>
            )}

            {tab === 'ltv' && (
              <div className="border-t border-border-primary pt-5 space-y-4">
                <div className="text-[11px] tracking-[0.2em] text-text-quaternary uppercase font-mono">
                  LTV 입력
                </div>
                <NumberInput
                  label="AOV"
                  help="Average Order Value. 주문 1건당 평균 결제금액. 총매출 ÷ 총주문수로 산출."
                  value={aov}
                  onChange={setAov}
                  presets={[
                    { label: '2만', v: 20_000 },
                    { label: '3.5만', v: 35_000 },
                    { label: '5만', v: 50_000 },
                    { label: '10만', v: 100_000 },
                  ]}
                />
                <NumberInput
                  label="CAC"
                  help="Customer Acquisition Cost. 신규 고객 1명을 확보하는 데 투입된 비용. 광고비 ÷ 신규고객수."
                  value={cac}
                  onChange={setCac}
                  presets={[
                    { label: '3천', v: 3_000 },
                    { label: '8천', v: 8_000 },
                    { label: '1.5만', v: 15_000 },
                    { label: '3만', v: 30_000 },
                  ]}
                />
                <SliderWithHelp
                  label="연간 재구매 횟수"
                  help="한 고객이 1년간 주문하는 평균 횟수. 재구매율이 높을수록 LTV가 기하급수적으로 커짐."
                  value={repurchase}
                  onChange={setRepurchase}
                  min={1}
                  max={12}
                  step={0.1}
                />
              </div>
            )}
          </aside>

          {/* 메인 패널 */}
          <section className="lg:col-span-9 space-y-6">
            <nav className={`${PANEL} flex gap-1 px-2 py-2`}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`font-mono text-xs tracking-wider px-4 py-2.5 rounded-lg transition-colors ${
                    tab === t.id
                      ? 'bg-brand/15 text-accent'
                      : 'text-text-tertiary hover:bg-white/[0.03] hover:text-text-primary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {tab === 'roas' && (
              <Panel
                title="ROAS와 공헌이익율의 관계"
                formula="최종 공헌이익율 = 1차공헌이익율 − 광고비/총매출  ·  총매출 = 자연유입 + ROAS×광고비"
                description="자연유입 매출이 섞이면 동일 ROAS에서도 실질 공헌이익율이 달라집니다. 자연유입이 커질수록 광고비가 총매출에서 차지하는 비중이 줄어 최종 공헌이익율이 개선됩니다."
              >
                <ResponsiveContainer width="100%" height={420}>
                  <LineChart
                    data={roasCurveData}
                    margin={{ top: 20, right: 30, left: 0, bottom: 40 }}
                    onMouseMove={(s) => {
                      const ap = (s as { activePayload?: Array<{ payload: Record<string, number> }> } | null)?.activePayload;
                      if (ap && ap[0]) {
                        const p = ap.find((pp) => (pp as { dataKey?: string }).dataKey === 'cmMid') ?? ap[0];
                        setRoasHover({ x: p.payload.roas, y: p.payload.cmMid });
                      }
                    }}
                    onMouseLeave={() => setRoasHover(null)}
                  >
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border-primary)" />
                    <XAxis
                      dataKey="roas"
                      stroke="var(--color-text-quaternary)"
                      tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                      tickFormatter={(v: number) => `${v}%`}
                      label={{ value: '광고 ROAS (%)', position: 'insideBottom', offset: -10, fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                    />
                    <YAxis
                      stroke="var(--color-text-quaternary)"
                      tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                      label={{ value: '최종 공헌이익율 (%)', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      height={36}
                      iconType="plainline"
                      wrapperStyle={{ fontSize: 11, color: 'var(--color-text-secondary)', paddingBottom: 12 }}
                    />
                    <Tooltip
                      cursor={{ stroke: 'var(--color-text-secondary)', strokeDasharray: '3 3', strokeOpacity: 0.7 }}
                      content={<RoasTooltip />}
                    />
                    <ReferenceLine y={0} stroke="var(--color-text-quaternary)" strokeWidth={1} />
                    <ReferenceLine
                      y={targetMargin}
                      stroke="var(--color-danger)"
                      strokeDasharray="4 4"
                      label={{ value: `목표 ${targetMargin}%`, fontSize: 10, fill: 'var(--color-danger)' }}
                    />
                    <ReferenceLine
                      x={roas}
                      stroke="var(--color-accent-hover)"
                      strokeDasharray="6 4"
                      label={{ value: `현재 ROAS ${roas}%`, fontSize: 10, fill: 'var(--color-accent-hover)', position: 'top' }}
                    />
                    {roasHover && (
                      <ReferenceLine
                        y={roasHover.y}
                        stroke="var(--color-text-secondary)"
                        strokeDasharray="3 3"
                        strokeOpacity={0.7}
                        ifOverflow="visible"
                      />
                    )}
                    <Line type="monotone" dataKey="cmLow" stroke="var(--color-text-quaternary)" strokeWidth={1.5} dot={false} name={`1차 공헌이익율 ${cm1 - 10}%`} />
                    <Line type="monotone" dataKey="cmMid" stroke="var(--color-accent-hover)" strokeWidth={2.5} dot={false} name={`1차 공헌이익율 ${cm1}% (기준)`} />
                    <Line type="monotone" dataKey="cmHigh" stroke="var(--color-success)" strokeWidth={1.5} dot={false} name={`1차 공헌이익율 ${cm1 + 10}%`} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <Tip title="자연유입 = 0일 때" body="기존 공식 최종 공헌이익율 = 1차공헌이익율 − 1/ROAS로 회귀. 광고에 100% 의존하는 상태." />
                  <Tip title="자연유입 ↑" body="동일 ROAS에서 최종 공헌이익율 상승. 광고 의존도가 낮을수록 수익구조가 견고." />
                  <Tip title="광고 ROAS ↓" body="자연유입이 충분하면 광고 ROAS가 떨어져도 전체 수익은 유지 가능." />
                </div>
              </Panel>
            )}

            {tab === 'budget' && (
              <Panel
                title="광고 예산 민감도"
                formula="최종 공헌이익 = (자연유입 + ROAS×예산) × 1차공헌이익율 − 예산"
                description="광고예산을 늘릴 때 매출과 최종 공헌이익이 어떻게 변하는지. X축 범위는 현재 예산의 0~2배로 자동 스케일됩니다."
              >
                <ResponsiveContainer width="100%" height={420}>
                  <AreaChart data={budgetSensitivity} margin={{ top: 20, right: 30, left: 10, bottom: 40 }}>
                    <defs>
                      <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-brand-bg)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-brand-bg)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gCm" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-accent-hover)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-accent-hover)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border-primary)" />
                    <XAxis
                      dataKey="budget"
                      tickFormatter={fmtC}
                      stroke="var(--color-text-quaternary)"
                      tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                      label={{ value: '광고예산 (원)', position: 'insideBottom', offset: -10, fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                    />
                    <YAxis
                      tickFormatter={fmtC}
                      stroke="var(--color-text-quaternary)"
                      tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                      width={70}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      height={36}
                      iconType="plainline"
                      wrapperStyle={{ fontSize: 11, color: 'var(--color-text-secondary)', paddingBottom: 12 }}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: number) => `₩${fmtC(v)}`}
                      labelFormatter={(v: number) => `예산 ₩${fmtC(v)}`}
                    />
                    <ReferenceLine y={0} stroke="var(--color-text-quaternary)" />
                    <ReferenceLine
                      x={adBudget}
                      stroke="var(--color-accent-hover)"
                      strokeDasharray="6 4"
                      label={{ value: `현재 예산 ₩${fmtC(adBudget)}`, fontSize: 10, fill: 'var(--color-accent-hover)', position: 'top' }}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="var(--color-brand-bg)" strokeWidth={1.5} fill="url(#gRev)" name="총매출 (자연+광고)" />
                    <Area type="monotone" dataKey="finalCm" stroke="var(--color-accent-hover)" strokeWidth={2} fill="url(#gCm)" name="최종 공헌이익" />
                  </AreaChart>
                </ResponsiveContainer>
              </Panel>
            )}

            {tab === 'channel' && (
              <Panel
                title="채널별 실질 수익성"
                formula="실공헌이익율 = 1차공헌이익율 − 채널수수료 − 반품손실율"
                description="좌측에서 각 채널의 수수료와 반품율을 자유롭게 조정하세요. 채널명도 클릭해서 바꾸실 수 있습니다. 널담의 실제 계약 조건으로 수정하시면 즉시 실무 비교용으로 사용 가능."
              >
                <ResponsiveContainer width="100%" height={420}>
                  <BarChart data={channelData} margin={{ top: 20, right: 30, left: 0, bottom: 40 }} layout="vertical">
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border-primary)" horizontal={false} />
                    <XAxis
                      type="number"
                      stroke="var(--color-text-quaternary)"
                      tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                      tickFormatter={(v: number) => `${v}%`}
                      label={{ value: '% of 매출', position: 'insideBottom', offset: -10, fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      stroke="var(--color-text-quaternary)"
                      tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                      width={80}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      height={36}
                      iconType="square"
                      wrapperStyle={{ fontSize: 11, color: 'var(--color-text-secondary)', paddingBottom: 12 }}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: number) => `${v}%`}
                      cursor={{ fill: 'rgba(130, 143, 255, 0.05)' }}
                    />
                    <Bar dataKey="수수료" stackId="a" fill="var(--color-border-secondary)" />
                    <Bar dataKey="반품손실" stackId="a" fill="var(--color-text-quaternary)" />
                    <Bar dataKey="실공헌이익율" stackId="a" fill="var(--color-brand-bg)" />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  {channelData.map((ch, i) => (
                    <div key={i} className="border-l-2 border-brand pl-3">
                      <div className="text-sm font-semibold text-text-primary">{ch.name}</div>
                      <div className="font-mono text-[11px] text-text-quaternary mt-1">
                        수수료 {ch['수수료']}% · 반품 {ch['반품손실']}%
                      </div>
                      <div
                        className={`font-mono text-lg font-semibold mt-1 ${
                          ch['실공헌이익율'] > 0 ? 'text-accent' : 'text-danger'
                        }`}
                      >
                        {ch['실공헌이익율'] > 0 ? `${ch['실공헌이익율']}%` : '적자'}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {tab === 'ltv' && (
              <Panel
                title="LTV / CAC Payback"
                formula={
                  <>
                    LTV = AOV × 재구매횟수 × 1차 공헌이익율
                    <br />
                    Payback = CAC ÷ 월평균 공헌이익
                  </>
                }
                description="신규 고객 한 명 확보에 투입한 CAC를 몇 개월 만에 회수하는지. 0선을 넘는 지점이 Payback Period."
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 text-xs">
                  <div className={`${SUBPANEL} p-4`}>
                    <div className="font-mono text-[10px] tracking-wider text-text-quaternary uppercase mb-1.5">
                      AOV — Average Order Value
                    </div>
                    <div className="text-text-secondary leading-relaxed">
                      주문 1건당 평균 결제금액. <span className="font-mono text-accent">총매출 ÷ 총주문수</span>로 계산.
                      번들 구성, 크로스셀, 무료배송 최소금액 설정 등으로 AOV를 올리면 광고 효율이 그대로 개선됩니다.
                    </div>
                  </div>
                  <div className={`${SUBPANEL} p-4`}>
                    <div className="font-mono text-[10px] tracking-wider text-text-quaternary uppercase mb-1.5">
                      CAC — Customer Acquisition Cost
                    </div>
                    <div className="text-text-secondary leading-relaxed">
                      신규 고객 1명을 확보하는 데 든 비용. <span className="font-mono text-accent">광고비 ÷ 신규고객수</span>로 계산.
                      CAC가 LTV의 1/3 이하여야 건강한 구조로 봅니다 (LTV/CAC ≥ 3).
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <MiniStat label="LTV" value={`₩${fmtC(ltv)}`} />
                  <MiniStat label="CAC" value={`₩${fmtC(cac)}`} />
                  <MiniStat
                    label="LTV / CAC"
                    value={`${ltvCac.toFixed(2)}x`}
                    tone={ltvCac >= 3 ? 'pos' : ltvCac >= 1 ? 'mid' : 'neg'}
                    note={ltvCac >= 3 ? '건강' : ltvCac >= 1 ? '주의' : '위험'}
                  />
                </div>

                <div className={`${SUBPANEL} p-4 mb-6 text-xs`}>
                  <div className="font-mono text-[10px] tracking-wider text-text-quaternary uppercase mb-1.5">
                    PAYBACK — 월 공헌이익 누적 방식
                  </div>
                  <div className="font-mono text-[11px] text-accent bg-bg-1 border border-border-primary inline-block px-2.5 py-1 rounded mb-2">
                    월 공헌이익 = AOV × 1차 공헌이익율 × (재구매 ÷ 12)
                  </div>
                  <div className="text-text-secondary leading-relaxed">
                    연간 재구매 횟수를 <span className="font-mono text-accent">12개월</span>로 분산해 매달 회수되는 공헌이익을 구합니다.
                    M0 시점에 <span className="font-mono text-danger">−CAC</span>에서 출발해 매월 월 공헌이익을 누적하며,
                    이 누적값이 <span className="font-mono text-accent">0선(Break-even)</span>을 넘는 지점이 <strong className="text-text-primary">Payback Period</strong>입니다.
                    현재 입력값 기준 월 공헌이익은 <span className="font-mono text-text-primary font-semibold">₩{fmtC((aov * (cm1 / 100) * repurchase) / 12)}</span>,
                    CAC <span className="font-mono text-text-primary font-semibold">₩{fmtC(cac)}</span> 회수에{' '}
                    {(() => {
                      const monthly = (aov * (cm1 / 100) * repurchase) / 12;
                      if (monthly <= 0) return <span className="font-mono text-danger font-semibold">계산 불가</span>;
                      const months = cac / monthly;
                      return (
                        <span className="font-mono text-text-primary font-semibold">
                          약 {months.toFixed(1)}개월
                        </span>
                      );
                    })()} 소요됩니다.
                  </div>
                </div>

                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={paybackData} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                    <defs>
                      <linearGradient id="gPay" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-brand-bg)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--color-brand-bg)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border-primary)" />
                    <XAxis
                      dataKey="month"
                      stroke="var(--color-text-quaternary)"
                      tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                    />
                    <YAxis
                      tickFormatter={fmtC}
                      stroke="var(--color-text-quaternary)"
                      tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                      width={60}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: number) => `₩${fmtC(v)}`}
                    />
                    <ReferenceLine
                      y={0}
                      stroke="var(--color-text-secondary)"
                      strokeWidth={1.5}
                      label={{ value: 'Break-even', fontSize: 10, fill: 'var(--color-text-secondary)', position: 'right' }}
                    />
                    <Area type="monotone" dataKey="cumulative" stroke="var(--color-brand-bg)" strokeWidth={2} fill="url(#gPay)" name="누적 공헌이익" />
                  </AreaChart>
                </ResponsiveContainer>
              </Panel>
            )}
          </section>
        </div>

        {/* 푸터 */}
        <div className={`${PANEL} mt-6 px-6 py-4 flex justify-between text-[11px] font-mono text-text-quaternary`}>
          <span>모든 수치는 입력 변수 기반 시뮬레이션입니다</span>
          <span>조인앤조인 CEO Dashboard</span>
        </div>
      </div>
    </main>
  );
}

// ───────────────────────────── Sub-components ─────────────────────────────

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'pos' | 'neg';
}) {
  const toneColor =
    tone === 'pos' ? 'text-success' : tone === 'neg' ? 'text-danger' : 'text-text-primary';
  return (
    <div>
      <div className="text-[11px] tracking-[0.2em] text-text-quaternary uppercase mb-2 font-mono">
        {label}
      </div>
      <div className={`text-2xl font-semibold tracking-tight ${toneColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-text-tertiary mt-1 font-mono">{sub}</div>}
    </div>
  );
}

function SliderWithHelp({
  label,
  help,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix = '',
  suffix = '',
}: {
  label: string;
  help?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex justify-between items-baseline mb-2">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-secondary">{label}</label>
          {help && (
            <button
              onClick={() => setOpen(!open)}
              className="w-3.5 h-3.5 rounded-full border border-border-secondary text-[9px] text-text-tertiary hover:bg-brand hover:text-white hover:border-brand transition-colors flex items-center justify-center font-mono"
              aria-label="설명"
            >
              ?
            </button>
          )}
        </div>
        <span className="font-mono text-sm font-semibold text-text-primary">
          {prefix}
          {typeof value === 'number' && value % 1 !== 0
            ? value.toFixed(1)
            : new Intl.NumberFormat('ko-KR').format(value)}
          {suffix}
        </span>
      </div>
      {open && help && (
        <div className="text-[11px] text-text-secondary bg-bg-0 border-l-2 border-brand rounded-r px-3 py-2 mb-2 leading-relaxed">
          {help}
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-brand"
      />
      <div className="flex justify-between font-mono text-[10px] text-text-quaternary mt-1">
        <span>
          {prefix}
          {new Intl.NumberFormat('ko-KR').format(min)}
          {suffix}
        </span>
        <span>
          {prefix}
          {new Intl.NumberFormat('ko-KR').format(max)}
          {suffix}
        </span>
      </div>
    </div>
  );
}

function MiniSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix = '',
  suffix = '',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <label className="text-[11px] text-text-tertiary">{label}</label>
        <span className="font-mono text-xs font-semibold text-text-primary">
          {prefix}
          {typeof value === 'number' && value % 1 !== 0 ? value.toFixed(1) : value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-brand"
      />
    </div>
  );
}

function NumberInput({
  label,
  help,
  value,
  onChange,
  presets = [],
}: {
  label: string;
  help?: string;
  value: number;
  onChange: (v: number) => void;
  presets?: { label: string; v: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tempValue, setTempValue] = useState('');

  const display = editing ? tempValue : new Intl.NumberFormat('ko-KR').format(value || 0);

  const fmtCompact = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 100_000_000) return `${(n / 100_000_000).toFixed(abs >= 1_000_000_000 ? 0 : 2)}억`;
    if (abs >= 10_000) return `${Math.round(n / 10_000)}만`;
    return new Intl.NumberFormat('ko-KR').format(n);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    setTempValue(raw);
  };

  const handleCommit = () => {
    const parsed = parseInt(tempValue || '0', 10);
    if (!isNaN(parsed)) onChange(parsed);
    setEditing(false);
  };

  const handleFocus = () => {
    setTempValue(String(value || 0));
    setEditing(true);
  };

  return (
    <div>
      <div className="flex justify-between items-baseline mb-2">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-secondary">{label}</label>
          {help && (
            <button
              onClick={() => setOpen(!open)}
              className="w-3.5 h-3.5 rounded-full border border-border-secondary text-[9px] text-text-tertiary hover:bg-brand hover:text-white hover:border-brand transition-colors flex items-center justify-center font-mono"
              aria-label="설명"
            >
              ?
            </button>
          )}
        </div>
        <span className="font-mono text-[10px] text-text-tertiary">{fmtCompact(value || 0)}</span>
      </div>
      {open && help && (
        <div className="text-[11px] text-text-secondary bg-bg-0 border-l-2 border-brand rounded-r px-3 py-2 mb-2 leading-relaxed">
          {help}
        </div>
      )}
      <div className="flex items-center border border-border-primary bg-bg-0 rounded-lg focus-within:border-brand focus-within:shadow-[0_0_0_1px_var(--color-brand-bg)] transition-all">
        <span className="text-text-quaternary text-sm px-2.5">₩</span>
        <input
          type="text"
          inputMode="numeric"
          value={display}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="font-mono text-sm font-semibold text-text-primary w-full py-2 pr-2.5 focus:outline-none bg-transparent text-right"
        />
      </div>
      {presets.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {presets.map((p, i) => (
            <button
              key={i}
              onClick={() => onChange(p.v)}
              className={`font-mono text-[10px] px-2 py-1 rounded border transition-colors ${
                value === p.v
                  ? 'border-brand bg-brand/15 text-accent'
                  : 'border-border-primary text-text-tertiary hover:border-brand hover:text-text-primary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neg';
}) {
  const toneColor = tone === 'neg' ? 'text-danger' : 'text-text-primary';
  return (
    <div className="flex justify-between items-baseline">
      <div>
        <div className="text-xs text-text-secondary">{label}</div>
        {sub && <div className="text-[10px] text-text-quaternary font-mono">{sub}</div>}
      </div>
      <span className={`font-mono text-sm font-semibold ${toneColor}`}>{value}</span>
    </div>
  );
}

function Panel({
  title,
  formula,
  description,
  children,
}: {
  title: string;
  formula: React.ReactNode;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-2.5">{title}</h2>
        <div className="font-mono text-[11px] bg-bg-0 border border-border-primary text-accent inline-block px-3 py-1.5 rounded-md mb-3 leading-relaxed">
          {formula}
        </div>
        <p className="text-sm text-text-tertiary leading-relaxed max-w-3xl">{description}</p>
      </div>
      <div className={`${PANEL} p-6`}>{children}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'mid';
  note?: string;
}) {
  const toneColor =
    tone === 'pos'
      ? 'text-success border-success'
      : tone === 'neg'
      ? 'text-danger border-danger'
      : tone === 'mid'
      ? 'text-warning border-warning'
      : 'text-text-primary border-brand';
  return (
    <div className={`border-l-2 pl-4 ${toneColor}`}>
      <div className="text-[11px] tracking-[0.15em] text-text-quaternary uppercase mb-1 font-mono">
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      {note && <div className="font-mono text-[10px] mt-1">{note}</div>}
    </div>
  );
}

function RoasTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-bg-1 border border-border-primary rounded-lg px-3 py-2.5 shadow-[0px_7px_32px_rgba(0,0,0,0.35)]">
      <div className="text-[11px] text-text-tertiary font-mono mb-2">
        광고 ROAS <span className="text-text-primary font-semibold">{label}%</span>
      </div>
      <div className="text-[10px] tracking-[0.12em] text-text-quaternary uppercase font-mono mb-1.5">
        최종 공헌이익율
      </div>
      <div className="space-y-1">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-6 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-0.5"
                style={{ background: p.color }}
              />
              <span className="text-text-secondary">{p.name}</span>
            </div>
            <span className="font-semibold" style={{ color: p.color }}>
              {p.value.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tip({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-t-2 border-brand pt-3">
      <div className="font-mono text-[10px] tracking-wider text-text-quaternary uppercase mb-1">
        {title}
      </div>
      <div className="text-xs text-text-secondary leading-relaxed">{body}</div>
    </div>
  );
}
