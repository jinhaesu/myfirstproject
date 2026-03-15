'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

// ─────────────────────────────────────────────
// API helper
// ─────────────────────────────────────────────
const API_BASE = '';
const getAuthHeaders = () => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};
const fetchSafe = async <T,>(path: string, defaultValue: T): Promise<T> => {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch { return defaultValue; }
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type ProfitabilityCategory = 'A등급' | 'B등급' | 'C등급' | 'D등급';
type QualityStatus = '양호' | '보통' | '불량' | '검사중';
type Shift = '주간' | '야간' | '교대';

interface ProductionResult {
  id: number;
  productionDate: string;       // 생산일자
  teamName: string;             // 생산팀명
  shift: Shift;                 // 근무
  productCode: string;          // 품주명
  productName: string;          // 품명
  salePrice: number;            // 판매가격
  costRate: number;             // 원가율 (%)
  productionHours: number;      // 생산기준시
  expectedSales: number;        // 예상 판매액
  profit: number;               // 판매이익
  hourlyRate: number;           // 시간당 (생산수량/시간)
  profitability: ProfitabilityCategory; // 판매별 수익성
  qualityStatus: QualityStatus; // 생산/품질 현황
}

type SortField = keyof ProductionResult;
type SortDirection = 'asc' | 'desc';

interface CellPosition {
  rowIndex: number;
  colKey: string;
}

// ─────────────────────────────────────────────
// Column definitions
// ─────────────────────────────────────────────
interface ColumnDef {
  key: keyof ProductionResult;
  label: string;
  width: string;
  align: 'left' | 'right' | 'center';
  type: 'text' | 'number' | 'date' | 'select' | 'percent';
  options?: string[];
  format?: (v: any) => string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'productionDate', label: '생산일자', width: '110px', align: 'center', type: 'date' },
  { key: 'teamName', label: '생산팀명', width: '90px', align: 'center', type: 'text' },
  { key: 'shift', label: '근무', width: '70px', align: 'center', type: 'select', options: ['주간', '야간', '교대'] },
  { key: 'productCode', label: '품주명', width: '110px', align: 'left', type: 'text' },
  { key: 'productName', label: '품명', width: '180px', align: 'left', type: 'text' },
  { key: 'salePrice', label: '판매가격', width: '110px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR') },
  { key: 'costRate', label: '원가율(%)', width: '90px', align: 'right', type: 'percent', format: (v: number) => `${v.toFixed(1)}%` },
  { key: 'productionHours', label: '생산기준시', width: '100px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR', { minimumFractionDigits: 1 }) },
  { key: 'expectedSales', label: '예상 판매액', width: '120px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR') },
  { key: 'profit', label: '판매이익', width: '110px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR') },
  { key: 'hourlyRate', label: '시간당', width: '80px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR') },
  { key: 'profitability', label: '수익성', width: '80px', align: 'center', type: 'select', options: ['A등급', 'B등급', 'C등급', 'D등급'] },
  { key: 'qualityStatus', label: '품질현황', width: '80px', align: 'center', type: 'select', options: ['양호', '보통', '불량', '검사중'] },
];

