'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';

// ---------------------------------------------------------------------------
// Constants & API helpers
// ---------------------------------------------------------------------------
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Target {
  id: string;
  department?: string;
  year: number;
  title: string;
  manager: string;
  kpi_type: string;
  grid_data: string[][];
  created_at: string;
}

interface Sale {
  id: string;
  year: number;
  month: number;
  title: string;
  manager: string;
  kpi_type: string;
  grid_data: string[][];
  created_at: string;
}

interface ByManagerValues {
  [key: string]: number | undefined;
}

interface ByManagerMap {
  [manager: string]: ByManagerValues;
}

interface ManagerTargetVsActual {
  manager: string;
  targetSales: number;
  actualSales: number;
  salesRate: number;
  targetQuantity: number;
  actualQuantity: number;
  quantityRate: number;
  targetContribution: number;
  actualContribution: number;
  contributionRate: number;
  targetAdvertising: number;
  actualAdvertising: number;
}

interface ChannelAchievement {
  manager: string;
  channel: string;
  targetValue: number;
  actualValue: number;
  rate: number;
  achieved: boolean;
}

interface ManagerEntryStatus {
  manager: string;
  lastEntryDay: number;
  requiredDay: number;
  isNormal: boolean;
  missingDays: number;
}

interface ChannelSuggestion {
  channel: string;
  rate: number;
  suggestion: string;
}

interface EmailSchedule {
  id?: string;
  recipients: string;
  days: number[];
  time: string;
  enabled: boolean;
}

interface ReportSectionProps {
  selectedYear: number;
  selectedMonth: number | null;
  excludeVat?: boolean;
}

// ---------------------------------------------------------------------------
// Day-of-week labels
// ---------------------------------------------------------------------------
const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

// ---------------------------------------------------------------------------
// Channel suggestion mapping
// ---------------------------------------------------------------------------
const CHANNEL_SUGGESTIONS: Record<string, { base: string; underperform: string; overperform: string }> = {
  '스마트스토어': {
    base: '스마트스토어 키워드 광고 ROI 분석 및 상위노출 키워드 최적화 필요',
    underperform: '스마트스토어 키워드 광고 ROI가 저조합니다. 긴급히 상위노출 키워드 재설정 및 광고비 재배분이 필요합니다.',
    overperform: '스마트스토어 성과가 우수합니다. 광고 예산 확대 및 추가 키워드 확장을 통해 성장세를 가속화하세요.',
  },
  '쿠팡': {
    base: '쿠팡 로켓배송 입점율 확대 및 쿠팡 광고 효율 개선 검토',
    underperform: '쿠팡 실적이 목표 대비 크게 미달합니다. 로켓배송 입점 확대 및 쿠팡 광고 키워드 전면 재검토가 시급합니다.',
    overperform: '쿠팡 채널 성과가 매우 우수합니다. 로켓배송 SKU 확대 및 프로모션 강화로 매출 극대화를 추진하세요.',
  },
  '11번가': {
    base: '11번가 딜 프로모션 참여율 확대 및 가격경쟁력 점검',
    underperform: '11번가 성과가 부진합니다. 딜 프로모션 적극 참여 및 경쟁사 가격 대비 포지셔닝 재점검이 필요합니다.',
    overperform: '11번가 실적이 목표를 초과했습니다. 프리미엄 딜 및 브랜드관 입점으로 매출 채널을 확장하세요.',
  },
  '카페24': {
    base: '자사몰 유입 트래픽 분석 및 리타겟팅 광고 효율화',
    underperform: '자사몰(카페24) 유입이 저조합니다. 리타겟팅 광고 세팅 점검 및 SNS/검색 유입 채널 다각화가 필요합니다.',
    overperform: '자사몰 성과가 우수합니다. 자사몰 전용 프로모션 및 멤버십 혜택 강화로 충성 고객 확보에 집중하세요.',
  },
  '올리브영': {
    base: '올리브영 매대 위치 및 프로모션 기획 강화',
    underperform: '올리브영 실적이 저조합니다. 매대 위치 재협상 및 올리브영 전용 기획세트 출시를 검토하세요.',
    overperform: '올리브영 채널이 호조세입니다. 입점 매장 확대 및 시즌 한정 기획세트로 추가 성장을 도모하세요.',
  },
  '카카오': {
    base: '카카오 선물하기/톡스토어 시즌 프로모션 기획',
    underperform: '카카오 채널 실적이 미달입니다. 선물하기 상위 노출 전략 및 톡스토어 시즌 프로모션 기획이 시급합니다.',
    overperform: '카카오 채널이 우수한 성과를 보이고 있습니다. 시즌 프로모션 확대 및 카카오 광고 투자 증대를 권장합니다.',
  },
};

