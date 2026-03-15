'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

// ─────────────────────────────────────────────
// API helper
// ─────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const getAuthHeaders = () => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const fetchSafe = async <T,>(path: string, defaultValue: T): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: getAuthHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    clearTimeout(timeoutId);
    return defaultValue;
  }
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type Shift = '주간' | '야간';

interface ProductionResult {
  id: number;
  date: string;                 // 날짜
  manager: string;              // 담당자
  location: string;             // 생산 위치
  category: string;             // 품목류
  productName: string;          // 품목명
  quantity: number;             // 생산량
  totalHours: number;           // 생산 투여 총 시간
  unitPrice: number;            // 생산 단가
  totalValue: number;           // 총 생산액 (= 생산량 × 생산 단가)
  deduction: number;            // 공제액
  costPerUnit: number;          // 원가
  totalCost: number;            // 원가 총액
  shift: Shift;                 // 주간/야간 생산 구분
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
  type: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  format?: (v: any) => string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'date', label: '날짜', width: '110px', align: 'center', type: 'date' },
  { key: 'manager', label: '담당자', width: '80px', align: 'center', type: 'text' },
  { key: 'location', label: '생산 위치', width: '80px', align: 'center', type: 'text' },
  { key: 'category', label: '품목류', width: '90px', align: 'center', type: 'text' },
  { key: 'productName', label: '품목명', width: '240px', align: 'left', type: 'text' },
  { key: 'quantity', label: '생산량', width: '100px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR') },
  { key: 'totalHours', label: '생산 투여 총 시간', width: '130px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR', { minimumFractionDigits: 1 }) },
  { key: 'unitPrice', label: '생산 단가', width: '100px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR') },
  { key: 'totalValue', label: '총 생산액', width: '130px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR') },
  { key: 'deduction', label: '공제액', width: '110px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR') },
  { key: 'costPerUnit', label: '원가', width: '90px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR', { minimumFractionDigits: 1 }) },
  { key: 'totalCost', label: '원가 총액', width: '120px', align: 'right', type: 'number', format: (v: number) => v.toLocaleString('ko-KR') },
  { key: 'shift', label: '주간/야간', width: '80px', align: 'center', type: 'select', options: ['주간', '야간'] },
];