// ─────────────────────────────────────────────
// Sample data
// ─────────────────────────────────────────────
const generateSampleData = (): ProductionResult[] => [
  { id: 1, productionDate: '2026-03-01', teamName: '1팀', shift: '주간', productCode: 'SC-001', productName: '수분 크림 50ml', salePrice: 32000, costRate: 35.2, productionHours: 8.0, expectedSales: 16000000, profit: 10368000, hourlyRate: 62, profitability: 'A등급', qualityStatus: '양호' },
  { id: 2, productionDate: '2026-03-01', teamName: '1팀', shift: '야간', productCode: 'SC-002', productName: '비타민C 세럼 30ml', salePrice: 45000, costRate: 28.5, productionHours: 8.0, expectedSales: 22500000, profit: 16087500, hourlyRate: 55, profitability: 'A등급', qualityStatus: '양호' },
  { id: 3, productionDate: '2026-03-01', teamName: '2팀', shift: '주간', productCode: 'MK-001', productName: '매트 립스틱 #로즈레드', salePrice: 18000, costRate: 42.0, productionHours: 8.0, expectedSales: 9000000, profit: 5220000, hourlyRate: 78, profitability: 'B등급', qualityStatus: '양호' },
  { id: 4, productionDate: '2026-03-02', teamName: '1팀', shift: '주간', productCode: 'SC-003', productName: '히알루론산 토너 200ml', salePrice: 25000, costRate: 32.0, productionHours: 8.5, expectedSales: 12500000, profit: 8500000, hourlyRate: 58, profitability: 'A등급', qualityStatus: '양호' },
  { id: 5, productionDate: '2026-03-02', teamName: '2팀', shift: '주간', productCode: 'HC-001', productName: '케라틴 실크 샴푸 500ml', salePrice: 22000, costRate: 38.5, productionHours: 7.5, expectedSales: 11000000, profit: 6765000, hourlyRate: 65, profitability: 'B등급', qualityStatus: '보통' },
  { id: 6, productionDate: '2026-03-02', teamName: '2팀', shift: '야간', productCode: 'BD-001', productName: '시어버터 바디로션 300ml', salePrice: 19000, costRate: 40.0, productionHours: 8.0, expectedSales: 9500000, profit: 5700000, hourlyRate: 70, profitability: 'B등급', qualityStatus: '양호' },
  { id: 7, productionDate: '2026-03-03', teamName: '1팀', shift: '주간', productCode: 'SC-004', productName: '레티놀 나이트크림 30ml', salePrice: 55000, costRate: 25.0, productionHours: 8.0, expectedSales: 27500000, profit: 20625000, hourlyRate: 45, profitability: 'A등급', qualityStatus: '양호' },
  { id: 8, productionDate: '2026-03-03', teamName: '3팀', shift: '주간', productCode: 'MK-002', productName: '글로우 쿠션 파운데이션 15g', salePrice: 38000, costRate: 33.0, productionHours: 9.0, expectedSales: 19000000, profit: 12730000, hourlyRate: 50, profitability: 'A등급', qualityStatus: '검사중' },
  { id: 9, productionDate: '2026-03-03', teamName: '3팀', shift: '야간', productCode: 'HC-002', productName: '두피 스케일링 토닉 150ml', salePrice: 28000, costRate: 36.0, productionHours: 7.0, expectedSales: 14000000, profit: 8960000, hourlyRate: 60, profitability: 'B등급', qualityStatus: '양호' },
  { id: 10, productionDate: '2026-03-04', teamName: '1팀', shift: '주간', productCode: 'SC-005', productName: '그린티 클렌징 오일 200ml', salePrice: 21000, costRate: 38.0, productionHours: 8.0, expectedSales: 10500000, profit: 6510000, hourlyRate: 72, profitability: 'B등급', qualityStatus: '양호' },
  { id: 11, productionDate: '2026-03-04', teamName: '2팀', shift: '주간', productCode: 'MK-003', productName: '아이섀도 팔레트 12색', salePrice: 35000, costRate: 30.0, productionHours: 10.0, expectedSales: 17500000, profit: 12250000, hourlyRate: 42, profitability: 'A등급', qualityStatus: '양호' },
  { id: 12, productionDate: '2026-03-04', teamName: '3팀', shift: '교대', productCode: 'BD-002', productName: '코코넛 바디스크럽 250g', salePrice: 16000, costRate: 45.0, productionHours: 6.0, expectedSales: 8000000, profit: 4400000, hourlyRate: 85, profitability: 'C등급', qualityStatus: '보통' },
  { id: 13, productionDate: '2026-03-05', teamName: '1팀', shift: '주간', productCode: 'SC-006', productName: '시카 리페어 크림 50ml', salePrice: 42000, costRate: 29.0, productionHours: 8.0, expectedSales: 21000000, profit: 14910000, hourlyRate: 52, profitability: 'A등급', qualityStatus: '양호' },
  { id: 14, productionDate: '2026-03-05', teamName: '2팀', shift: '주간', productCode: 'MK-004', productName: '볼륨 마스카라 블랙', salePrice: 15000, costRate: 48.0, productionHours: 7.5, expectedSales: 7500000, profit: 3900000, hourlyRate: 90, profitability: 'C등급', qualityStatus: '불량' },
  { id: 15, productionDate: '2026-03-05', teamName: '3팀', shift: '야간', productCode: 'HC-003', productName: '볼류밍 샴푸 500ml', salePrice: 18000, costRate: 42.0, productionHours: 8.0, expectedSales: 9000000, profit: 5220000, hourlyRate: 68, profitability: 'B등급', qualityStatus: '양호' },
  { id: 16, productionDate: '2026-03-06', teamName: '1팀', shift: '주간', productCode: 'SC-007', productName: '톤업 선크림 SPF50+ 60ml', salePrice: 28000, costRate: 34.0, productionHours: 8.5, expectedSales: 14000000, profit: 9240000, hourlyRate: 56, profitability: 'A등급', qualityStatus: '양호' },
  { id: 17, productionDate: '2026-03-06', teamName: '2팀', shift: '교대', productCode: 'BD-003', productName: '바디 로션 400ml', salePrice: 14000, costRate: 50.0, productionHours: 6.5, expectedSales: 7000000, profit: 3500000, hourlyRate: 95, profitability: 'D등급', qualityStatus: '보통' },
  { id: 18, productionDate: '2026-03-06', teamName: '3팀', shift: '주간', productCode: 'MK-005', productName: '아이브로우 펜슬 세트', salePrice: 12000, costRate: 52.0, productionHours: 5.0, expectedSales: 6000000, profit: 2880000, hourlyRate: 110, profitability: 'D등급', qualityStatus: '양호' },
  { id: 19, productionDate: '2026-03-07', teamName: '1팀', shift: '주간', productCode: 'SC-001', productName: '수분 크림 50ml', salePrice: 32000, costRate: 35.2, productionHours: 8.0, expectedSales: 16000000, profit: 10368000, hourlyRate: 62, profitability: 'A등급', qualityStatus: '양호' },
  { id: 20, productionDate: '2026-03-07', teamName: '2팀', shift: '야간', productCode: 'SC-002', productName: '비타민C 세럼 30ml', salePrice: 45000, costRate: 28.5, productionHours: 8.0, expectedSales: 22500000, profit: 16087500, hourlyRate: 55, profitability: 'A등급', qualityStatus: '양호' },
  { id: 21, productionDate: '2026-03-08', teamName: '3팀', shift: '주간', productCode: 'HC-001', productName: '케라틴 실크 샴푸 500ml', salePrice: 22000, costRate: 38.5, productionHours: 7.5, expectedSales: 11000000, profit: 6765000, hourlyRate: 65, profitability: 'B등급', qualityStatus: '양호' },
  { id: 22, productionDate: '2026-03-08', teamName: '1팀', shift: '야간', productCode: 'SC-004', productName: '레티놀 나이트크림 30ml', salePrice: 55000, costRate: 25.0, productionHours: 8.0, expectedSales: 27500000, profit: 20625000, hourlyRate: 45, profitability: 'A등급', qualityStatus: '양호' },
  { id: 23, productionDate: '2026-03-09', teamName: '2팀', shift: '주간', productCode: 'MK-002', productName: '글로우 쿠션 파운데이션 15g', salePrice: 38000, costRate: 33.0, productionHours: 9.0, expectedSales: 19000000, profit: 12730000, hourlyRate: 50, profitability: 'A등급', qualityStatus: '양호' },
  { id: 24, productionDate: '2026-03-09', teamName: '3팀', shift: '교대', productCode: 'BD-001', productName: '시어버터 바디로션 300ml', salePrice: 19000, costRate: 40.0, productionHours: 8.0, expectedSales: 9500000, profit: 5700000, hourlyRate: 70, profitability: 'B등급', qualityStatus: '보통' },
  { id: 25, productionDate: '2026-03-10', teamName: '1팀', shift: '주간', productCode: 'SC-006', productName: '시카 리페어 크림 50ml', salePrice: 42000, costRate: 29.0, productionHours: 8.0, expectedSales: 21000000, profit: 14910000, hourlyRate: 52, profitability: 'A등급', qualityStatus: '양호' },
];