// ---------------------------------------------------------------------------
// Utility: parse numeric string
// ---------------------------------------------------------------------------
function parseNum(val: string | undefined | null): number {
  if (!val) return 0;
  const cleaned = String(val).replace(/,/g, '').trim();
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

// ---------------------------------------------------------------------------
// Utility: format number Korean style
// ---------------------------------------------------------------------------
function formatKRW(num: number): string {
  return new Intl.NumberFormat('ko-KR').format(Math.round(num));
}

// ---------------------------------------------------------------------------
// Utility: get achievement color class
// ---------------------------------------------------------------------------
function rateColorClass(rate: number): string {
  if (rate >= 100) return 'text-emerald-600';
  if (rate >= 80) return 'text-orange-500';
  return 'text-red-500';
}

function rateBgClass(rate: number): string {
  if (rate >= 100) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (rate >= 80) return 'bg-orange-50 text-orange-700 border-orange-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

// ---------------------------------------------------------------------------
// Utility: get channel suggestion
// ---------------------------------------------------------------------------
function getChannelSuggestion(channelName: string, rate: number): string {
  for (const [keyword, suggestions] of Object.entries(CHANNEL_SUGGESTIONS)) {
    if (channelName.includes(keyword)) {
      if (rate < 80) return suggestions.underperform;
      if (rate > 120) return suggestions.overperform;
      return suggestions.base;
    }
  }
  // Fallback for unknown channels
  if (rate < 80) return `${channelName} 채널의 실적이 목표 대비 저조합니다. 채널별 마케팅 전략 재수립 및 프로모션 강화가 필요합니다.`;
  if (rate > 120) return `${channelName} 채널이 목표를 크게 초과하고 있습니다. 투자 확대 및 성공 요인 분석을 통해 타 채널에도 적용하세요.`;
  return `${channelName} 채널의 현재 실적을 유지하면서 추가 성장 기회를 모색하세요.`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ReportSection({ selectedYear, selectedMonth, excludeVat = false }: ReportSectionProps) {
  // Panel visibility
  const [isExpanded, setIsExpanded] = useState(false);
  const [isReportGenerated, setIsReportGenerated] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Raw data
  const [targets, setTargets] = useState<Target[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [targetByManager, setTargetByManager] = useState<ByManagerMap>({});
  const [salesByManager, setSalesByManager] = useState<ByManagerMap>({});

  // Email scheduling
  const [schedules, setSchedules] = useState<EmailSchedule[]>([]);
  const [scheduleForm, setScheduleForm] = useState<EmailSchedule>({
    recipients: '',
    days: [1], // Monday default
    time: '09:00',
    enabled: true,
  });
  const [editingScheduleIdx, setEditingScheduleIdx] = useState<number | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSendResult, setEmailSendResult] = useState<string | null>(null);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // PDF download
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // Email recipients for immediate send
  const [emailRecipients, setEmailRecipients] = useState('');
  const [showEmailInput, setShowEmailInput] = useState(false);

  // Ref for print area
  const reportRef = useRef<HTMLDivElement>(null);

  // Effective month for report (fall back to current month)
  const effectiveMonth = selectedMonth ?? new Date().getMonth() + 1;

  // Yesterday's day number for entry tracking
  const yesterday = useMemo(() => {
    const today = new Date();
    // If we're looking at a different month/year, use last day of that month
    if (selectedYear !== today.getFullYear() || effectiveMonth !== today.getMonth() + 1) {
      // For past months, use the total days in that month
      const daysInMonth = new Date(selectedYear, effectiveMonth, 0).getDate();
      return daysInMonth;
    }
    const day = today.getDate() - 1;
    return day < 1 ? 1 : day;
  }, [selectedYear, effectiveMonth]);

  const daysInMonth = useMemo(() => {
    return new Date(selectedYear, effectiveMonth, 0).getDate();
  }, [selectedYear, effectiveMonth]);

  // VAT helper
  const applyVat = useCallback((value: number) => {
    return excludeVat ? Math.round(value / 1.1) : value;
  }, [excludeVat]);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------
  const fetchAllData = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const [targetsRes, salesRes, targetChartRes, salesChartRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/targets/?year=${selectedYear}`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/api/targets/sales/list?year=${selectedYear}&month=${effectiveMonth}`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/api/targets/chart/by-manager?year=${selectedYear}&month=${effectiveMonth}`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/api/targets/sales/chart/by-manager?year=${selectedYear}&month=${effectiveMonth}`, { headers: getAuthHeaders() }),
      ]);

      // Targets
      if (targetsRes.status === 'fulfilled' && targetsRes.value.ok) {
        const data = await targetsRes.value.json();
        setTargets(Array.isArray(data) ? data : []);
      } else {
        setTargets([]);
      }

      // Sales
      if (salesRes.status === 'fulfilled' && salesRes.value.ok) {
        const data = await salesRes.value.json();
        setSales(Array.isArray(data) ? data : []);
      } else {
        setSales([]);
      }

      // Target by manager
      if (targetChartRes.status === 'fulfilled' && targetChartRes.value.ok) {
        const data = await targetChartRes.value.json();
        setTargetByManager(data.by_manager || {});
      } else {
        setTargetByManager({});
      }

      // Sales + target by manager
      if (salesChartRes.status === 'fulfilled' && salesChartRes.value.ok) {
        const data = await salesChartRes.value.json();
        setSalesByManager(data.sales?.by_manager || {});
        // Merge target data if the first target endpoint failed
        if (Object.keys(targetByManager).length === 0 && data.targets?.by_manager) {
          setTargetByManager(data.targets.by_manager);
        }
      } else {
        setSalesByManager({});
      }

      setIsReportGenerated(true);
    } catch (err) {
      console.error('Failed to fetch report data:', err);
      setError('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsGenerating(false);
    }
  }, [selectedYear, effectiveMonth]);

  // Fetch schedules when expanded
  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/targets/report/schedules`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setSchedules(Array.isArray(data) ? data : []);
      }
    } catch {
      // Schedules endpoint may not exist yet; silently ignore
    }
  }, []);

  useEffect(() => {
    if (isExpanded) {
      fetchSchedules();
    }
  }, [isExpanded, fetchSchedules]);

  // -----------------------------------------------------------------------
  // Computed report data
  // -----------------------------------------------------------------------

  // a) Manager target vs actual
  const managerComparisons = useMemo<ManagerTargetVsActual[]>(() => {
    const allManagers = new Set([
      ...Object.keys(targetByManager),
      ...Object.keys(salesByManager),
    ]);

    return Array.from(allManagers).sort().map((manager) => {
      const t = targetByManager[manager] || {};
      const s = salesByManager[manager] || {};

      const targetSales = (t['매출'] as number) || 0;
      const actualSales = (s['매출'] as number) || 0;
      const targetQuantity = (t['판매량'] as number) || 0;
      const actualQuantity = (s['판매량'] as number) || 0;
      const targetContribution = (t['공헌이익'] as number) || 0;
      const actualContribution = (s['공헌이익'] as number) || 0;
      const targetAdvertising = (t['광고선전비'] as number) || 0;
      const actualAdvertising = (s['광고선전비'] as number) || (s['마케팅비'] as number) || 0;

      return {
        manager,
        targetSales,
        actualSales,
        salesRate: targetSales > 0 ? (actualSales / targetSales) * 100 : 0,
        targetQuantity,
        actualQuantity,
        quantityRate: targetQuantity > 0 ? (actualQuantity / targetQuantity) * 100 : 0,
        targetContribution,
        actualContribution,
        contributionRate: targetContribution > 0 ? (actualContribution / targetContribution) * 100 : 0,
        targetAdvertising,
        actualAdvertising,
      };
    });
  }, [targetByManager, salesByManager]);

  // Summary totals
  const summaryTotals = useMemo(() => {
    const totals = managerComparisons.reduce(
      (acc, mc) => ({
        targetSales: acc.targetSales + mc.targetSales,
        actualSales: acc.actualSales + mc.actualSales,
        targetQuantity: acc.targetQuantity + mc.targetQuantity,
        actualQuantity: acc.actualQuantity + mc.actualQuantity,
        targetContribution: acc.targetContribution + mc.targetContribution,
        actualContribution: acc.actualContribution + mc.actualContribution,
        targetAdvertising: acc.targetAdvertising + mc.targetAdvertising,
        actualAdvertising: acc.actualAdvertising + mc.actualAdvertising,
      }),
      {
        targetSales: 0, actualSales: 0,
        targetQuantity: 0, actualQuantity: 0,
        targetContribution: 0, actualContribution: 0,
        targetAdvertising: 0, actualAdvertising: 0,
      }
    );

    return {
      ...totals,
      salesRate: totals.targetSales > 0 ? (totals.actualSales / totals.targetSales) * 100 : 0,
      quantityRate: totals.targetQuantity > 0 ? (totals.actualQuantity / totals.targetQuantity) * 100 : 0,
      contributionRate: totals.targetContribution > 0 ? (totals.actualContribution / totals.targetContribution) * 100 : 0,
    };
  }, [managerComparisons]);

  // b) Channel achievement by manager
  const channelAchievements = useMemo<ChannelAchievement[]>(() => {
    const results: ChannelAchievement[] = [];

    // Get unique managers from both targets and sales
    const managerSet = new Set<string>();
    targets.forEach((t) => managerSet.add(t.manager));
    sales.forEach((s) => managerSet.add(s.manager));

    for (const manager of Array.from(managerSet).sort()) {
      // Find target grid_data for this manager's 매출 kpi
      const managerTargets = targets.filter(
        (t) => t.manager === manager && t.kpi_type === '매출'
      );
      const managerSales = sales.filter(
        (s) => s.manager === manager && s.kpi_type === '매출'
      );

      // Build channel -> target value map for the selected month
      const channelTargetMap: Record<string, number> = {};
      for (const target of managerTargets) {
        if (target.grid_data && target.grid_data.length > 0) {
          for (const row of target.grid_data) {
            if (!row || row.length === 0) continue;
            const channelLabel = row[0];
            if (!channelLabel) continue;
            // Monthly targets: index effectiveMonth corresponds to the month value
            const monthIdx = effectiveMonth; // column index (1-based)
            const value = parseNum(row[monthIdx]);
            channelTargetMap[channelLabel] = (channelTargetMap[channelLabel] || 0) + value;
          }
        }
      }

      // Build channel -> actual value map
      // Sales grid_data has daily values: [channel, day1, day2, ..., day31]
      const channelActualMap: Record<string, number> = {};
      for (const sale of managerSales) {
        if (sale.grid_data && sale.grid_data.length > 0) {
          for (const row of sale.grid_data) {
            if (!row || row.length === 0) continue;
            const channelLabel = row[0];
            if (!channelLabel) continue;
            // Sum all daily values
            let total = 0;
            for (let i = 1; i < row.length; i++) {
              total += parseNum(row[i]);
            }
            channelActualMap[channelLabel] = (channelActualMap[channelLabel] || 0) + total;
          }
        }
      }

      // Merge channels
      const allChannels = new Set([
        ...Object.keys(channelTargetMap),
        ...Object.keys(channelActualMap),
      ]);

      for (const channel of Array.from(allChannels)) {
        const targetVal = channelTargetMap[channel] || 0;
        const actualVal = channelActualMap[channel] || 0;
        const rate = targetVal > 0 ? (actualVal / targetVal) * 100 : (actualVal > 0 ? 999 : 0);

        results.push({
          manager,
          channel,
          targetValue: targetVal,
          actualValue: actualVal,
          rate,
          achieved: rate >= 100,
        });
      }
    }

    return results;
  }, [targets, sales, effectiveMonth]);

  // c) Manager data entry status
  const managerEntryStatuses = useMemo<ManagerEntryStatus[]>(() => {
    const statuses: ManagerEntryStatus[] = [];

    // Group sales by manager
    const managerSalesMap: Record<string, Sale[]> = {};
    for (const sale of sales) {
      if (!managerSalesMap[sale.manager]) {
        managerSalesMap[sale.manager] = [];
      }
      managerSalesMap[sale.manager].push(sale);
    }

    // Also include managers from targets who might not have sales yet
    for (const target of targets) {
      if (!managerSalesMap[target.manager]) {
        managerSalesMap[target.manager] = [];
      }
    }

    for (const [manager, managerSalesList] of Object.entries(managerSalesMap)) {
      let maxDay = 0;

      for (const sale of managerSalesList) {
        if (sale.grid_data && sale.grid_data.length > 0) {
          for (const row of sale.grid_data) {
            if (!row || row.length <= 1) continue;
            // Find last non-zero column (1-indexed = day)
            for (let i = row.length - 1; i >= 1; i--) {
              if (parseNum(row[i]) !== 0) {
                if (i > maxDay) maxDay = i;
                break;
              }
            }
          }
        }
      }

      const isNormal = maxDay >= yesterday;
      const missingDays = maxDay >= yesterday ? 0 : yesterday - maxDay;

      statuses.push({
        manager,
        lastEntryDay: maxDay,
        requiredDay: yesterday,
        isNormal,
        missingDays,
      });
    }

    return statuses.sort((a, b) => a.manager.localeCompare(b.manager));
  }, [sales, targets, yesterday]);

  // d) Flagged managers (미입력)
  const missingEntryManagers = useMemo(() => {
    return managerEntryStatuses.filter((s) => !s.isNormal);
  }, [managerEntryStatuses]);

  // e) Channel suggestions
  const channelSuggestions = useMemo<ChannelSuggestion[]>(() => {
    // Aggregate channels across all managers
    const channelMap: Record<string, { totalTarget: number; totalActual: number }> = {};

    for (const ca of channelAchievements) {
      if (!channelMap[ca.channel]) {
        channelMap[ca.channel] = { totalTarget: 0, totalActual: 0 };
      }
      channelMap[ca.channel].totalTarget += ca.targetValue;
      channelMap[ca.channel].totalActual += ca.actualValue;
    }

    return Object.entries(channelMap)
      .map(([channel, { totalTarget, totalActual }]) => {
        const rate = totalTarget > 0 ? (totalActual / totalTarget) * 100 : (totalActual > 0 ? 999 : 0);
        return {
          channel,
          rate,
          suggestion: getChannelSuggestion(channel, rate),
        };
      })
      .sort((a, b) => a.rate - b.rate);
  }, [channelAchievements]);

  // Chart data for achievement rate bar
  const achievementChartData = useMemo(() => {
    return managerComparisons.map((mc) => ({
      name: mc.manager,
      매출달성률: Math.round(mc.salesRate * 10) / 10,
      판매량달성률: Math.round(mc.quantityRate * 10) / 10,
      공헌이익달성률: Math.round(mc.contributionRate * 10) / 10,
    }));
  }, [managerComparisons]);

  // -----------------------------------------------------------------------
  // Build standalone HTML for PDF / email
  // -----------------------------------------------------------------------
  const buildReportHTML = useCallback(() => {
    const rc = (rate: number) => (rate >= 100 ? '#10b981' : rate >= 80 ? '#f59e0b' : '#ef4444');
    const rbg = (rate: number) => (rate >= 100 ? '#ecfdf5' : rate >= 80 ? '#fffbeb' : '#fef2f2');
    const rbd = (rate: number) => (rate >= 100 ? '#a7f3d0' : rate >= 80 ? '#fde68a' : '#fecaca');

    // --- Manager comparison rows ---
    let mgrRows = '';
    for (const mc of managerComparisons) {
      mgrRows += `<tr>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;font-weight:600;color:#1e293b">${mc.manager}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;color:#475569">${formatKRW(applyVat(mc.targetSales))}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;color:#475569">${formatKRW(applyVat(mc.actualSales))}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:${rc(mc.salesRate)}">${mc.salesRate.toFixed(1)}%</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;color:#475569">${formatKRW(mc.targetQuantity)}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;color:#475569">${formatKRW(mc.actualQuantity)}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:${rc(mc.quantityRate)}">${mc.quantityRate.toFixed(1)}%</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;color:#475569">${formatKRW(applyVat(mc.targetContribution))}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;color:#475569">${formatKRW(applyVat(mc.actualContribution))}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:${rc(mc.contributionRate)}">${mc.contributionRate.toFixed(1)}%</td>
      </tr>`;
    }
    const sumRow = `<tr style="background:#f5f3ff;font-weight:700;border-top:2px solid #94a3b8">
      <td style="padding:10px 12px;border:1px solid #e2e8f0;color:#1e293b">합계</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right">${formatKRW(applyVat(summaryTotals.targetSales))}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right">${formatKRW(applyVat(summaryTotals.actualSales))}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;color:${rc(summaryTotals.salesRate)}">${summaryTotals.salesRate.toFixed(1)}%</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right">${formatKRW(summaryTotals.targetQuantity)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right">${formatKRW(summaryTotals.actualQuantity)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;color:${rc(summaryTotals.quantityRate)}">${summaryTotals.quantityRate.toFixed(1)}%</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right">${formatKRW(applyVat(summaryTotals.targetContribution))}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right">${formatKRW(applyVat(summaryTotals.actualContribution))}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;color:${rc(summaryTotals.contributionRate)}">${summaryTotals.contributionRate.toFixed(1)}%</td>
    </tr>`;

    // --- CSS bar chart ---
    let bars = '';
    for (const mc of managerComparisons) {
      const w = Math.min(mc.salesRate, 150);
      bars += `<div style="display:flex;align-items:center;margin-bottom:8px">
        <div style="width:80px;font-size:13px;font-weight:600;color:#334155;flex-shrink:0">${mc.manager}</div>
        <div style="flex:1;display:flex;align-items:center;gap:4px">
          <div style="height:20px;width:${w}%;background:${rc(mc.salesRate)};border-radius:4px;min-width:2px"></div>
          <span style="font-size:12px;font-weight:600;color:${rc(mc.salesRate)}">${mc.salesRate.toFixed(1)}%</span>
        </div>
      </div>`;
    }

    // --- Channel by manager ---
    const groupedCh: Record<string, ChannelAchievement[]> = {};
    for (const ca of channelAchievements) {
      if (!groupedCh[ca.manager]) groupedCh[ca.manager] = [];
      groupedCh[ca.manager].push(ca);
    }
    let chSections = '';
    for (const [manager, channels] of Object.entries(groupedCh).sort(([a], [b]) => a.localeCompare(b))) {
      let chRows = '';
      for (const ch of (channels as ChannelAchievement[]).sort((a, b) => a.rate - b.rate)) {
        const stBg = ch.rate >= 100 ? '#ecfdf5' : '#fef2f2';
        const stC = ch.rate >= 100 ? '#059669' : '#dc2626';
        const stT = ch.rate >= 100 ? '달성' : '미달성';
        chRows += `<tr>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;color:#334155">${ch.channel}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;color:#475569">${formatKRW(applyVat(ch.targetValue))}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;color:#475569">${formatKRW(applyVat(ch.actualValue))}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:${rc(ch.rate)}">${ch.rate > 900 ? '-' : ch.rate.toFixed(1) + '%'}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center">
            <span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${stBg};color:${stC}">${stT}</span>
          </td>
        </tr>`;
      }
      chSections += `<div style="margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <div style="padding:10px 14px;background:#eff6ff;border-bottom:1px solid #e2e8f0">
          <strong style="color:#334155;font-size:14px">${manager}</strong>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f8fafc">
            <th style="text-align:left;padding:8px 12px;border:1px solid #e2e8f0;color:#64748b;font-weight:600">채널</th>
            <th style="text-align:right;padding:8px 12px;border:1px solid #e2e8f0;color:#64748b;font-weight:600">목표</th>
            <th style="text-align:right;padding:8px 12px;border:1px solid #e2e8f0;color:#64748b;font-weight:600">실적</th>
            <th style="text-align:right;padding:8px 12px;border:1px solid #e2e8f0;color:#64748b;font-weight:600">달성률</th>
            <th style="text-align:center;padding:8px 12px;border:1px solid #e2e8f0;color:#64748b;font-weight:600">상태</th>
          </tr></thead>
          <tbody>${chRows}</tbody>
        </table>
      </div>`;
    }

    // --- Entry status ---
    let entryRows = '';
    for (const st of managerEntryStatuses) {
      const stBg = st.isNormal ? '#ecfdf5' : '#fef2f2';
      const stC = st.isNormal ? '#059669' : '#dc2626';
      const stT = st.isNormal ? '정상' : '미입력';
      entryRows += `<tr>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600;color:#1e293b">${st.manager}</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center;color:#475569">${st.lastEntryDay > 0 ? st.lastEntryDay + '일' : '입력 없음'}</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center;color:#475569">${st.requiredDay}일</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:${st.missingDays > 0 ? '#ef4444' : '#94a3b8'}">${st.missingDays > 0 ? st.missingDays + '일' : '-'}</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center">
          <span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${stBg};color:${stC}">${stT}</span>
        </td>
      </tr>`;
    }

    // --- Missing entry warnings ---
    let warnCards = '';
    for (const st of missingEntryManagers) {
      warnCards += `<div style="display:inline-block;width:calc(33% - 12px);min-width:200px;margin:4px;padding:14px;border:1px solid #fecaca;border-radius:8px;background:#fff;vertical-align:top">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span style="font-weight:700;color:#dc2626;font-size:14px">${st.manager.charAt(0)}</span>
          </div>
          <div>
            <div style="font-weight:600;color:#1e293b;font-size:14px">${st.manager}</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px">마지막 입력일: ${st.lastEntryDay > 0 ? effectiveMonth + '월 ' + st.lastEntryDay + '일' : '입력 없음'}</div>
            <div style="font-size:12px;color:#dc2626;font-weight:600;margin-top:2px">미입력 일수: ${st.missingDays}일</div>
          </div>
        </div>
      </div>`;
    }

    // --- Channel suggestions ---
    let sugCards = '';
    for (const cs of channelSuggestions) {
      const rateText = cs.rate > 900 ? '목표 미설정' : `달성률 ${cs.rate.toFixed(1)}%`;
      sugCards += `<div style="padding:14px;border:1px solid ${rbd(cs.rate)};border-radius:8px;background:${rbg(cs.rate)};margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-weight:700;color:${rc(cs.rate)};font-size:14px">${cs.channel}</span>
          <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:${rbd(cs.rate)};color:${rc(cs.rate)}">${rateText}</span>
        </div>
        <p style="font-size:13px;line-height:1.5;color:#334155;margin:0">${cs.suggestion}</p>
      </div>`;
    }

    const now = new Date().toLocaleString('ko-KR');
    const vatNote = excludeVat ? ' | 부가세 별도 기준' : '';
    const thStyle = 'text-align:right;padding:10px 12px;border:1px solid #e2e8f0;color:#475569;font-weight:700';

    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1e293b;max-width:100%;padding:24px;font-size:13px;line-height:1.6">
      <!-- PAGE 1 -->
      <div style="page-break-after:always">
        <div style="text-align:center;padding-bottom:20px;border-bottom:3px solid #6366f1;margin-bottom:24px">
          <h1 style="font-size:22px;font-weight:800;color:#1e1b4b;margin:0 0 6px 0">${selectedYear}년 ${effectiveMonth}월 목표 달성 현황 리포트</h1>
          <p style="font-size:13px;color:#64748b;margin:0">생성일시: ${now}${vatNote}</p>
        </div>
        <div style="margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
            <div style="width:4px;height:20px;border-radius:2px;background:#7c3aed"></div>
            <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0">1. 담당자별 목표 vs 실적 현황</h2>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:#f5f3ff">
              <th style="text-align:left;padding:10px 12px;border:1px solid #e2e8f0;color:#475569;font-weight:700">담당자</th>
              <th style="${thStyle}">목표매출</th><th style="${thStyle}">실적매출</th><th style="${thStyle}">매출달성률</th>
              <th style="${thStyle}">목표판매량</th><th style="${thStyle}">실적판매량</th><th style="${thStyle}">판매량달성률</th>
              <th style="${thStyle}">목표공헌이익</th><th style="${thStyle}">실적공헌이익</th><th style="${thStyle}">공헌이익달성률</th>
            </tr></thead>
            <tbody>${mgrRows}${sumRow}</tbody>
          </table>
        </div>
        <div style="margin-top:20px;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
          <h3 style="font-size:14px;font-weight:700;color:#334155;margin:0 0 12px 0">매출 달성률 차트</h3>
          ${bars}
          <div style="display:flex;gap:16px;margin-top:10px;font-size:11px;color:#64748b">
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#10b981;margin-right:4px"></span>100% 이상</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#f59e0b;margin-right:4px"></span>80~99%</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ef4444;margin-right:4px"></span>80% 미만</span>
          </div>
        </div>
      </div>

      <!-- PAGE 2 -->
      <div style="page-break-after:always">
        <div style="margin-bottom:24px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
            <div style="width:4px;height:20px;border-radius:2px;background:#3b82f6"></div>
            <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0">2. 채널별 달성/미달성 현황</h2>
          </div>
          ${chSections || '<div style="padding:20px;text-align:center;color:#94a3b8;background:#f8fafc;border-radius:8px">데이터 없음</div>'}
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
            <div style="width:4px;height:20px;border-radius:2px;background:#f59e0b"></div>
            <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0">3. 담당자별 데이터 입력 현황</h2>
          </div>
          <p style="font-size:12px;color:#64748b;margin:0 0 10px 0">기준일: ${selectedYear}년 ${effectiveMonth}월 ${yesterday}일까지 입력 필요</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#fffbeb">
              <th style="text-align:left;padding:8px 12px;border:1px solid #e2e8f0;color:#475569;font-weight:700">담당자</th>
              <th style="text-align:center;padding:8px 12px;border:1px solid #e2e8f0;color:#475569;font-weight:700">마지막 입력일</th>
              <th style="text-align:center;padding:8px 12px;border:1px solid #e2e8f0;color:#475569;font-weight:700">요구 입력일</th>
              <th style="text-align:center;padding:8px 12px;border:1px solid #e2e8f0;color:#475569;font-weight:700">미입력 일수</th>
              <th style="text-align:center;padding:8px 12px;border:1px solid #e2e8f0;color:#475569;font-weight:700">상태</th>
            </tr></thead>
            <tbody>${entryRows}</tbody>
          </table>
        </div>
      </div>

      <!-- PAGE 3 -->
      <div>
        ${missingEntryManagers.length > 0 ? `<div style="margin-bottom:24px">
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;overflow:hidden">
            <div style="padding:14px 16px;border-bottom:1px solid #fecaca;display:flex;align-items:center;gap:8px">
              <span style="font-size:18px;color:#dc2626">&#9888;</span>
              <h2 style="font-size:16px;font-weight:700;color:#991b1b;margin:0">4. 미입력자 경고</h2>
              <span style="padding:2px 10px;background:#fee2e2;color:#dc2626;border-radius:999px;font-size:12px;font-weight:700">${missingEntryManagers.length}명</span>
            </div>
            <div style="padding:14px">${warnCards}</div>
          </div>
        </div>` : ''}
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
            <div style="width:4px;height:20px;border-radius:2px;background:#10b981"></div>
            <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0">${missingEntryManagers.length > 0 ? '5' : '4'}. 채널별 개선 아이디어</h2>
          </div>
          ${sugCards || '<div style="padding:20px;text-align:center;color:#94a3b8;background:#f8fafc;border-radius:8px">데이터 없음</div>'}
        </div>
        <div style="margin-top:30px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center">
          <p style="font-size:11px;color:#94a3b8;margin:0">이 리포트는 Nuldam Analytics에서 자동 생성되었습니다.</p>
        </div>
      </div>
    </div>`;
  }, [managerComparisons, summaryTotals, channelAchievements, managerEntryStatuses, missingEntryManagers, channelSuggestions, selectedYear, effectiveMonth, yesterday, excludeVat, applyVat]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  const handleGenerateReport = async () => {
    await fetchAllData();
  };

  const handlePrintReport = async () => {
    setIsDownloadingPdf(true);
    try {
      const html = buildReportHTML();
      const container = document.createElement('div');
      container.innerHTML = html;
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '0';
      document.body.appendChild(container);

      const html2pdf = (await import('html2pdf.js')).default;
      await html2pdf().set({
        margin: [10, 8, 10, 8],
        filename: `영업리포트_${selectedYear}년_${effectiveMonth}월.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(container.firstElementChild).save();

      document.body.removeChild(container);
    } catch (err) {
      console.error('PDF generation failed:', err);
      setEmailSendResult('PDF 생성에 실패했습니다.');
      setTimeout(() => setEmailSendResult(null), 3000);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailRecipients.trim()) {
      setShowEmailInput(true);
      return;
    }
    setIsSendingEmail(true);
    setEmailSendResult(null);
    try {
      const htmlContent = buildReportHTML();
      const res = await fetch(`${API_BASE}/api/targets/report/send`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          year: selectedYear,
          month: effectiveMonth,
          recipients: emailRecipients,
          html_content: htmlContent,
        }),
      });
      if (res.ok) {
        setEmailSendResult('리포트가 이메일로 발송되었습니다.');
        setShowEmailInput(false);
      } else {
        const err = await res.json().catch(() => null);
        setEmailSendResult(err?.detail || '이메일 발송에 실패했습니다.');
      }
    } catch {
      setEmailSendResult('이메일 발송 중 오류가 발생했습니다.');
    } finally {
      setIsSendingEmail(false);
      setTimeout(() => setEmailSendResult(null), 5000);
    }
  };

  const handleToggleScheduleDay = (dayIdx: number) => {
    setScheduleForm((prev) => {
      const days = prev.days.includes(dayIdx)
        ? prev.days.filter((d) => d !== dayIdx)
        : [...prev.days, dayIdx].sort();
      return { ...prev, days };
    });
  };

  const handleSaveSchedule = async () => {
    if (!scheduleForm.recipients.trim()) return;
    setIsSavingSchedule(true);
    try {
      const payload = {
        recipients: scheduleForm.recipients,
        days: scheduleForm.days,
        time: scheduleForm.time,
        enabled: scheduleForm.enabled,
        year: selectedYear,
        month: effectiveMonth,
      };

      const url = editingScheduleIdx !== null && schedules[editingScheduleIdx]?.id
        ? `${API_BASE}/api/targets/report/schedules/${schedules[editingScheduleIdx].id}`
        : `${API_BASE}/api/targets/report/schedules`;
      const method = editingScheduleIdx !== null && schedules[editingScheduleIdx]?.id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const saved = await res.json();
        if (editingScheduleIdx !== null) {
          setSchedules((prev) => {
            const updated = [...prev];
            updated[editingScheduleIdx] = saved;
            return updated;
          });
          setEditingScheduleIdx(null);
        } else {
          setSchedules((prev) => [...prev, saved]);
        }
        // Reset form
        setScheduleForm({ recipients: '', days: [1], time: '09:00', enabled: true });
      }
    } catch {
      // Silently handle — schedule endpoint may not exist yet
      // Add to local state for preview
      if (editingScheduleIdx !== null) {
        setSchedules((prev) => {
          const updated = [...prev];
          updated[editingScheduleIdx] = { ...scheduleForm };
          return updated;
        });
        setEditingScheduleIdx(null);
      } else {
        setSchedules((prev) => [...prev, { ...scheduleForm }]);
      }
      setScheduleForm({ recipients: '', days: [1], time: '09:00', enabled: true });
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const handleEditSchedule = (idx: number) => {
    const schedule = schedules[idx];
    setScheduleForm({
      recipients: schedule.recipients,
      days: schedule.days,
      time: schedule.time,
      enabled: schedule.enabled,
    });
    setEditingScheduleIdx(idx);
  };

  const handleDeleteSchedule = async (idx: number) => {
    const schedule = schedules[idx];
    if (schedule.id) {
      try {
        await fetch(`${API_BASE}/api/targets/report/schedules/${schedule.id}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
      } catch {
        // Silently handle
      }
    }
    setSchedules((prev) => prev.filter((_, i) => i !== idx));
    if (editingScheduleIdx === idx) {
      setEditingScheduleIdx(null);
      setScheduleForm({ recipients: '', days: [1], time: '09:00', enabled: true });
    }
  };

  // -----------------------------------------------------------------------
  // Grouped channels by manager for display
  // -----------------------------------------------------------------------
  const channelsByManager = useMemo(() => {
    const grouped: Record<string, ChannelAchievement[]> = {};
    for (const ca of channelAchievements) {
      if (!grouped[ca.manager]) grouped[ca.manager] = [];
      grouped[ca.manager].push(ca);
    }
    return grouped;
  }, [channelAchievements]);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------
  const renderAchievementBadge = (rate: number) => {
    const achieved = rate >= 100;
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
          achieved
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}
      >
        {achieved ? '달성' : '미달성'}
      </span>
    );
  };

  const renderEntryBadge = (isNormal: boolean) => {
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
          isNormal
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}
      >
        {isNormal ? '정상' : '미입력'}
      </span>
    );
  };

  // Bar chart color function
  const getBarColor = (value: number) => {
    if (value >= 100) return '#10b981';
    if (value >= 80) return '#f59e0b';
    return '#ef4444';
  };

  // -----------------------------------------------------------------------
  // JSX
  // -----------------------------------------------------------------------
  return (
    <>
      {/* Print-specific CSS */}
      <style jsx global>{`
        @media print {
          nav, .no-print, .print-hide {
            display: none !important;
          }
          .print-section {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .bg-white {
            background-color: #fff !important;
          }
        }
      `}</style>

      <section className="mb-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Collapsible Header */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-purple-50 to-indigo-50 hover:from-purple-100 hover:to-indigo-100 transition-colors no-print"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="text-left">
                <h2 className="text-lg font-semibold text-slate-800">리포트 및 이메일 스케줄링</h2>
                <p className="text-sm text-slate-500">목표 달성 현황 리포트를 생성하고 자동 이메일 발송을 설정합니다</p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Collapsible Content */}
          {isExpanded && (
            <div className="divide-y divide-slate-100">
              {/* Report Generation Controls */}
              <div className="px-6 py-5 bg-slate-50 no-print">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-600">기준:</span>
                    <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700">
                      {selectedYear}년 {effectiveMonth}월
                    </span>
                  </div>

                  <button
                    onClick={handleGenerateReport}
                    disabled={isGenerating}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-lg hover:from-purple-600 hover:to-indigo-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        생성 중...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        리포트 생성
                      </>
                    )}
                  </button>

                  {isReportGenerated && (
                    <>
                      <button
                        onClick={handlePrintReport}
                        disabled={isDownloadingPdf}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                      >
                        {isDownloadingPdf ? (
                          <>
                            <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                            생성 중...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            PDF 다운로드
                          </>
                        )}
                      </button>

                      <button
                        onClick={handleSendEmail}
                        disabled={isSendingEmail}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 transition-colors shadow-sm disabled:opacity-50"
                      >
                        {isSendingEmail ? (
                          <>
                            <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                            발송 중...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            리포트 이메일 발송
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>

                {showEmailInput && (
                  <div className="mt-3 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <label className="block text-sm font-medium text-indigo-800 mb-2">수신자 이메일</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={emailRecipients}
                        onChange={(e) => setEmailRecipients(e.target.value)}
                        placeholder="이메일을 쉼표로 구분하여 입력 (예: user1@example.com, user2@example.com)"
                        className="flex-1 px-4 py-2 border border-indigo-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        onKeyDown={(e) => { if (e.key === 'Enter' && emailRecipients.trim()) handleSendEmail(); }}
                      />
                      <button
                        onClick={handleSendEmail}
                        disabled={!emailRecipients.trim() || isSendingEmail}
                        className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50 text-sm font-medium whitespace-nowrap"
                      >
                        {isSendingEmail ? '발송 중...' : '발송'}
                      </button>
                      <button
                        onClick={() => setShowEmailInput(false)}
                        className="px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors text-sm"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                )}

                {emailSendResult && (
                  <div className={`mt-3 px-4 py-2 rounded-lg text-sm ${
                    emailSendResult.includes('실패') || emailSendResult.includes('오류')
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}>
                    {emailSendResult}
                  </div>
                )}

                {error && (
                  <div className="mt-3 px-4 py-2 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">
                    {error}
                  </div>
                )}
              </div>

              {/* ============================================================ */}
              {/* REPORT CONTENT                                               */}
              {/* ============================================================ */}
              {isReportGenerated && (
                <div ref={reportRef} className="px-6 py-6 space-y-8">
                  {/* Report header */}
                  <div className="text-center print-section">
                    <h2 className="text-2xl font-bold text-slate-800">
                      {selectedYear}년 {effectiveMonth}월 목표 달성 현황 리포트
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                      생성일시: {new Date().toLocaleString('ko-KR')}
                      {excludeVat && ' | 부가세 별도 기준'}
                    </p>
                  </div>

                  {/* ======================================================== */}
                  {/* a) 담당자별 목표 vs 실적 현황                              */}
                  {/* ======================================================== */}
                  <div className="print-section">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-purple-500 to-indigo-500" />
                      <h3 className="text-lg font-bold text-slate-800">담당자별 목표 vs 실적 현황</h3>
                    </div>

                    {managerComparisons.length === 0 ? (
                      <div className="bg-slate-50 rounded-xl p-8 text-center text-slate-500">
                        데이터 없음
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gradient-to-r from-purple-50 to-indigo-50">
                              <th className="text-left px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">담당자</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">목표매출</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">실적매출</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">달성률</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">목표판매량</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">실적판매량</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">달성률</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">목표공헌이익</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">실적공헌이익</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">달성률</th>
                            </tr>
                          </thead>
                          <tbody>
                            {managerComparisons.map((mc) => (
                              <tr key={mc.manager} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3 font-medium text-slate-800">{mc.manager}</td>
                                <td className="px-4 py-3 text-right text-slate-600">{formatKRW(applyVat(mc.targetSales))}</td>
                                <td className="px-4 py-3 text-right text-slate-600">{formatKRW(applyVat(mc.actualSales))}</td>
                                <td className={`px-4 py-3 text-right font-bold ${rateColorClass(mc.salesRate)}`}>
                                  {mc.salesRate.toFixed(1)}%
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600">{formatKRW(mc.targetQuantity)}</td>
                                <td className="px-4 py-3 text-right text-slate-600">{formatKRW(mc.actualQuantity)}</td>
                                <td className={`px-4 py-3 text-right font-bold ${rateColorClass(mc.quantityRate)}`}>
                                  {mc.quantityRate.toFixed(1)}%
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600">{formatKRW(applyVat(mc.targetContribution))}</td>
                                <td className="px-4 py-3 text-right text-slate-600">{formatKRW(applyVat(mc.actualContribution))}</td>
                                <td className={`px-4 py-3 text-right font-bold ${rateColorClass(mc.contributionRate)}`}>
                                  {mc.contributionRate.toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                            {/* Summary row */}
                            <tr className="bg-gradient-to-r from-purple-50 to-indigo-50 font-bold border-t-2 border-slate-300">
                              <td className="px-4 py-3 text-slate-800">합계</td>
                              <td className="px-4 py-3 text-right text-slate-700">{formatKRW(applyVat(summaryTotals.targetSales))}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{formatKRW(applyVat(summaryTotals.actualSales))}</td>
                              <td className={`px-4 py-3 text-right ${rateColorClass(summaryTotals.salesRate)}`}>
                                {summaryTotals.salesRate.toFixed(1)}%
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700">{formatKRW(summaryTotals.targetQuantity)}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{formatKRW(summaryTotals.actualQuantity)}</td>
                              <td className={`px-4 py-3 text-right ${rateColorClass(summaryTotals.quantityRate)}`}>
                                {summaryTotals.quantityRate.toFixed(1)}%
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700">{formatKRW(applyVat(summaryTotals.targetContribution))}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{formatKRW(applyVat(summaryTotals.actualContribution))}</td>
                              <td className={`px-4 py-3 text-right ${rateColorClass(summaryTotals.contributionRate)}`}>
                                {summaryTotals.contributionRate.toFixed(1)}%
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Achievement rate chart */}
                    {achievementChartData.length > 0 && (
                      <div className="mt-6 bg-slate-50 rounded-xl p-5 border border-slate-200">
                        <h4 className="text-sm font-semibold text-slate-700 mb-4">담당자별 달성률 차트</h4>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={achievementChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                            <YAxis
                              tick={{ fontSize: 12 }}
                              domain={[0, (dataMax: number) => Math.max(dataMax + 20, 120)]}
                              tickFormatter={(v: number) => `${v}%`}
                            />
                            <Tooltip formatter={(value: number, name: string) => [`${value}%`, name]} />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            {/* Reference line at 100% */}
                            <Bar dataKey="매출달성률" name="매출 달성률">
                              {achievementChartData.map((entry, index) => (
                                <Cell key={`sales-${index}`} fill={getBarColor(entry.매출달성률)} />
                              ))}
                            </Bar>
                            <Bar dataKey="판매량달성률" name="판매량 달성률">
                              {achievementChartData.map((entry, index) => (
                                <Cell key={`qty-${index}`} fill={getBarColor(entry.판매량달성률)} />
                              ))}
                            </Bar>
                            <Bar dataKey="공헌이익달성률" name="공헌이익 달성률">
                              {achievementChartData.map((entry, index) => (
                                <Cell key={`cont-${index}`} fill={getBarColor(entry.공헌이익달성률)} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                        <div className="flex items-center justify-center gap-6 mt-3 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> 100% 이상
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" /> 80~99%
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> 80% 미만
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ======================================================== */}
                  {/* b) 채널별 달성/미달성 현황                                 */}
                  {/* ======================================================== */}
                  <div className="print-section">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-cyan-500" />
                      <h3 className="text-lg font-bold text-slate-800">채널별 달성/미달성 현황</h3>
                    </div>

                    {Object.keys(channelsByManager).length === 0 ? (
                      <div className="bg-slate-50 rounded-xl p-8 text-center text-slate-500">
                        데이터 없음
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {Object.entries(channelsByManager).sort(([a], [b]) => a.localeCompare(b)).map(([manager, channels]) => (
                          <div key={manager} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                            <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-cyan-50 border-b border-slate-200">
                              <h4 className="font-semibold text-slate-700">{manager}</h4>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-slate-100">
                                    <th className="text-left px-4 py-2 text-slate-600 font-medium">채널</th>
                                    <th className="text-right px-4 py-2 text-slate-600 font-medium">목표</th>
                                    <th className="text-right px-4 py-2 text-slate-600 font-medium">실적</th>
                                    <th className="text-right px-4 py-2 text-slate-600 font-medium">달성률</th>
                                    <th className="text-center px-4 py-2 text-slate-600 font-medium">상태</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {channels.sort((a, b) => a.rate - b.rate).map((ch, idx) => (
                                    <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50">
                                      <td className="px-4 py-2.5 text-slate-700">{ch.channel}</td>
                                      <td className="px-4 py-2.5 text-right text-slate-600">
                                        {formatKRW(applyVat(ch.targetValue))}
                                      </td>
                                      <td className="px-4 py-2.5 text-right text-slate-600">
                                        {formatKRW(applyVat(ch.actualValue))}
                                      </td>
                                      <td className={`px-4 py-2.5 text-right font-bold ${rateColorClass(ch.rate)}`}>
                                        {ch.rate > 900 ? '-' : `${ch.rate.toFixed(1)}%`}
                                      </td>
                                      <td className="px-4 py-2.5 text-center">
                                        {renderAchievementBadge(ch.rate)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ======================================================== */}
                  {/* c) 담당자별 데이터 입력 현황                               */}
                  {/* ======================================================== */}
                  <div className="print-section">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-amber-500 to-orange-500" />
                      <h3 className="text-lg font-bold text-slate-800">담당자별 데이터 입력 현황</h3>
                    </div>

                    <p className="text-sm text-slate-500 mb-4">
                      기준일: {selectedYear}년 {effectiveMonth}월 {yesterday}일까지 입력 필요 (어제까지의 데이터)
                    </p>

                    {managerEntryStatuses.length === 0 ? (
                      <div className="bg-slate-50 rounded-xl p-8 text-center text-slate-500">
                        데이터 없음
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gradient-to-r from-amber-50 to-orange-50">
                              <th className="text-left px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">담당자</th>
                              <th className="text-center px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">마지막 입력일</th>
                              <th className="text-center px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">요구 입력일</th>
                              <th className="text-center px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">미입력 일수</th>
                              <th className="text-center px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">상태</th>
                            </tr>
                          </thead>
                          <tbody>
                            {managerEntryStatuses.map((status) => (
                              <tr key={status.manager} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3 font-medium text-slate-800">{status.manager}</td>
                                <td className="px-4 py-3 text-center text-slate-600">
                                  {status.lastEntryDay > 0 ? `${status.lastEntryDay}일` : '입력 없음'}
                                </td>
                                <td className="px-4 py-3 text-center text-slate-600">{status.requiredDay}일</td>
                                <td className="px-4 py-3 text-center">
                                  {status.missingDays > 0 ? (
                                    <span className="font-bold text-red-500">{status.missingDays}일</span>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {renderEntryBadge(status.isNormal)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* ======================================================== */}
                  {/* d) 미입력자 경고 리스트                                    */}
                  {/* ======================================================== */}
                  {missingEntryManagers.length > 0 && (
                    <div className="print-section">
                      <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl overflow-hidden">
                        <div className="px-5 py-4 border-b border-red-200 flex items-center gap-3">
                          <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                          </svg>
                          <h3 className="text-lg font-bold text-red-800">미입력자 경고</h3>
                          <span className="px-2.5 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                            {missingEntryManagers.length}명
                          </span>
                        </div>
                        <div className="p-5">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {missingEntryManagers.map((status) => (
                              <div
                                key={status.manager}
                                className="bg-white rounded-lg border border-red-100 p-4 flex items-start gap-3"
                              >
                                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                                  <span className="text-red-600 font-bold text-sm">
                                    {status.manager.charAt(0)}
                                  </span>
                                </div>
                                <div>
                                  <p className="font-semibold text-slate-800">{status.manager}</p>
                                  <p className="text-sm text-slate-500 mt-0.5">
                                    마지막 입력일: {status.lastEntryDay > 0 ? `${effectiveMonth}월 ${status.lastEntryDay}일` : '입력 없음'}
                                  </p>
                                  <p className="text-sm text-red-600 font-medium mt-0.5">
                                    미입력 일수: {status.missingDays}일
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* e) 채널별 개선 아이디어                                    */}
                  {/* ======================================================== */}
                  <div className="print-section">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-emerald-500 to-teal-500" />
                      <h3 className="text-lg font-bold text-slate-800">채널별 개선 아이디어</h3>
                    </div>

                    {channelSuggestions.length === 0 ? (
                      <div className="bg-slate-50 rounded-xl p-8 text-center text-slate-500">
                        데이터 없음
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {channelSuggestions.map((cs, idx) => (
                          <div
                            key={idx}
                            className={`rounded-xl border p-4 flex items-start gap-4 ${rateBgClass(cs.rate)}`}
                          >
                            <div className="flex-shrink-0 mt-0.5">
                              {cs.rate >= 100 ? (
                                <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              ) : cs.rate >= 80 ? (
                                <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                </svg>
                              ) : (
                                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-1">
                                <span className="font-semibold">{cs.channel}</span>
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                  cs.rate >= 100
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : cs.rate >= 80
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'bg-red-100 text-red-700'
                                }`}>
                                  {cs.rate > 900 ? '목표 미설정' : `달성률 ${cs.rate.toFixed(1)}%`}
                                </span>
                              </div>
                              <p className="text-sm leading-relaxed">{cs.suggestion}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ============================================================ */}
              {/* EMAIL SCHEDULING SECTION                                      */}
              {/* ============================================================ */}
              <div className="px-6 py-6 bg-slate-50 no-print">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-indigo-500 to-purple-500" />
                  <h3 className="text-lg font-bold text-slate-800">이메일 자동 발송 스케줄</h3>
                </div>

                {/* Schedule Form */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Recipients */}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        수신자 이메일
                      </label>
                      <input
                        type="text"
                        value={scheduleForm.recipients}
                        onChange={(e) => setScheduleForm((prev) => ({ ...prev, recipients: e.target.value }))}
                        placeholder="이메일 주소를 쉼표로 구분하여 입력 (예: user1@example.com, user2@example.com)"
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>

                    {/* Days of week */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        발송 요일
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {DAY_LABELS.map((label, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleToggleScheduleDay(idx)}
                            className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                              scheduleForm.days.includes(idx)
                                ? 'bg-indigo-500 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Time */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        발송 시각
                      </label>
                      <input
                        type="time"
                        value={scheduleForm.time}
                        onChange={(e) => setScheduleForm((prev) => ({ ...prev, time: e.target.value }))}
                        className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>

                    {/* Enable toggle */}
                    <div className="flex items-center">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={scheduleForm.enabled}
                            onChange={(e) => setScheduleForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                            className="sr-only"
                          />
                          <div
                            className={`w-11 h-6 rounded-full transition-colors ${
                              scheduleForm.enabled ? 'bg-indigo-500' : 'bg-slate-300'
                            }`}
                          >
                            <div
                              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                scheduleForm.enabled ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </div>
                        </div>
                        <span className="text-sm font-medium text-slate-700">
                          자동 발송 {scheduleForm.enabled ? '활성화' : '비활성화'}
                        </span>
                      </label>
                    </div>

                    {/* Save button */}
                    <div className="flex items-end">
                      <button
                        onClick={handleSaveSchedule}
                        disabled={!scheduleForm.recipients.trim() || scheduleForm.days.length === 0 || isSavingSchedule}
                        className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                      >
                        {isSavingSchedule ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            저장 중...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            {editingScheduleIdx !== null ? '수정' : '저장'}
                          </>
                        )}
                      </button>

                      {editingScheduleIdx !== null && (
                        <button
                          onClick={() => {
                            setEditingScheduleIdx(null);
                            setScheduleForm({ recipients: '', days: [1], time: '09:00', enabled: true });
                          }}
                          className="ml-2 px-4 py-2.5 text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors text-sm"
                        >
                          취소
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Existing Schedules */}
                {schedules.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-3">등록된 스케줄</h4>
                    <div className="space-y-2">
                      {schedules.map((schedule, idx) => (
                        <div
                          key={idx}
                          className={`bg-white rounded-lg border p-4 flex items-center justify-between ${
                            schedule.enabled ? 'border-slate-200' : 'border-slate-200 opacity-60'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  schedule.enabled
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}
                              >
                                {schedule.enabled ? '활성' : '비활성'}
                              </span>
                              <span className="text-sm text-slate-600">
                                {schedule.days.map((d) => DAY_LABELS[d]).join(', ')} {schedule.time}
                              </span>
                            </div>
                            <p className="text-sm text-slate-500 truncate">{schedule.recipients}</p>
                          </div>
                          <div className="flex items-center gap-1 ml-3">
                            <button
                              onClick={() => handleEditSchedule(idx)}
                              className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="수정"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteSchedule(idx)}
                              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              title="삭제"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {schedules.length === 0 && (
                  <div className="text-center py-6 text-slate-400 text-sm">
                    등록된 이메일 스케줄이 없습니다. 위 양식에서 스케줄을 추가하세요.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