// ─────────────────────────────────────────────
// Sample data
// ─────────────────────────────────────────────
const generateSampleData = (): ProductionResult[] => [
  { id: 1,  date: '2025-12-01', manager: '권선희', location: '2층', category: '마카롱', productName: '널담 마카롱 복숭아 요거트 [50g]',       quantity: 10220, totalHours: 57.5, unitPrice: 1200, totalValue: 12264000, deduction: 981120,  costPerUnit: 290.1, totalCost: 2964822,  shift: '주간' },
  { id: 2,  date: '2025-12-01', manager: '김수현', location: '2층', category: '마카롱', productName: '널담 마카롱 녹차브라우니 [50g]',        quantity: 8500,  totalHours: 48.0, unitPrice: 1200, totalValue: 10200000, deduction: 816000,  costPerUnit: 305.2, totalCost: 2594200,  shift: '주간' },
  { id: 3,  date: '2025-12-01', manager: '이동규', location: '3층', category: '케이크', productName: '널담 당근 케이크 [1호]',                 quantity: 320,   totalHours: 24.0, unitPrice: 15000, totalValue: 4800000,  deduction: 384000,  costPerUnit: 5200.0, totalCost: 1664000,  shift: '주간' },
  { id: 4,  date: '2025-12-02', manager: '권선희', location: '2층', category: '마카롱', productName: '널담 마카롱 얼그레이캐러멜 [50g]',       quantity: 9800,  totalHours: 55.0, unitPrice: 1200, totalValue: 11760000, deduction: 940800,  costPerUnit: 288.5, totalCost: 2827300,  shift: '주간' },
  { id: 5,  date: '2025-12-02', manager: '박지영', location: '1층', category: '쿠키',   productName: '널담 버터쿠키 어쏘트먼트 [200g]',        quantity: 3500,  totalHours: 30.0, unitPrice: 3500, totalValue: 12250000, deduction: 980000,  costPerUnit: 1120.0, totalCost: 3920000,  shift: '주간' },
  { id: 6,  date: '2025-12-02', manager: '최민호', location: '1층', category: '비누',   productName: '널담 어성초 클렌징바 [100g]',             quantity: 5000,  totalHours: 20.0, unitPrice: 2800, totalValue: 14000000, deduction: 1120000, costPerUnit: 850.0,  totalCost: 4250000,  shift: '야간' },
  { id: 7,  date: '2025-12-03', manager: '김수현', location: '2층', category: '마카롱', productName: '널담 마카롱 솔티드카라멜 [50g]',          quantity: 11000, totalHours: 62.0, unitPrice: 1200, totalValue: 13200000, deduction: 1056000, costPerUnit: 278.3, totalCost: 3061300,  shift: '주간' },
  { id: 8,  date: '2025-12-03', manager: '이동규', location: '3층', category: '캔들',   productName: '널담 소이캔들 라벤더 [200g]',             quantity: 1200,  totalHours: 15.0, unitPrice: 8500, totalValue: 10200000, deduction: 816000,  costPerUnit: 3200.0, totalCost: 3840000,  shift: '주간' },
  { id: 9,  date: '2025-12-03', manager: '박지영', location: '1층', category: '쿠키',   productName: '널담 초코칩 쿠키 [150g]',                 quantity: 4200,  totalHours: 28.0, unitPrice: 3000, totalValue: 12600000, deduction: 1008000, costPerUnit: 980.0,  totalCost: 4116000,  shift: '야간' },
  { id: 10, date: '2025-12-04', manager: '권선희', location: '2층', category: '마카롱', productName: '널담 마카롱 딸기치즈케이크 [50g]',        quantity: 9500,  totalHours: 53.0, unitPrice: 1200, totalValue: 11400000, deduction: 912000,  costPerUnit: 295.0, totalCost: 2802500,  shift: '주간' },
  { id: 11, date: '2025-12-04', manager: '최민호', location: '1층', category: '비누',   productName: '널담 카렌듈라 비누 [100g]',               quantity: 4800,  totalHours: 19.0, unitPrice: 2800, totalValue: 13440000, deduction: 1075200, costPerUnit: 870.0,  totalCost: 4176000,  shift: '주간' },
  { id: 12, date: '2025-12-04', manager: '김수현', location: '3층', category: '캔들',   productName: '널담 소이캔들 유칼립투스 [200g]',          quantity: 1000,  totalHours: 12.5, unitPrice: 8500, totalValue: 8500000,  deduction: 680000,  costPerUnit: 3150.0, totalCost: 3150000,  shift: '야간' },
  { id: 13, date: '2025-12-05', manager: '이동규', location: '3층', category: '케이크', productName: '널담 바스크 치즈케이크 [1호]',             quantity: 280,   totalHours: 22.0, unitPrice: 18000, totalValue: 5040000,  deduction: 403200,  costPerUnit: 6100.0, totalCost: 1708000,  shift: '주간' },
  { id: 14, date: '2025-12-05', manager: '박지영', location: '2층', category: '마카롱', productName: '널담 마카롱 복숭아 요거트 [50g]',         quantity: 10500, totalHours: 59.0, unitPrice: 1200, totalValue: 12600000, deduction: 1008000, costPerUnit: 290.1, totalCost: 3046050,  shift: '주간' },
  { id: 15, date: '2025-12-05', manager: '최민호', location: '1층', category: '비누',   productName: '널담 티트리 클렌징바 [100g]',             quantity: 5200,  totalHours: 21.0, unitPrice: 2800, totalValue: 14560000, deduction: 1164800, costPerUnit: 860.0,  totalCost: 4472000,  shift: '야간' },
  { id: 16, date: '2025-12-06', manager: '권선희', location: '2층', category: '마카롱', productName: '널담 마카롱 녹차브라우니 [50g]',          quantity: 8800,  totalHours: 50.0, unitPrice: 1200, totalValue: 10560000, deduction: 844800,  costPerUnit: 302.0, totalCost: 2657600,  shift: '주간' },
  { id: 17, date: '2025-12-06', manager: '김수현', location: '1층', category: '쿠키',   productName: '널담 마들렌 플레인 [120g]',               quantity: 3800,  totalHours: 25.0, unitPrice: 3200, totalValue: 12160000, deduction: 972800,  costPerUnit: 1050.0, totalCost: 3990000,  shift: '주간' },
  { id: 18, date: '2025-12-06', manager: '이동규', location: '3층', category: '캔들',   productName: '널담 소이캔들 시트러스 [200g]',           quantity: 1100,  totalHours: 14.0, unitPrice: 8500, totalValue: 9350000,  deduction: 748000,  costPerUnit: 3180.0, totalCost: 3498000,  shift: '야간' },
  { id: 19, date: '2025-12-07', manager: '박지영', location: '2층', category: '마카롱', productName: '널담 마카롱 솔티드카라멜 [50g]',          quantity: 10800, totalHours: 60.5, unitPrice: 1200, totalValue: 12960000, deduction: 1036800, costPerUnit: 280.0, totalCost: 3024000,  shift: '주간' },
  { id: 20, date: '2025-12-07', manager: '최민호', location: '1층', category: '비누',   productName: '널담 어성초 클렌징바 [100g]',             quantity: 5100,  totalHours: 20.5, unitPrice: 2800, totalValue: 14280000, deduction: 1142400, costPerUnit: 855.0,  totalCost: 4360500,  shift: '주간' },
  { id: 21, date: '2025-12-08', manager: '권선희', location: '2층', category: '마카롱', productName: '널담 마카롱 얼그레이캐러멜 [50g]',       quantity: 9600,  totalHours: 54.0, unitPrice: 1200, totalValue: 11520000, deduction: 921600,  costPerUnit: 292.0, totalCost: 2803200,  shift: '야간' },
  { id: 22, date: '2025-12-08', manager: '이동규', location: '3층', category: '케이크', productName: '널담 당근 케이크 [1호]',                  quantity: 350,   totalHours: 26.0, unitPrice: 15000, totalValue: 5250000,  deduction: 420000,  costPerUnit: 5180.0, totalCost: 1813000,  shift: '주간' },
  { id: 23, date: '2025-12-09', manager: '김수현', location: '2층', category: '마카롱', productName: '널담 마카롱 딸기치즈케이크 [50g]',       quantity: 10000, totalHours: 56.0, unitPrice: 1200, totalValue: 12000000, deduction: 960000,  costPerUnit: 293.5, totalCost: 2935000,  shift: '주간' },
  { id: 24, date: '2025-12-09', manager: '최민호', location: '1층', category: '쿠키',   productName: '널담 버터쿠키 어쏘트먼트 [200g]',        quantity: 3600,  totalHours: 31.0, unitPrice: 3500, totalValue: 12600000, deduction: 1008000, costPerUnit: 1115.0, totalCost: 4014000,  shift: '야간' },
  { id: 25, date: '2025-12-10', manager: '박지영', location: '3층', category: '캔들',   productName: '널담 소이캔들 바닐라 [200g]',             quantity: 1300,  totalHours: 16.0, unitPrice: 8500, totalValue: 11050000, deduction: 884000,  costPerUnit: 3100.0, totalCost: 4030000,  shift: '주간' },
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
  date: new Date().toISOString().slice(0, 10),
  manager: '',
  location: '',
  category: '',
  productName: '',
  quantity: 0,
  totalHours: 0,
  unitPrice: 0,
  totalValue: 0,
  deduction: 0,
  costPerUnit: 0,
  totalCost: 0,
  shift: '주간',
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
  a.download = `생산일보_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────
// Shift colors
// ─────────────────────────────────────────────
const SHIFT_COLORS: Record<Shift, { bg: string; text: string }> = {
  '주간': { bg: 'bg-amber-100', text: 'text-amber-700' },
  '야간': { bg: 'bg-indigo-100', text: 'text-indigo-700' },
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
                <title>{`${d.name}: ${formatNumber(d.value)} (${((d.value / total) * 100).toFixed(1)}%)`}</title>
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
            <span className="font-semibold text-slate-800">{formatNumber(d.value)}</span>
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
  const [startDate, setStartDate] = useState('2025-12-01');
  const [endDate, setEndDate] = useState('2025-12-10');
  const [managerFilter, setManagerFilter] = useState<string>('전체');
  const [productFilter, setProductFilter] = useState<string>('');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  // Sort
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  // 품목별 시간당 생산량 section
  const [productStatsOpen, setProductStatsOpen] = useState(true);
  const [psSortField, setPsSortField] = useState<'category' | 'productName' | 'totalQty' | 'totalHours' | 'hourlyRate' | 'count'>('hourlyRate');
  const [psSortDir, setPsSortDir] = useState<'asc' | 'desc'>('desc');
  const [syncingRates, setSyncingRates] = useState(false);

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

  // ── Derived: unique managers ──
  const allManagers = useMemo(() => {
    const managers = new Set(rows.map(r => r.manager));
    return ['전체', ...Array.from(managers).sort()];
  }, [rows]);

  // ── Filtered & sorted data ──
  const filteredRows = useMemo(() => {
    let result = rows.filter(r => {
      if (startDate && r.date < startDate) return false;
      if (endDate && r.date > endDate) return false;
      if (managerFilter !== '전체' && r.manager !== managerFilter) return false;
      if (productFilter && !r.productName.includes(productFilter) && !r.category.includes(productFilter)) return false;
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
  }, [rows, startDate, endDate, managerFilter, productFilter, columnFilters]);

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
    const totalQuantity = filteredRows.reduce((s, r) => s + r.quantity, 0);
    const totalValue = filteredRows.reduce((s, r) => s + r.totalValue, 0);
    const totalHours = filteredRows.reduce((s, r) => s + r.totalHours, 0);
    const totalCostAll = filteredRows.reduce((s, r) => s + r.totalCost, 0);
    const avgCostRate = totalValue > 0 ? (totalCostAll / totalValue) * 100 : 0;
    return { totalRows, totalQuantity, totalValue, totalHours, avgCostRate };
  }, [filteredRows]);

  // ── Chart data ──
  const dailyTrendData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRows.forEach(r => {
      map[r.date] = (map[r.date] || 0) + r.totalValue;
    });
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ label: date.slice(5), value }));
  }, [filteredRows]);

  const categoryChartData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRows.forEach(r => {
      map[r.category] = (map[r.category] || 0) + r.totalValue;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, value]) => ({ label: cat, value }));
  }, [filteredRows]);

  const CATEGORY_COLORS: Record<string, string> = {
    '마카롱': '#f472b6',
    '케이크': '#fb923c',
    '쿠키': '#a78bfa',
    '비누': '#34d399',
    '캔들': '#60a5fa',
  };

  const categoryPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRows.forEach(r => {
      map[r.category] = (map[r.category] || 0) + r.quantity;
    });
    return Object.entries(map).map(([name, value]) => ({
      name,
      value,
      color: CATEGORY_COLORS[name] || '#94a3b8',
    }));
  }, [filteredRows]);

  // ── 품목별 시간당 생산량 stats ──
  const productStats = useMemo(() => {
    const stats = new Map<string, { category: string; totalQty: number; totalHours: number; count: number }>();
    filteredRows.forEach(row => {
      const key = row.productName;
      const existing = stats.get(key) || { category: row.category, totalQty: 0, totalHours: 0, count: 0 };
      existing.totalQty += row.quantity;
      existing.totalHours += row.totalHours;
      existing.count += 1;
      stats.set(key, existing);
    });
    const result = Array.from(stats.entries()).map(([name, s]) => ({
      productName: name,
      category: s.category,
      totalQty: s.totalQty,
      totalHours: s.totalHours,
      hourlyRate: s.totalHours > 0 ? s.totalQty / s.totalHours : 0,
      count: s.count,
    }));
    // Sort by selected field
    return result.sort((a, b) => {
      const aVal = a[psSortField];
      const bVal = b[psSortField];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return psSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return psSortDir === 'asc' ? -1 : 1;
      if (aStr > bStr) return psSortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredRows, psSortField, psSortDir]);

  const maxHourlyRate = useMemo(() => Math.max(...productStats.map(p => p.hourlyRate), 1), [productStats]);

  // Sync hourly rates to product master
  const syncRatesToProducts = useCallback(async () => {
    setSyncingRates(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const payload = productStats.map(p => ({
        productName: p.productName,
        category: p.category,
        hourlyRate: p.hourlyRate,
        totalQty: p.totalQty,
        totalHours: p.totalHours,
        count: p.count,
      }));
      const res = await fetch(`${API_BASE}/api/scm/products/sync-rates`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ rates: payload }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        setToast('시간당 생산량이 품목 관리에 동기화되었습니다.');
      } else {
        throw new Error();
      }
    } catch {
      clearTimeout(timeoutId);
      setToast('시간당 생산량이 품목 관리에 동기화되었습니다. (샘플 모드)');
    } finally {
      setSyncingRates(false);
    }
  }, [productStats]);

  const handlePsSort = useCallback((field: typeof psSortField) => {
    if (psSortField === field) {
      setPsSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setPsSortField(field);
      setPsSortDir(field === 'category' || field === 'productName' ? 'asc' : 'desc');
    }
  }, [psSortField]);

  // Category badge colors
  const CATEGORY_BADGE: Record<string, { bg: string; text: string }> = {
    '마카롱': { bg: 'bg-pink-100', text: 'text-pink-700' },
    '케이크': { bg: 'bg-amber-100', text: 'text-amber-700' },
    '쿠키':   { bg: 'bg-orange-100', text: 'text-orange-700' },
    '비누':   { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    '캔들':   { bg: 'bg-purple-100', text: 'text-purple-700' },
  };

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
    if (col?.type === 'number') {
      newValue = parseFormattedNumber(editValue);
    }

    setRows(prev => prev.map(r => {
      if (r.id === row.id) {
        const updated = { ...r, [colKey]: newValue };
        // Auto-calculate 총 생산액 when 생산량 or 생산 단가 changes
        if (colKey === 'quantity' || colKey === 'unitPrice') {
          const qty = colKey === 'quantity' ? (newValue as number) : r.quantity;
          const price = colKey === 'unitPrice' ? (newValue as number) : r.unitPrice;
          updated.totalValue = qty * price;
        }
        return updated;
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
  // Column order from the Excel file:
  // 날짜, 담당자, 생산 위치, 품목류, 품목명, 생산량, 생산 투여 총 시간, 생산 단가, 총 생산액, 공제액, 원가, 원가 총액, 주간/야간
  const PASTE_COLUMN_KEYS: (keyof ProductionResult)[] = [
    'date', 'manager', 'location', 'category', 'productName',
    'quantity', 'totalHours', 'unitPrice', 'totalValue',
    'deduction', 'costPerUnit', 'totalCost', 'shift',
  ];

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

    const numericKeys = new Set<keyof ProductionResult>([
      'quantity', 'totalHours', 'unitPrice', 'totalValue',
      'deduction', 'costPerUnit', 'totalCost',
    ]);

    const newRows: ProductionResult[] = [];
    for (let i = startLineIdx; i < lines.length; i++) {
      const cells = lines[i];
      if (cells.length < 2) continue; // skip blank or incomplete lines
      const row = createEmptyRow();
      PASTE_COLUMN_KEYS.forEach((key, colIdx) => {
        if (colIdx < cells.length) {
          const raw = cells[colIdx]?.trim() ?? '';
          if (numericKeys.has(key)) {
            (row as any)[key] = parseFormattedNumber(raw);
          } else {
            (row as any)[key] = raw;
          }
        }
      });
      // Auto-calculate 총 생산액 if it was not provided or is 0
      if (row.totalValue === 0 && row.quantity > 0 && row.unitPrice > 0) {
        row.totalValue = row.quantity * row.unitPrice;
      }
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${API_BASE}/api/scm/production-results/bulk`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ results: modifiedRows }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        setModifiedIds(new Set());
        setToast(`${modifiedRows.length}건이 저장되었습니다.`);
      } else {
        throw new Error();
      }
    } catch {
      clearTimeout(timeoutId);
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
              <label className="block text-xs font-medium text-slate-600 mb-1">담당자</label>
              <select
                value={managerFilter}
                onChange={e => setManagerFilter(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[100px]"
              >
                {allManagers.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">품목명 / 품목류 검색</label>
              <input
                type="text"
                value={productFilter}
                onChange={e => setProductFilter(e.target.value)}
                placeholder="품목명 또는 품목류로 검색..."
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
            <div className="text-xs text-slate-500 mb-1">총 생산량</div>
            <div className="text-2xl font-bold text-slate-800">{formatNumber(summary.totalQuantity)}</div>
            <div className="text-xs text-emerald-600 mt-1">{summary.totalRows}건 기록</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">총 생산액</div>
            <div className="text-2xl font-bold text-blue-600">{formatNumber(summary.totalValue)}</div>
            <div className="text-xs text-slate-400 mt-1">원</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">총 투여 시간</div>
            <div className="text-2xl font-bold text-emerald-600">{summary.totalHours.toLocaleString('ko-KR', { minimumFractionDigits: 1 })}h</div>
            <div className="text-xs text-slate-400 mt-1">생산 투여 총 시간 합계</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">평균 원가율</div>
            <div className="text-2xl font-bold text-amber-600">{summary.avgCostRate.toFixed(1)}%</div>
            <div className="text-xs text-slate-400 mt-1">원가 총액 / 총 생산액</div>
          </div>
        </div>

        {/* ── Charts Section ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Daily production value trend */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">일별 총 생산액 추이</h3>
            <MiniLineChart data={dailyTrendData} labelKey="label" valueKey="value" color="#3b82f6" />
          </div>
          {/* Production value by category */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">품목류별 총 생산액</h3>
            <MiniBarChart data={categoryChartData} labelKey="label" valueKey="value" color="#10b981" />
          </div>
          {/* Category quantity distribution */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">품목류별 생산량 분포</h3>
            <MiniPieChart data={categoryPieData} />
          </div>
        </div>

        {/* ── 품목별 시간당 생산량 Section ── */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 overflow-hidden">
          {/* Collapsible header */}
          <button
            onClick={() => setProductStatsOpen(prev => !prev)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition"
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${productStatsOpen ? 'rotate-90' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <h3 className="text-sm font-semibold text-slate-700">품목별 시간당 생산량</h3>
              <span className="text-xs text-slate-400 ml-1">품목별 생산 효율 분석</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{productStats.length}개 품목</span>
            </div>
          </button>

          {productStatsOpen && (
            <div className="border-t border-slate-200">
              {/* Sync button bar */}
              <div className="px-5 py-2 border-b border-slate-100 flex items-center justify-end">
                <button
                  onClick={syncRatesToProducts}
                  disabled={syncingRates || productStats.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {syncingRates ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  )}
                  품목 관리에 동기화
                </button>
              </div>

              {/* Stats table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      {([
                        { field: 'category' as const, label: '품목류', align: 'center' },
                        { field: 'productName' as const, label: '품목명', align: 'left' },
                        { field: 'totalQty' as const, label: '총 생산량', align: 'right' },
                        { field: 'totalHours' as const, label: '총 투여 시간', align: 'right' },
                        { field: 'hourlyRate' as const, label: '시간당 생산량', align: 'right' },
                        { field: 'count' as const, label: '데이터 건수', align: 'center' },
                      ]).map(col => (
                        <th
                          key={col.field}
                          className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                          style={{ textAlign: col.align as any }}
                          onClick={() => handlePsSort(col.field)}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span>{col.label}</span>
                            <span className="text-slate-400">
                              {psSortField === col.field ? (psSortDir === 'asc' ? '\u25B2' : '\u25BC') : '\u25B4'}
                            </span>
                          </div>
                        </th>
                      ))}
                      <th className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 text-left" style={{ minWidth: '120px' }}>
                        효율 비교
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {productStats.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center text-slate-400 py-8 text-sm">
                          해당 기간에 데이터가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      (() => {
                        // Determine top 3 and bottom 3 by hourly rate
                        const sortedByRate = [...productStats].sort((a, b) => b.hourlyRate - a.hourlyRate);
                        const topNames = new Set(sortedByRate.slice(0, 3).map(p => p.productName));
                        const bottomNames = new Set(sortedByRate.slice(-Math.min(3, sortedByRate.length)).map(p => p.productName));
                        // If total items <= 6, don't overlap: bottom only includes items NOT in top
                        const effectiveBottom = new Set(
                          Array.from(bottomNames).filter(n => !topNames.has(n))
                        );

                        return productStats.map((ps, idx) => {
                          const badge = CATEGORY_BADGE[ps.category] || { bg: 'bg-slate-100', text: 'text-slate-700' };
                          const isTop = topNames.has(ps.productName);
                          const isBottom = effectiveBottom.has(ps.productName);
                          const rateColor = isTop ? 'text-emerald-600 font-semibold' : isBottom ? 'text-orange-600 font-semibold' : 'text-slate-800';
                          const rowBg = isTop ? 'bg-emerald-50/40' : isBottom ? 'bg-orange-50/40' : (idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50');
                          const barPct = maxHourlyRate > 0 ? (ps.hourlyRate / maxHourlyRate) * 100 : 0;
                          const barColor = isTop ? '#10b981' : isBottom ? '#f97316' : '#3b82f6';

                          return (
                            <tr key={ps.productName} className={`${rowBg} hover:bg-blue-50/50 transition-colors`}>
                              <td className="border-b border-slate-100 px-3 py-2 text-center whitespace-nowrap">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}>
                                  {ps.category}
                                </span>
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2 text-left whitespace-nowrap text-slate-800">
                                {ps.productName}
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2 text-right whitespace-nowrap text-slate-800">
                                {formatNumber(ps.totalQty)}
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2 text-right whitespace-nowrap text-slate-800">
                                {ps.totalHours.toLocaleString('ko-KR', { minimumFractionDigits: 1 })}시간
                              </td>
                              <td className={`border-b border-slate-100 px-3 py-2 text-right whitespace-nowrap ${rateColor}`}>
                                {ps.hourlyRate.toFixed(1)}개/시
                                {isTop && <span className="ml-1 text-emerald-500 text-xs align-top">{'\u25B2'}</span>}
                                {isBottom && <span className="ml-1 text-orange-500 text-xs align-top">{'\u25BC'}</span>}
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2 text-center whitespace-nowrap text-slate-600">
                                {ps.count}건
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden" style={{ minWidth: '80px' }}>
                                    <div
                                      className="h-full rounded-full transition-all duration-500"
                                      style={{ width: `${barPct}%`, backgroundColor: barColor }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-slate-400 whitespace-nowrap w-8 text-right">{barPct.toFixed(0)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        });
                      })()
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
          <table className="w-full border-collapse text-sm" style={{ minWidth: '1600px' }}>
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
                        if (col.key === 'shift') {
                          const s = SHIFT_COLORS[rawVal as Shift];
                          display = s ? (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
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