// ─────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────
const formatNumber = (n: number): string => n.toLocaleString('ko-KR');
const parseFormattedNumber = (s: string): number => {
  const cleaned = s.replace(/[,%\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

let nextTempId = -1;
const getNextTempId = () => nextTempId--;

const createEmptyRow = (): ProductionResult => ({
  id: getNextTempId(),
  productionDate: new Date().toISOString().slice(0, 10),
  teamName: '1팀',
  shift: '주간',
  productCode: '',
  productName: '',
  salePrice: 0,
  costRate: 0,
  productionHours: 0,
  expectedSales: 0,
  profit: 0,
  hourlyRate: 0,
  profitability: 'C등급',
  qualityStatus: '양호',
});

// ─────────────────────────────────────────────
// Excel download helper
// ─────────────────────────────────────────────
const downloadExcel = (rows: ProductionResult[]) => {
  const BOM = '\uFEFF';
  const headers = COLUMNS.map(c => c.label);
  const csvRows = rows.map(r =>
    COLUMNS.map(c => {
      const val = r[c.key];
      return `"${val}"`;
    })
  );
  const csv = [headers.map(h => `"${h}"`), ...csvRows].map(r => r.join(',')).join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `생산결과_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────
// Profitability / Quality colors
// ─────────────────────────────────────────────
const PROFITABILITY_COLORS: Record<ProfitabilityCategory, { bg: string; text: string; chartColor: string }> = {
  'A등급': { bg: 'bg-emerald-100', text: 'text-emerald-700', chartColor: '#10b981' },
  'B등급': { bg: 'bg-blue-100', text: 'text-blue-700', chartColor: '#3b82f6' },
  'C등급': { bg: 'bg-amber-100', text: 'text-amber-700', chartColor: '#f59e0b' },
  'D등급': { bg: 'bg-red-100', text: 'text-red-700', chartColor: '#ef4444' },
};

const QUALITY_COLORS: Record<QualityStatus, { bg: string; text: string }> = {
  '양호': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  '보통': { bg: 'bg-amber-100', text: 'text-amber-700' },
  '불량': { bg: 'bg-red-100', text: 'text-red-700' },
  '검사중': { bg: 'bg-purple-100', text: 'text-purple-700' },
};

// ═══════════════════════════════════════════════
// Simple CSS Chart Components
// ═══════════════════════════════════════════════

function MiniBarChart({ data, labelKey, valueKey, color = '#3b82f6' }: { data: { [k: string]: any }[]; labelKey: string; valueKey: string; color?: string }) {
  const max = Math.max(...data.map(d => d[valueKey]), 1);
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center flex-1 min-w-0">
          <div
            className="w-full rounded-t transition-all duration-300 min-h-[2px]"
            style={{ height: `${(d[valueKey] / max) * 100}%`, backgroundColor: color }}
            title={`${d[labelKey]}: ${formatNumber(d[valueKey])}`}
          />
          <span className="text-[10px] text-slate-500 mt-1 truncate w-full text-center">{d[labelKey]}</span>
        </div>
      ))}
    </div>
  );
}

function MiniLineChart({ data, labelKey, valueKey, color = '#3b82f6' }: { data: { [k: string]: any }[]; labelKey: string; valueKey: string; color?: string }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map(d => d[valueKey]), 1);
  const min = Math.min(...data.map(d => d[valueKey]));
  const range = max - min || 1;
  const h = 120;
  const w = 100;
  const points = data.map((d, i) => ({
    x: (i / Math.max(data.length - 1, 1)) * w,
    y: h - ((d[valueKey] - min) / range) * (h - 20) - 10,
  }));
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} vectorEffect="non-scaling-stroke">
            <title>{`${data[i][labelKey]}: ${formatNumber(data[i][valueKey])}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500 mt-1">
        {data.length <= 8 ? data.map((d, i) => <span key={i}>{d[labelKey]}</span>) : (
          <>
            <span>{data[0][labelKey]}</span>
            <span>{data[data.length - 1][labelKey]}</span>
          </>
        )}
      </div>
    </div>
  );
}

function MiniPieChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let cumulative = 0;
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-28 h-28 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          {data.map((d, i) => {
            const pct = (d.value / total) * 100;
            const offset = cumulative;
            cumulative += pct;
            return (
              <circle
                key={i}
                cx="18" cy="18" r="15.91549430918954"
                fill="transparent"
                stroke={d.color}
                strokeWidth="3.5"
                strokeDasharray={`${pct} ${100 - pct}`}
                strokeDashoffset={`${-offset}`}
              >
                <title>{`${d.name}: ${d.value}건 (${((d.value / total) * 100).toFixed(1)}%)`}</title>
              </circle>
            );
          })}
        </svg>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-slate-600">{d.name}</span>
            <span className="font-semibold text-slate-800">{d.value}건</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function ProductionResultsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ── State ──
  const [rows, setRows] = useState<ProductionResult[]>(generateSampleData);
  const [modifiedIds, setModifiedIds] = useState<Set<number>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Filters
  const [startDate, setStartDate] = useState('2026-03-01');
  const [endDate, setEndDate] = useState('2026-03-10');
  const [teamFilter, setTeamFilter] = useState<string>('전체');
  const [productFilter, setProductFilter] = useState<string>('');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  // Sort
  const [sortField, setSortField] = useState<SortField>('productionDate');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  // Refs
  const tableRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ── Auth guard ──
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // ── Toast auto dismiss ──
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ── Focus edit input ──
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // ── Derived: unique teams and products ──
  const allTeams = useMemo(() => {
    const teams = new Set(rows.map(r => r.teamName));
    return ['전체', ...Array.from(teams).sort()];
  }, [rows]);

  const allProducts = useMemo(() => {
    const prods = new Set(rows.map(r => r.productName));
    return Array.from(prods).sort();
  }, [rows]);

  // ── Filtered & sorted data ──
  const filteredRows = useMemo(() => {
    let result = rows.filter(r => {
      if (startDate && r.productionDate < startDate) return false;
      if (endDate && r.productionDate > endDate) return false;
      if (teamFilter !== '전체' && r.teamName !== teamFilter) return false;
      if (productFilter && !r.productName.includes(productFilter) && !r.productCode.includes(productFilter)) return false;
      return true;
    });

    // Column-level filters
    for (const [key, filterVal] of Object.entries(columnFilters)) {
      if (!filterVal) continue;
      result = result.filter(r => {
        const val = String(r[key as keyof ProductionResult]).toLowerCase();
        return val.includes(filterVal.toLowerCase());
      });
    }

    return result;
  }, [rows, startDate, endDate, teamFilter, productFilter, columnFilters]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return sortDir === 'asc' ? -1 : 1;
      if (aStr > bStr) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredRows, sortField, sortDir]);

  // ── Summary stats ──
  const summary = useMemo(() => {
    const totalRows = filteredRows.length;
    const totalProductionHours = filteredRows.reduce((s, r) => s + r.productionHours, 0);
    const avgHourlyRate = totalRows > 0 ? filteredRows.reduce((s, r) => s + r.hourlyRate, 0) / totalRows : 0;
    const totalExpectedSales = filteredRows.reduce((s, r) => s + r.expectedSales, 0);
    const avgCostRate = totalRows > 0 ? filteredRows.reduce((s, r) => s + r.costRate, 0) / totalRows : 0;
    return { totalRows, totalProductionHours, avgHourlyRate, totalExpectedSales, avgCostRate };
  }, [filteredRows]);

  // ── Chart data ──
  const dailyTrendData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRows.forEach(r => {
      map[r.productionDate] = (map[r.productionDate] || 0) + r.productionHours;
    });
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, hours]) => ({ label: date.slice(5), value: hours }));
  }, [filteredRows]);

  const teamChartData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRows.forEach(r => {
      map[r.teamName] = (map[r.teamName] || 0) + r.productionHours;
    });
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([team, hours]) => ({ label: team, value: hours }));
  }, [filteredRows]);

  const profitabilityPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRows.forEach(r => {
      map[r.profitability] = (map[r.profitability] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({
      name,
      value,
      color: PROFITABILITY_COLORS[name as ProfitabilityCategory]?.chartColor || '#94a3b8',
    }));
  }, [filteredRows]);

  // ── Handlers ──
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField]);

  const startEditing = useCallback((rowIndex: number, colKey: string) => {
    const row = sortedRows[rowIndex];
    if (!row) return;
    const val = row[colKey as keyof ProductionResult];
    setEditingCell({ rowIndex, colKey });
    setEditValue(String(val));
  }, [sortedRows]);

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const { rowIndex, colKey } = editingCell;
    const row = sortedRows[rowIndex];
    if (!row) { setEditingCell(null); return; }

    const col = COLUMNS.find(c => c.key === colKey);
    let newValue: string | number = editValue;
    if (col?.type === 'number' || col?.type === 'percent') {
      newValue = parseFormattedNumber(editValue);
    }

    setRows(prev => prev.map(r => {
      if (r.id === row.id) {
        return { ...r, [colKey]: newValue };
      }
      return r;
    }));
    setModifiedIds(prev => new Set(prev).add(row.id));
    setEditingCell(null);
  }, [editingCell, editValue, sortedRows]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      if (editingCell && e.key === 'Tab') {
        const colIdx = COLUMNS.findIndex(c => c.key === editingCell.colKey);
        const nextColIdx = e.shiftKey ? colIdx - 1 : colIdx + 1;
        if (nextColIdx >= 0 && nextColIdx < COLUMNS.length) {
          setTimeout(() => startEditing(editingCell.rowIndex, COLUMNS[nextColIdx].key), 0);
        } else if (!e.shiftKey && editingCell.rowIndex + 1 < sortedRows.length) {
          setTimeout(() => startEditing(editingCell.rowIndex + 1, COLUMNS[0].key), 0);
        }
      }
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  }, [commitEdit, cancelEdit, editingCell, startEditing, sortedRows.length]);

  const addRow = useCallback(() => {
    const newRow = createEmptyRow();
    setRows(prev => [...prev, newRow]);
    setModifiedIds(prev => new Set(prev).add(newRow.id));
    setToast('새 행이 추가되었습니다.');
  }, []);

  const duplicateRow = useCallback((id: number) => {
    const source = rows.find(r => r.id === id);
    if (!source) return;
    const newRow = { ...source, id: getNextTempId() };
    setRows(prev => [...prev, newRow]);
    setModifiedIds(prev => new Set(prev).add(newRow.id));
    setToast('행이 복제되었습니다.');
  }, [rows]);

  const deleteSelectedRows = useCallback(() => {
    if (selectedRows.size === 0) {
      setToast('삭제할 행을 선택해주세요.');
      return;
    }
    setRows(prev => prev.filter(r => !selectedRows.has(r.id)));
    setSelectedRows(new Set());
    setToast(`${selectedRows.size}개 행이 삭제되었습니다.`);
  }, [selectedRows]);

  const deleteRow = useCallback((id: number) => {
    setRows(prev => prev.filter(r => r.id !== id));
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setToast('행이 삭제되었습니다.');
  }, []);

  const toggleSelectRow = useCallback((id: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedRows.size === sortedRows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(sortedRows.map(r => r.id)));
    }
  }, [selectedRows.size, sortedRows]);

  // ── Copy handler (Ctrl+C) ──
  const handleCopy = useCallback((e: React.ClipboardEvent) => {
    if (editingCell) return; // let native copy work in editing mode
    if (selectedRows.size === 0) return;
    e.preventDefault();
    const selected = sortedRows.filter(r => selectedRows.has(r.id));
    const headerLine = COLUMNS.map(c => c.label).join('\t');
    const dataLines = selected.map(r =>
      COLUMNS.map(c => String(r[c.key])).join('\t')
    );
    e.clipboardData.setData('text/plain', [headerLine, ...dataLines].join('\n'));
    setToast(`${selected.length}행이 클립보드에 복사되었습니다.`);
  }, [editingCell, selectedRows, sortedRows]);

  // ── Paste handler (Ctrl+V) ──
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (editingCell) return; // let native paste work in editing mode
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;

    const lines = text.trim().split('\n').map(line => line.split('\t'));
    if (lines.length === 0) return;

    // Detect if first line matches column headers
    let startLineIdx = 0;
    const firstLine = lines[0];
    const headerMatch = COLUMNS.some((c, i) => firstLine[i] === c.label);
    if (headerMatch && lines.length > 1) {
      startLineIdx = 1;
    }

    const newRows: ProductionResult[] = [];
    for (let i = startLineIdx; i < lines.length; i++) {
      const cells = lines[i];
      if (cells.length < 2) continue; // skip blank or incomplete lines
      const row = createEmptyRow();
      COLUMNS.forEach((col, colIdx) => {
        if (colIdx < cells.length) {
          const raw = cells[colIdx]?.trim() ?? '';
          if (col.type === 'number' || col.type === 'percent') {
            (row as any)[col.key] = parseFormattedNumber(raw);
          } else {
            (row as any)[col.key] = raw;
          }
        }
      });
      newRows.push(row);
    }

    if (newRows.length > 0) {
      setRows(prev => [...prev, ...newRows]);
      const newIds = new Set(newRows.map(r => r.id));
      setModifiedIds(prev => {
        const combined = new Set(prev);
        newIds.forEach(id => combined.add(id));
        return combined;
      });
      setToast(`${newRows.length}행이 붙여넣기 되었습니다.`);
    }
  }, [editingCell]);

  // ── Save all changes ──
  const saveAll = useCallback(async () => {
    if (modifiedIds.size === 0) {
      setToast('변경된 데이터가 없습니다.');
      return;
    }

    const modifiedRows = rows.filter(r => modifiedIds.has(r.id));

    try {
      const res = await fetch(`${API_BASE}/api/scm/production-results/bulk`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ results: modifiedRows }),
      });
      if (res.ok) {
        setModifiedIds(new Set());
        setToast(`${modifiedRows.length}건이 저장되었습니다.`);
      } else {
        throw new Error();
      }
    } catch {
      // In sample mode, just clear modified state
      setModifiedIds(new Set());
      setToast(`${modifiedRows.length}건이 저장되었습니다. (샘플 모드)`);
    }
  }, [modifiedIds, rows]);

  // ── Render guard ──
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }
  if (!user) return null;

  // ═══════════════════════════════════════════
  // JSX
  // ═══════════════════════════════════════════
  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation />

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6">
        {/* ── Page Header ── */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">생산 결과 (Production Results)</h1>
          <p className="text-sm text-slate-500 mt-1">생산일보 RAW-DATA 관리 및 분석</p>
        </div>

        {/* ── Filters Bar ── */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">시작일</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">종료일</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">생산팀</label>
              <select
                value={teamFilter}
                onChange={e => setTeamFilter(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[100px]"
              >
                {allTeams.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">품명 / 품주명 검색</label>
              <input
                type="text"
                value={productFilter}
                onChange={e => setProductFilter(e.target.value)}
                placeholder="품명 또는 품주명으로 검색..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="bg-slate-100 px-3 py-2 rounded-lg font-medium">
                {filteredRows.length}건 / {rows.length}건
              </span>
            </div>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">총 생산기준시</div>
            <div className="text-2xl font-bold text-slate-800">{summary.totalProductionHours.toLocaleString('ko-KR', { minimumFractionDigits: 1 })}h</div>
            <div className="text-xs text-emerald-600 mt-1">{summary.totalRows}건 기록</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">평균 시간당 생산량</div>
            <div className="text-2xl font-bold text-blue-600">{Math.round(summary.avgHourlyRate).toLocaleString('ko-KR')}개</div>
            <div className="text-xs text-slate-400 mt-1">per hour</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">총 예상 판매액</div>
            <div className="text-2xl font-bold text-emerald-600">{formatNumber(summary.totalExpectedSales)}</div>
            <div className="text-xs text-slate-400 mt-1">원</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">평균 원가율</div>
            <div className="text-2xl font-bold text-amber-600">{summary.avgCostRate.toFixed(1)}%</div>
            <div className="text-xs text-slate-400 mt-1">낮을수록 수익성 높음</div>
          </div>
        </div>

        {/* ── Charts Section ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Daily production trend */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">일별 생산기준시 추이</h3>
            <MiniLineChart data={dailyTrendData} labelKey="label" valueKey="value" color="#3b82f6" />
          </div>
          {/* Production by team */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">팀별 생산기준시</h3>
            <MiniBarChart data={teamChartData} labelKey="label" valueKey="value" color="#10b981" />
          </div>
          {/* Profitability distribution */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">수익성 등급 분포</h3>
            <MiniPieChart data={profitabilityPieData} />
          </div>
        </div>

        {/* ── Toolbar ── */}
        <div className="bg-white rounded-t-xl shadow-sm border border-slate-200 border-b-0 px-4 py-3 flex flex-wrap items-center gap-2">
          <button
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            행 추가
          </button>
          <button
            onClick={deleteSelectedRows}
            disabled={selectedRows.size === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            선택 삭제{selectedRows.size > 0 && ` (${selectedRows.size})`}
          </button>
          <div className="flex-1" />
          {modifiedIds.size > 0 && (
            <span className="text-xs text-amber-600 font-medium bg-amber-50 px-2 py-1 rounded">
              {modifiedIds.size}건 수정됨
            </span>
          )}
          <button
            onClick={saveAll}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            전체 저장
          </button>
          <button
            onClick={() => downloadExcel(filteredRows)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Excel 내보내기
          </button>
        </div>

        {/* ── Data Grid ── */}
        <div
          ref={tableRef}
          className="bg-white shadow-sm border border-slate-200 rounded-b-xl overflow-auto max-h-[70vh]"
          onCopy={handleCopy}
          onPaste={handlePaste}
          tabIndex={0}
          style={{ outline: 'none' }}
        >
          <table className="w-full border-collapse text-sm" style={{ minWidth: '1500px' }}>
            {/* Header */}
            <thead className="sticky top-0 z-20">
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-30 bg-slate-50 border border-slate-200 px-2 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={sortedRows.length > 0 && selectedRows.size === sortedRows.length}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="border border-slate-200 px-1 py-2 w-10 text-xs text-slate-500">#</th>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className="border border-slate-200 px-2 py-2 text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    style={{ width: col.width, textAlign: col.align }}
                    onClick={() => handleSort(col.key)}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span>{col.label}</span>
                      <span className="text-slate-400">
                        {sortField === col.key ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : '\u25B4'}
                      </span>
                    </div>
                  </th>
                ))}
                <th className="border border-slate-200 px-2 py-2 w-20 text-xs font-semibold text-slate-700">작업</th>
              </tr>
              {/* Column filter row */}
              <tr className="bg-slate-50/50">
                <th className="sticky left-0 z-30 bg-slate-50 border border-slate-200" />
                <th className="border border-slate-200" />
                {COLUMNS.map(col => (
                  <th key={col.key} className="border border-slate-200 px-1 py-1">
                    <input
                      type="text"
                      placeholder="..."
                      value={columnFilters[col.key] || ''}
                      onChange={e => setColumnFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                      className="w-full text-xs px-1 py-0.5 border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </th>
                ))}
                <th className="border border-slate-200" />
              </tr>
            </thead>

            {/* Body */}
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 3} className="text-center text-slate-400 py-16 text-sm">
                    데이터가 없습니다. 행을 추가하거나 Excel에서 붙여넣기 (Ctrl+V) 하세요.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row, rowIdx) => {
                  const isSelected = selectedRows.has(row.id);
                  const isModified = modifiedIds.has(row.id);
                  const isNewRow = row.id < 0;
                  return (
                    <tr
                      key={row.id}
                      className={`
                        ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}
                        ${isSelected ? '!bg-blue-50' : ''}
                        ${isModified ? 'border-l-2 border-l-amber-400' : ''}
                        hover:bg-blue-50/50 transition-colors
                      `}
                    >
                      {/* Checkbox */}
                      <td className="sticky left-0 z-10 bg-inherit border border-slate-200 px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(row.id)}
                          className="rounded border-slate-300"
                        />
                      </td>
                      {/* Row number */}
                      <td className="border border-slate-200 px-1 py-1 text-center text-xs text-slate-400">
                        {rowIdx + 1}
                        {isNewRow && <span className="ml-0.5 text-blue-500">*</span>}
                      </td>
                      {/* Data cells */}
                      {COLUMNS.map(col => {
                        const isEditing = editingCell?.rowIndex === rowIdx && editingCell?.colKey === col.key;
                        const rawVal = row[col.key];

                        if (isEditing) {
                          if (col.type === 'select') {
                            return (
                              <td key={col.key} className="border border-blue-400 p-0 bg-blue-50" style={{ width: col.width }}>
                                <select
                                  ref={editInputRef as any}
                                  value={editValue}
                                  onChange={e => { setEditValue(e.target.value); }}
                                  onBlur={commitEdit}
                                  onKeyDown={handleCellKeyDown}
                                  className="w-full px-1 py-1 text-sm bg-blue-50 focus:outline-none"
                                >
                                  {col.options?.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </td>
                            );
                          }
                          return (
                            <td key={col.key} className="border border-blue-400 p-0 bg-blue-50" style={{ width: col.width }}>
                              <input
                                ref={editInputRef}
                                type={col.type === 'date' ? 'date' : 'text'}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={handleCellKeyDown}
                                className="w-full px-1 py-1 text-sm bg-blue-50 focus:outline-none"
                                style={{ textAlign: col.align }}
                              />
                            </td>
                          );
                        }

                        // Display cell
                        let display: React.ReactNode;
                        if (col.key === 'profitability') {
                          const p = PROFITABILITY_COLORS[rawVal as ProfitabilityCategory];
                          display = p ? (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${p.bg} ${p.text}`}>
                              {String(rawVal)}
                            </span>
                          ) : String(rawVal);
                        } else if (col.key === 'qualityStatus') {
                          const q = QUALITY_COLORS[rawVal as QualityStatus];
                          display = q ? (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${q.bg} ${q.text}`}>
                              {String(rawVal)}
                            </span>
                          ) : String(rawVal);
                        } else if (col.format && typeof rawVal === 'number') {
                          display = col.format(rawVal);
                        } else {
                          display = String(rawVal);
                        }

                        return (
                          <td
                            key={col.key}
                            className="border border-slate-200 px-2 py-1 cursor-cell hover:bg-blue-50 whitespace-nowrap"
                            style={{ textAlign: col.align, width: col.width }}
                            onDoubleClick={() => startEditing(rowIdx, col.key)}
                          >
                            {display}
                          </td>
                        );
                      })}
                      {/* Actions */}
                      <td className="border border-slate-200 px-1 py-1 text-center whitespace-nowrap">
                        <button
                          onClick={() => duplicateRow(row.id)}
                          title="복제"
                          className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-slate-100 text-slate-500 hover:text-blue-600 transition"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2" /></svg>
                        </button>
                        <button
                          onClick={() => deleteRow(row.id)}
                          title="삭제"
                          className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 transition"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Footer info ── */}
        <div className="mt-3 flex flex-wrap items-center justify-between text-xs text-slate-500 px-1">
          <div className="flex items-center gap-4">
            <span>더블클릭하여 셀 편집</span>
            <span>Tab으로 다음 셀 이동</span>
            <span>Ctrl+C: 선택 행 복사</span>
            <span>Ctrl+V: Excel에서 붙여넣기</span>
          </div>
          <div>
            {modifiedIds.size > 0 && (
              <span className="text-amber-600 font-medium">미저장 변경사항 {modifiedIds.size}건</span>
            )}
          </div>
        </div>
      </main>

      {/* ── Toast notification ── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="bg-slate-800 text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
