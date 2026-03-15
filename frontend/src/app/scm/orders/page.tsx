'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

// ─────────────────────────────────────────────
// API Helper
// ─────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const getAuthHeaders = () => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const fetchSafe = async <T,>(path: string, defaultValue: T): Promise<T> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders(), signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return Array.isArray(defaultValue) && !Array.isArray(data) ? defaultValue : data;
  } catch {
    return defaultValue;
  }
};

const postSafe = async <T,>(path: string, body: unknown, defaultValue: T): Promise<T> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return defaultValue;
  }
};

const deleteSafe = async (path: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type ChannelType = '온라인' | '오프라인';
type ViewMode = 'pivot' | 'detail';

interface OrderPlanRow {
  id: number;
  productName: string;
  productOwner: string;
  channelType: ChannelType;
  channelName: string;
  assignee: string;
  plannedQty: number;
  actualQty: number;
  unitPrice: number;
  memo: string;
  planDate: string; // YYYY-MM-DD
}

interface EditableRow extends OrderPlanRow {
  _dirty: boolean;
  _isNew: boolean;
}

type ColumnKey = keyof Omit<OrderPlanRow, 'id'>;

interface ColumnDef {
  key: ColumnKey;
  label: string;
  width: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
  align?: 'left' | 'center' | 'right';
}

interface PivotCellBreakdown {
  channelName: string;
  channelType: ChannelType;
  assignee: string;
  qty: number;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const COLUMNS: ColumnDef[] = [
  { key: 'productName',  label: '품명',       width: 'w-40', type: 'text' },
  { key: 'productOwner', label: '품주명',     width: 'w-28', type: 'text' },
  { key: 'channelType',  label: '채널구분',   width: 'w-24', type: 'select', options: ['온라인', '오프라인'], align: 'center' },
  { key: 'channelName',  label: '채널명',     width: 'w-32', type: 'text' },
  { key: 'assignee',     label: '담당자',     width: 'w-24', type: 'text' },
  { key: 'planDate',     label: '계획일자',   width: 'w-28', type: 'text' },
  { key: 'plannedQty',   label: '계획수량',   width: 'w-24', type: 'number', align: 'right' },
  { key: 'actualQty',    label: '실제수량',   width: 'w-24', type: 'number', align: 'right' },
  { key: 'unitPrice',    label: '단가',       width: 'w-28', type: 'number', align: 'right' },
  { key: 'memo',         label: '비고',       width: 'w-44', type: 'text' },
];

const CHANNEL_NAMES_ONLINE = ['스마트스토어', '쿠팡', '올리브영', '자사몰'];
const CHANNEL_NAMES_OFFLINE = ['올리브영', '백화점', 'H&B매장', '할인점'];

const SAMPLE_PRODUCTS = [
  '널담 마카롱 복숭아 요거트 [50g]',
  '널담 마카롱 녹차브라우니 [50g]',
  '널담 케이크 바닐라치즈 [120g]',
  '수제 비누 라벤더 [100g]',
  '버터 쿠키 어쏘트 [150g]',
  '아로마 캔들 우드 [200g]',
];

const SAMPLE_CHANNELS = ['스마트스토어', '쿠팡', '올리브영', '자사몰'];
const SAMPLE_ASSIGNEES = ['김민수', '이지은', '박서연'];

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

// ─────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────
const formatNumber = (n: number): string => n.toLocaleString('ko-KR');

const formatCurrency = (n: number): string => `₩${n.toLocaleString('ko-KR')}`;

const getWeekRange = (date: Date): { start: string; end: string } => {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
};

const toEditableRow = (row: OrderPlanRow): EditableRow => ({
  ...row,
  _dirty: false,
  _isNew: false,
});

let _tempIdCounter = -1;
const nextTempId = (): number => _tempIdCounter--;

const createEmptyRow = (planDate: string): EditableRow => ({
  id: nextTempId(),
  productName: '',
  productOwner: '',
  channelType: '온라인',
  channelName: '',
  assignee: '',
  plannedQty: 0,
  actualQty: 0,
  unitPrice: 0,
  memo: '',
  planDate,
  _dirty: true,
  _isNew: true,
});

/** Generate dates between start and end inclusive */
const getDatesBetween = (startStr: string, endStr: string): string[] => {
  const dates: string[] = [];
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
};

/** Format date like "3/15(월)" */
const formatDateLabel = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];
  return `${month}/${day}(${dayName})`;
};

// ─────────────────────────────────────────────
// Sample Data Generator (with dates)
// ─────────────────────────────────────────────
const generateSampleData = (): OrderPlanRow[] => {
  const { start } = getWeekRange(new Date());
  const dates = getDatesBetween(start, (() => {
    const s = new Date(start + 'T00:00:00');
    s.setDate(s.getDate() + 6);
    return s.toISOString().slice(0, 10);
  })());

  const rows: OrderPlanRow[] = [];
  let idCounter = 1;

  // Base quantities per product (varies by product)
  const productBaseQty: Record<string, number> = {
    '널담 마카롱 복숭아 요거트 [50g]': 500,
    '널담 마카롱 녹차브라우니 [50g]': 300,
    '널담 케이크 바닐라치즈 [120g]': 100,
    '수제 비누 라벤더 [100g]': 200,
    '버터 쿠키 어쏘트 [150g]': 250,
    '아로마 캔들 우드 [200g]': 150,
  };

  // Seeded pseudo-random for consistent data
  const seededRandom = (seed: number): number => {
    const x = Math.sin(seed * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  };

  let seed = 42;

  SAMPLE_PRODUCTS.forEach((product) => {
    const baseQty = productBaseQty[product] || 200;

    dates.forEach((date) => {
      // Each product gets 1-3 channel entries per date
      const channelCount = 1 + Math.floor(seededRandom(seed++) * 3);

      for (let c = 0; c < channelCount; c++) {
        const channelIdx = Math.floor(seededRandom(seed++) * SAMPLE_CHANNELS.length);
        const assigneeIdx = Math.floor(seededRandom(seed++) * SAMPLE_ASSIGNEES.length);
        const variation = 0.5 + seededRandom(seed++) * 1.0; // 50% - 150%
        const qty = Math.round(baseQty * variation / channelCount);
        const isOnline = SAMPLE_CHANNELS[channelIdx] !== '올리브영';

        rows.push({
          id: idCounter++,
          productName: product,
          productOwner: '(주)널담',
          channelType: isOnline ? '온라인' : '오프라인',
          channelName: SAMPLE_CHANNELS[channelIdx],
          assignee: SAMPLE_ASSIGNEES[assigneeIdx],
          plannedQty: qty,
          actualQty: Math.round(qty * (0.7 + seededRandom(seed++) * 0.4)),
          unitPrice: Math.round((baseQty * 50 + seededRandom(seed++) * 5000) / 100) * 100,
          memo: '',
          planDate: date,
        });
      }
    });
  });

  return rows;
};

// ─────────────────────────────────────────────
// Excel Download (Detail)
// ─────────────────────────────────────────────
const downloadDetailExcel = (rows: EditableRow[]) => {
  const BOM = '\uFEFF';
  const headers = ['품명', '품주명', '채널구분', '채널명', '담당자', '계획일자', '계획수량', '실제수량', '단가', '비고'];
  const csvRows = rows.map(r => [
    r.productName, r.productOwner, r.channelType, r.channelName, r.assignee,
    r.planDate, r.plannedQty, r.actualQty, r.unitPrice, r.memo,
  ]);
  const csv = [headers, ...csvRows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `주문계획_상세_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────
// Excel Download (Pivot)
// ─────────────────────────────────────────────
const downloadPivotExcel = (
  productNames: string[],
  dates: string[],
  pivotData: Record<string, Record<string, number>>,
  dateTotals: Record<string, number>,
  productTotals: Record<string, number>,
  grandTotal: number
) => {
  const BOM = '\uFEFF';
  const headerRow = ['품목명', ...dates.map(formatDateLabel), '합계'];
  const dataRows = productNames.map(product => {
    const row = [product];
    dates.forEach(date => {
      row.push(String(pivotData[product]?.[date] || 0));
    });
    row.push(String(productTotals[product] || 0));
    return row;
  });
  const totalRow = ['합계', ...dates.map(d => String(dateTotals[d] || 0)), String(grandTotal)];
  const csv = [headerRow, ...dataRows, totalRow].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `주문계획_피벗_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ═══════════════════════════════════════════════
// Paste Preview Modal Component
// ═══════════════════════════════════════════════
function PastePreviewModal({
  rows,
  onConfirm,
  onCancel,
}: {
  rows: Partial<OrderPlanRow>[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col mx-4">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800">붙여넣기 미리보기</h3>
            <p className="text-sm text-slate-500 mt-0.5">{rows.length}행이 추가됩니다. 확인 후 적용하세요.</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <div className="overflow-auto flex-1 p-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50">
                {COLUMNS.map(col => (
                  <th key={col.key} className="px-3 py-2 text-left font-semibold text-slate-600 border border-slate-200">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-blue-50/50">
                  {COLUMNS.map(col => (
                    <td key={col.key} className="px-3 py-1.5 border border-slate-200 text-slate-700">
                      {String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
          >
            적용 ({rows.length}행 추가)
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Autocomplete Dropdown Component
// ═══════════════════════════════════════════════
function AutocompleteDropdown({
  suggestions,
  onSelect,
  visible,
  top,
  left,
  width,
}: {
  suggestions: string[];
  onSelect: (value: string) => void;
  visible: boolean;
  top: number;
  left: number;
  width: number;
}) {
  if (!visible || suggestions.length === 0) return null;
  return (
    <div
      className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto"
      style={{ top, left, width: Math.max(width, 200) }}
    >
      {suggestions.map((s, i) => (
        <button
          key={i}
          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(s);
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Pivot Cell Breakdown Modal
// ═══════════════════════════════════════════════
function CellBreakdownModal({
  productName,
  dateLabel,
  breakdown,
  totalQty,
  onClose,
}: {
  productName: string;
  dateLabel: string;
  breakdown: PivotCellBreakdown[];
  totalQty: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800">수량 상세</h3>
            <p className="text-sm text-slate-500 mt-0.5">{productName} - {dateLabel}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <div className="p-4">
          {breakdown.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">데이터가 없습니다</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left font-semibold text-slate-600 border border-slate-200">채널구분</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600 border border-slate-200">채널명</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600 border border-slate-200">담당자</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600 border border-slate-200">수량</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((b, i) => (
                  <tr key={i} className="hover:bg-blue-50/50">
                    <td className="px-3 py-2 border border-slate-200">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        b.channelType === '온라인' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {b.channelType}
                      </span>
                    </td>
                    <td className="px-3 py-2 border border-slate-200 text-slate-700">{b.channelName}</td>
                    <td className="px-3 py-2 border border-slate-200 text-slate-700">{b.assignee}</td>
                    <td className="px-3 py-2 border border-slate-200 text-right text-slate-700 font-medium">{formatNumber(b.qty)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={3} className="px-3 py-2 border border-slate-200 text-slate-700">합계</td>
                  <td className="px-3 py-2 border border-slate-200 text-right text-slate-800">{formatNumber(totalQty)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function OrderPlanPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ── View Mode ──
  const [viewMode, setViewMode] = useState<ViewMode>('pivot');

  // ── Date Range State ──
  const [dateRange, setDateRange] = useState(() => getWeekRange(new Date()));

  // ── Data State ──
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Filter State ──
  const [filterProduct, setFilterProduct] = useState('');
  const [filterChannelType, setFilterChannelType] = useState<ChannelType | '전체'>('전체');
  const [filterAssignee, setFilterAssignee] = useState<string>('전체');

  // ── Selection / Editing State (detail view) ──
  const [selectedCell, setSelectedCell] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // ── Autocomplete State ──
  const [productSuggestions, setProductSuggestions] = useState<string[]>(SAMPLE_PRODUCTS);
  const [assigneeSuggestions, setAssigneeSuggestions] = useState<string[]>(SAMPLE_ASSIGNEES);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompletePos, setAutocompletePos] = useState({ top: 0, left: 0, width: 0 });
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<string[]>([]);

  // ── Paste Preview State ──
  const [pastePreview, setPastePreview] = useState<Partial<OrderPlanRow>[] | null>(null);

  // ── Pivot Cell Breakdown State ──
  const [breakdownModal, setBreakdownModal] = useState<{
    productName: string;
    dateLabel: string;
    breakdown: PivotCellBreakdown[];
    totalQty: number;
  } | null>(null);

  // ── Refs ──
  const tableRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const editSelectRef = useRef<HTMLSelectElement>(null);

  // ── Selected Rows for Bulk Delete ──
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(new Set());

  // ── Auth guard ──
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // ── Load Data ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      start_date: dateRange.start,
      end_date: dateRange.end,
    });
    if (filterProduct) params.set('product', filterProduct);
    if (filterChannelType !== '전체') params.set('channel_type', filterChannelType);
    if (filterAssignee !== '전체') params.set('assignee', filterAssignee);

    const data = await fetchSafe<OrderPlanRow[]>(`/api/scm/order-plans?${params}`, generateSampleData());
    setRows(data.map(toEditableRow));
    setSelectedRowIds(new Set());
    setLoading(false);
  }, [dateRange, filterProduct, filterChannelType, filterAssignee]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Load Suggestions ──
  useEffect(() => {
    (async () => {
      const products = await fetchSafe<string[]>('/api/scm/order-plans/products', SAMPLE_PRODUCTS);
      setProductSuggestions(products);
      const assignees = await fetchSafe<string[]>('/api/scm/order-plans/assignees', SAMPLE_ASSIGNEES);
      setAssigneeSuggestions(assignees);
    })();
  }, []);

  // ── Filtered Rows ──
  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      if (filterProduct && !row.productName.toLowerCase().includes(filterProduct.toLowerCase())) return false;
      if (filterChannelType !== '전체' && row.channelType !== filterChannelType) return false;
      if (filterAssignee !== '전체' && row.assignee !== filterAssignee) return false;
      return true;
    });
  }, [rows, filterProduct, filterChannelType, filterAssignee]);

  // ── Dates in current range ──
  const datesInRange = useMemo(() => getDatesBetween(dateRange.start, dateRange.end), [dateRange]);

  // ── Pivot Data Computation ──
  const pivotComputed = useMemo(() => {
    // Group by productName + planDate, sum plannedQty
    const pivotData: Record<string, Record<string, number>> = {};
    // For breakdown: productName + planDate => array of {channelName, channelType, assignee, qty}
    const breakdownData: Record<string, Record<string, PivotCellBreakdown[]>> = {};
    const productSet = new Set<string>();

    filteredRows.forEach(row => {
      if (!row.productName) return;
      productSet.add(row.productName);

      if (!pivotData[row.productName]) pivotData[row.productName] = {};
      if (!breakdownData[row.productName]) breakdownData[row.productName] = {};

      const date = row.planDate;
      if (date) {
        pivotData[row.productName][date] = (pivotData[row.productName][date] || 0) + row.plannedQty;
        if (!breakdownData[row.productName][date]) breakdownData[row.productName][date] = [];
        breakdownData[row.productName][date].push({
          channelName: row.channelName,
          channelType: row.channelType,
          assignee: row.assignee,
          qty: row.plannedQty,
        });
      }
    });

    const productNames = Array.from(productSet).sort();

    // Product totals (sum across all dates)
    const productTotals: Record<string, number> = {};
    productNames.forEach(p => {
      productTotals[p] = datesInRange.reduce((sum, d) => sum + (pivotData[p]?.[d] || 0), 0);
    });

    // Date totals (sum across all products)
    const dateTotals: Record<string, number> = {};
    datesInRange.forEach(d => {
      dateTotals[d] = productNames.reduce((sum, p) => sum + (pivotData[p]?.[d] || 0), 0);
    });

    // Grand total
    const grandTotal = Object.values(productTotals).reduce((s, v) => s + v, 0);

    // Max cell value (for heatmap)
    let maxCellValue = 0;
    productNames.forEach(p => {
      datesInRange.forEach(d => {
        const val = pivotData[p]?.[d] || 0;
        if (val > maxCellValue) maxCellValue = val;
      });
    });

    return { pivotData, breakdownData, productNames, productTotals, dateTotals, grandTotal, maxCellValue };
  }, [filteredRows, datesInRange]);

  // ── Summary Stats ──
  const summary = useMemo(() => {
    const uniqueProducts = new Set(filteredRows.map(r => r.productName).filter(Boolean));
    const totalPlanned = filteredRows.reduce((s, r) => s + r.plannedQty, 0);
    const totalActual = filteredRows.reduce((s, r) => s + r.actualQty, 0);

    // Days with data
    const datesWithData = new Set(filteredRows.map(r => r.planDate).filter(Boolean));
    const dayCount = Math.max(datesWithData.size, 1);
    const avgDailyQty = Math.round(totalPlanned / dayCount);

    // Channel ratio
    let onlineQty = 0;
    let offlineQty = 0;
    filteredRows.forEach(r => {
      if (r.channelType === '온라인') onlineQty += r.plannedQty;
      else offlineQty += r.plannedQty;
    });
    const totalChannelQty = onlineQty + offlineQty;
    const onlineRatio = totalChannelQty > 0 ? Math.round((onlineQty / totalChannelQty) * 100) : 0;
    const offlineRatio = totalChannelQty > 0 ? 100 - onlineRatio : 0;

    return {
      uniqueProductCount: uniqueProducts.size,
      totalPlanned,
      totalActual,
      avgDailyQty,
      onlineQty,
      offlineQty,
      onlineRatio,
      offlineRatio,
    };
  }, [filteredRows]);

  // ── Unique assignees from current data ──
  const uniqueAssignees = useMemo(() => {
    const set = new Set(rows.map(r => r.assignee).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  // ── Dirty Row Count ──
  const dirtyCount = useMemo(() => rows.filter(r => r._dirty).length, [rows]);

  // ── Heatmap color function ──
  const getHeatmapColor = useCallback((value: number, maxVal: number): string => {
    if (value === 0 || maxVal === 0) return 'bg-slate-50';
    const intensity = value / maxVal;
    if (intensity > 0.8) return 'bg-blue-500 text-white';
    if (intensity > 0.6) return 'bg-blue-400 text-white';
    if (intensity > 0.4) return 'bg-blue-300 text-blue-900';
    if (intensity > 0.2) return 'bg-blue-200 text-blue-800';
    return 'bg-blue-100 text-blue-700';
  }, []);

  // ── Cell Editing (detail view) ──
  const startEditing = useCallback((rowIdx: number, colIdx: number) => {
    const row = filteredRows[rowIdx];
    if (!row) return;
    const col = COLUMNS[colIdx];
    setEditingCell({ rowIdx, colIdx });
    setEditValue(String(row[col.key]));
    setSelectedCell({ rowIdx, colIdx });

    if (col.key === 'productName') {
      setAutocompleteSuggestions(productSuggestions);
      setShowAutocomplete(true);
    } else if (col.key === 'assignee') {
      setAutocompleteSuggestions(assigneeSuggestions);
      setShowAutocomplete(true);
    } else {
      setShowAutocomplete(false);
    }
  }, [filteredRows, productSuggestions, assigneeSuggestions]);

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const { rowIdx, colIdx } = editingCell;
    const row = filteredRows[rowIdx];
    if (!row) return;
    const col = COLUMNS[colIdx];
    const realRowIdx = rows.findIndex(r => r.id === row.id);
    if (realRowIdx === -1) return;

    let newValue: string | number = editValue;
    if (col.type === 'number') {
      newValue = Number(editValue) || 0;
    }

    setRows(prev => {
      const updated = [...prev];
      updated[realRowIdx] = {
        ...updated[realRowIdx],
        [col.key]: newValue,
        _dirty: true,
      };
      return updated;
    });

    setEditingCell(null);
    setShowAutocomplete(false);
  }, [editingCell, editValue, filteredRows, rows]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setShowAutocomplete(false);
  }, []);

  // ── Keyboard Navigation ──
  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, rowIdx: number, colIdx: number) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      if (e.key === 'Tab' && !e.shiftKey) {
        const nextCol = colIdx + 1;
        if (nextCol < COLUMNS.length) {
          setTimeout(() => startEditing(rowIdx, nextCol), 0);
        } else if (rowIdx + 1 < filteredRows.length) {
          setTimeout(() => startEditing(rowIdx + 1, 0), 0);
        }
      } else if (e.key === 'Tab' && e.shiftKey) {
        const prevCol = colIdx - 1;
        if (prevCol >= 0) {
          setTimeout(() => startEditing(rowIdx, prevCol), 0);
        } else if (rowIdx > 0) {
          setTimeout(() => startEditing(rowIdx - 1, COLUMNS.length - 1), 0);
        }
      } else if (e.key === 'Enter') {
        if (rowIdx + 1 < filteredRows.length) {
          setTimeout(() => startEditing(rowIdx + 1, colIdx), 0);
        }
      }
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  }, [commitEdit, cancelEdit, startEditing, filteredRows.length]);

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (editingCell) return;
    if (!selectedCell) return;

    const { rowIdx, colIdx } = selectedCell;
    let newRow = rowIdx;
    let newCol = colIdx;

    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); newRow = Math.max(0, rowIdx - 1); break;
      case 'ArrowDown':  e.preventDefault(); newRow = Math.min(filteredRows.length - 1, rowIdx + 1); break;
      case 'ArrowLeft':  e.preventDefault(); newCol = Math.max(0, colIdx - 1); break;
      case 'ArrowRight': e.preventDefault(); newCol = Math.min(COLUMNS.length - 1, colIdx + 1); break;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        startEditing(rowIdx, colIdx);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        startEditing(rowIdx, colIdx);
        setEditValue('');
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          startEditing(rowIdx, colIdx);
          setEditValue(e.key);
          return;
        }
        return;
    }

    setSelectedCell({ rowIdx: newRow, colIdx: newCol });
  }, [editingCell, selectedCell, filteredRows.length, startEditing]);

  // ── Paste Handler ──
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (viewMode !== 'detail') return;
      if (!tableRef.current?.contains(document.activeElement) && document.activeElement !== tableRef.current) return;
      if (editingCell) return;

      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;

      const lines = text.split('\n').filter(line => line.trim());
      if (lines.length === 0) return;

      const parsedRows: Partial<OrderPlanRow>[] = lines.map(line => {
        const cells = line.split('\t');
        const row: Partial<OrderPlanRow> = {};
        COLUMNS.forEach((col, i) => {
          if (i < cells.length) {
            const val = cells[i]?.trim() ?? '';
            if (col.type === 'number') {
              (row as Record<string, unknown>)[col.key] = Number(val.replace(/[,₩\s]/g, '')) || 0;
            } else {
              (row as Record<string, unknown>)[col.key] = val;
            }
          }
        });
        return row;
      });

      setPastePreview(parsedRows);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [editingCell, viewMode]);

  const confirmPaste = useCallback(() => {
    if (!pastePreview) return;
    const newRows: EditableRow[] = pastePreview.map(partial => ({
      id: nextTempId(),
      productName: '',
      productOwner: '',
      channelType: '온라인' as ChannelType,
      channelName: '',
      assignee: '',
      plannedQty: 0,
      actualQty: 0,
      unitPrice: 0,
      memo: '',
      planDate: dateRange.start,
      ...partial,
      _dirty: true,
      _isNew: true,
    }));
    setRows(prev => [...prev, ...newRows]);
    setPastePreview(null);
  }, [pastePreview, dateRange.start]);

  // ── Row Operations ──
  const addRow = useCallback(() => {
    setRows(prev => [...prev, createEmptyRow(dateRange.start)]);
  }, [dateRange.start]);

  const addMultipleRows = useCallback((count: number) => {
    const newRows = Array.from({ length: count }, () => createEmptyRow(dateRange.start));
    setRows(prev => [...prev, ...newRows]);
  }, [dateRange.start]);

  const deleteRow = useCallback((id: number) => {
    setRows(prev => prev.filter(r => r.id !== id));
    if (id > 0) {
      deleteSafe(`/api/scm/order-plans/${id}`);
    }
  }, []);

  const deleteSelectedRows = useCallback(() => {
    if (selectedRowIds.size === 0) return;
    if (!window.confirm(`선택한 ${selectedRowIds.size}개 행을 삭제하시겠습니까?`)) return;

    selectedRowIds.forEach(id => {
      if (id > 0) deleteSafe(`/api/scm/order-plans/${id}`);
    });

    setRows(prev => prev.filter(r => !selectedRowIds.has(r.id)));
    setSelectedRowIds(new Set());
  }, [selectedRowIds]);

  const toggleRowSelection = useCallback((id: number) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllSelection = useCallback(() => {
    if (selectedRowIds.size === filteredRows.length) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(filteredRows.map(r => r.id)));
    }
  }, [selectedRowIds, filteredRows]);

  // ── Save ──
  const handleSave = useCallback(async () => {
    const dirtyRows = rows.filter(r => r._dirty);
    if (dirtyRows.length === 0) {
      setSaveMessage({ type: 'success', text: '변경사항이 없습니다.' });
      setTimeout(() => setSaveMessage(null), 3000);
      return;
    }

    setSaving(true);
    const payload = dirtyRows.map(r => ({
      id: r._isNew ? null : r.id,
      product_name: r.productName,
      product_owner: r.productOwner,
      channel_type: r.channelType,
      channel_name: r.channelName,
      assignee: r.assignee,
      planned_qty: r.plannedQty,
      actual_qty: r.actualQty,
      unit_price: r.unitPrice,
      memo: r.memo,
      plan_date: r.planDate,
      start_date: dateRange.start,
      end_date: dateRange.end,
    }));

    const result = await postSafe<{ success: boolean; data?: OrderPlanRow[] }>(
      '/api/scm/order-plans/bulk',
      { items: payload },
      { success: true }
    );

    if (result.success) {
      setRows(prev => prev.map(r => ({ ...r, _dirty: false, _isNew: false })));
      setSaveMessage({ type: 'success', text: `${dirtyRows.length}건이 저장되었습니다.` });
    } else {
      setSaveMessage({ type: 'error', text: '저장 중 오류가 발생했습니다.' });
    }

    setSaving(false);
    setTimeout(() => setSaveMessage(null), 3000);
  }, [rows, dateRange]);

  // ── Load product autocomplete from /api/scm/products ──
  const loadProductsFromApi = useCallback(async () => {
    const products = await fetchSafe<{ name: string }[]>('/api/scm/products', []);
    if (products.length > 0) {
      const names = products.map(p => p.name || (p as unknown as string));
      setProductSuggestions(prev => {
        const merged = new Set([...prev, ...names.filter(n => typeof n === 'string' && n.length > 0)]);
        return Array.from(merged);
      });
    }
  }, []);

  // ── Autocomplete Position Update ──
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      const rect = editInputRef.current.getBoundingClientRect();
      setAutocompletePos({
        top: rect.bottom + 2,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [editingCell, editValue]);

  const filteredAutocomplete = useMemo(() => {
    if (!editingCell || !showAutocomplete) return [];
    const searchVal = editValue.toLowerCase();
    if (!searchVal) return autocompleteSuggestions.slice(0, 10);
    return autocompleteSuggestions.filter(s => s.toLowerCase().includes(searchVal)).slice(0, 10);
  }, [editingCell, showAutocomplete, editValue, autocompleteSuggestions]);

  useEffect(() => {
    if (editingCell) {
      setTimeout(() => {
        editInputRef.current?.focus();
        editSelectRef.current?.focus();
      }, 0);
    }
  }, [editingCell]);

  // ── Pivot cell click handler ──
  const handlePivotCellClick = useCallback((productName: string, date: string) => {
    const breakdown = pivotComputed.breakdownData[productName]?.[date] || [];
    const totalQty = pivotComputed.pivotData[productName]?.[date] || 0;
    setBreakdownModal({
      productName,
      dateLabel: formatDateLabel(date),
      breakdown,
      totalQty,
    });
  }, [pivotComputed]);

  // ── Auth loading / guard ──
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // ═══════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <Navigation />

      <div className="max-w-[1600px] mx-auto px-4 py-6">

        {/* ── Page Header ── */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">주문 계획</h1>
            <p className="text-slate-500 mt-1">품목별 일별 필요 수량을 확인하고 채널별 계획을 관리하세요</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* View Toggle Buttons */}
            <div className="flex rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <button
                onClick={() => setViewMode('pivot')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  viewMode === 'pivot'
                    ? 'bg-blue-600 text-white shadow-inner'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                  피벗 뷰
                </span>
              </button>
              <button
                onClick={() => setViewMode('detail')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  viewMode === 'detail'
                    ? 'bg-blue-600 text-white shadow-inner'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  상세 뷰
                </span>
              </button>
            </div>

            {/* Date Range Selector */}
            <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <input
                type="date"
                value={dateRange.start}
                onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="text-sm font-medium text-slate-700 bg-transparent outline-none cursor-pointer"
              />
              <span className="text-slate-400">~</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="text-sm font-medium text-slate-700 bg-transparent outline-none cursor-pointer"
              />
            </div>

            {/* Quick Date Buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setDateRange(getWeekRange(new Date()))}
                className="px-3 py-2 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors"
              >
                이번 주
              </button>
              <button
                onClick={() => {
                  const d = new Date();
                  setDateRange({ start: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, end: d.toISOString().slice(0, 10) });
                }}
                className="px-3 py-2 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors"
              >
                이번 달
              </button>
            </div>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Unique Product Count */}
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-4 text-white shadow-lg shadow-blue-500/20">
            <p className="text-blue-100 text-xs font-medium mb-1">총 품목 수</p>
            <p className="text-2xl font-bold">{formatNumber(summary.uniqueProductCount)}</p>
            <p className="text-blue-200 text-xs mt-1">등록된 품목</p>
          </div>
          {/* Total Planned Qty */}
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl p-4 text-white shadow-lg shadow-emerald-500/20">
            <p className="text-emerald-100 text-xs font-medium mb-1">총 계획 수량</p>
            <p className="text-2xl font-bold">{formatNumber(summary.totalPlanned)}</p>
            <p className="text-emerald-200 text-xs mt-1">전체 기간 합계</p>
          </div>
          {/* Avg Daily Qty */}
          <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl p-4 text-white shadow-lg shadow-indigo-500/20">
            <p className="text-indigo-100 text-xs font-medium mb-1">일평균 계획 수량</p>
            <p className="text-2xl font-bold">{formatNumber(summary.avgDailyQty)}</p>
            <p className="text-indigo-200 text-xs mt-1">일별 평균</p>
          </div>
          {/* Channel Ratio */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <p className="text-slate-500 text-xs font-medium mb-2">채널 비율</p>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-blue-600 text-sm font-bold">{summary.onlineRatio}%</span>
              <span className="text-xs text-slate-400">온라인</span>
              <span className="text-slate-300 mx-1">|</span>
              <span className="text-orange-600 text-sm font-bold">{summary.offlineRatio}%</span>
              <span className="text-xs text-slate-400">오프라인</span>
            </div>
            {/* Mini bar */}
            <div className="w-full bg-slate-100 rounded-full h-2.5 flex overflow-hidden">
              <div
                className="bg-blue-500 h-full transition-all rounded-l-full"
                style={{ width: `${summary.onlineRatio}%` }}
              />
              <div
                className="bg-orange-400 h-full transition-all rounded-r-full"
                style={{ width: `${summary.offlineRatio}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-xs text-slate-400">
              <span>{formatNumber(summary.onlineQty)}</span>
              <span>{formatNumber(summary.offlineQty)}</span>
            </div>
          </div>
        </div>

        {/* ── Filter Bar ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap items-center gap-3">
          {/* Product Filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">품명</label>
            <input
              type="text"
              value={filterProduct}
              onChange={e => setFilterProduct(e.target.value)}
              placeholder="품명 검색..."
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 w-40 transition-colors"
            />
          </div>
          {/* Channel Type Filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">채널구분</label>
            <select
              value={filterChannelType}
              onChange={e => setFilterChannelType(e.target.value as ChannelType | '전체')}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white cursor-pointer transition-colors"
            >
              <option value="전체">전체</option>
              <option value="온라인">온라인</option>
              <option value="오프라인">오프라인</option>
            </select>
          </div>
          {/* Assignee Filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">담당자</label>
            <select
              value={filterAssignee}
              onChange={e => setFilterAssignee(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white cursor-pointer transition-colors"
            >
              <option value="전체">전체</option>
              {uniqueAssignees.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="flex-1" />

          {/* Row Count */}
          <span className="text-xs text-slate-400">
            {filteredRows.length}건
            {viewMode === 'detail' && dirtyCount > 0 && <span className="text-amber-500 font-medium ml-1">({dirtyCount}건 수정됨)</span>}
          </span>
        </div>

        {/* Save Message */}
        {saveMessage && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${
            saveMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {saveMessage.type === 'success' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {saveMessage.text}
          </div>
        )}

        {/* ════════════════════════════════════════════ */}
        {/* PIVOT VIEW                                   */}
        {/* ════════════════════════════════════════════ */}
        {viewMode === 'pivot' && (
          <>
            {/* Pivot Toolbar */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 mb-4 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                품목별 일별 필요 수량
              </span>
              <span className="text-xs text-slate-400 ml-2">
                셀을 클릭하면 채널별 상세 내역을 확인할 수 있습니다
              </span>

              <div className="flex-1" />

              {/* Download Pivot CSV */}
              <button
                onClick={() => downloadPivotExcel(
                  pivotComputed.productNames,
                  datesInRange,
                  pivotComputed.pivotData,
                  pivotComputed.dateTotals,
                  pivotComputed.productTotals,
                  pivotComputed.grandTotal
                )}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                엑셀 다운로드
              </button>
            </div>

            {/* Pivot Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-500 text-sm">데이터를 불러오는 중...</p>
                  </div>
                </div>
              ) : pivotComputed.productNames.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <div className="flex flex-col items-center gap-3">
                    <svg className="w-12 h-12 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <p className="text-sm">해당 기간에 주문 계획 데이터가 없습니다</p>
                    <button onClick={() => setViewMode('detail')} className="text-blue-500 hover:text-blue-700 text-sm font-medium">
                      상세 뷰에서 데이터 추가하기
                    </button>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b-2 border-slate-200">
                        <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-700 border-r border-slate-200 min-w-[280px]">
                          품목명
                        </th>
                        {datesInRange.map(date => (
                          <th key={date} className="px-3 py-3 text-center font-semibold text-slate-600 border-r border-slate-200 min-w-[90px] whitespace-nowrap">
                            {formatDateLabel(date)}
                          </th>
                        ))}
                        <th className="px-4 py-3 text-center font-bold text-slate-800 bg-slate-100 min-w-[100px]">
                          합계
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pivotComputed.productNames.map((product, pIdx) => (
                        <tr key={product} className={`border-b border-slate-100 ${pIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                          {/* Product name (sticky left) */}
                          <td className={`sticky left-0 z-10 px-4 py-2.5 font-medium text-slate-800 border-r border-slate-200 whitespace-nowrap ${
                            pIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/80'
                          }`}>
                            {product}
                          </td>
                          {/* Daily quantities */}
                          {datesInRange.map(date => {
                            const val = pivotComputed.pivotData[product]?.[date] || 0;
                            const colorClass = getHeatmapColor(val, pivotComputed.maxCellValue);
                            return (
                              <td
                                key={date}
                                className={`px-3 py-2.5 text-center border-r border-slate-100 cursor-pointer transition-all hover:ring-2 hover:ring-blue-400 hover:ring-inset ${colorClass}`}
                                onClick={() => handlePivotCellClick(product, date)}
                                title={`${product} / ${formatDateLabel(date)}: ${formatNumber(val)}`}
                              >
                                <span className="font-medium tabular-nums">
                                  {val > 0 ? formatNumber(val) : '-'}
                                </span>
                              </td>
                            );
                          })}
                          {/* Product total */}
                          <td className="px-4 py-2.5 text-center font-bold text-slate-800 bg-slate-100/70 border-l border-slate-200">
                            {formatNumber(pivotComputed.productTotals[product] || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-sm">
                        <td className="sticky left-0 z-10 bg-slate-100 px-4 py-3 text-slate-700 border-r border-slate-200">
                          합계
                        </td>
                        {datesInRange.map(date => (
                          <td key={date} className="px-3 py-3 text-center text-slate-800 border-r border-slate-200">
                            {formatNumber(pivotComputed.dateTotals[date] || 0)}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-center text-blue-700 bg-blue-50 text-base">
                          {formatNumber(pivotComputed.grandTotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Heatmap Legend */}
            {pivotComputed.productNames.length > 0 && (
              <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-500">
                <span>수량 강도:</span>
                <div className="flex items-center gap-0.5">
                  <div className="w-6 h-4 rounded bg-slate-50 border border-slate-200" />
                  <div className="w-6 h-4 rounded bg-blue-100" />
                  <div className="w-6 h-4 rounded bg-blue-200" />
                  <div className="w-6 h-4 rounded bg-blue-300" />
                  <div className="w-6 h-4 rounded bg-blue-400" />
                  <div className="w-6 h-4 rounded bg-blue-500" />
                </div>
                <span>낮음 ~ 높음</span>
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════ */}
        {/* DETAIL VIEW                                  */}
        {/* ════════════════════════════════════════════ */}
        {viewMode === 'detail' && (
          <>
            {/* Detail Toolbar */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 mb-4 flex items-center gap-2 flex-wrap">
              {/* Add Row */}
              <button
                onClick={addRow}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                행 추가
              </button>
              {/* Add Multiple Rows */}
              <div className="relative group">
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  다중 추가
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg hidden group-hover:block z-20 min-w-[100px]">
                  {[5, 10, 20, 50].map(n => (
                    <button
                      key={n}
                      onClick={() => addMultipleRows(n)}
                      className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    >
                      {n}행
                    </button>
                  ))}
                </div>
              </div>

              {/* Load Products from API */}
              <button
                onClick={loadProductsFromApi}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                품목 불러오기
              </button>

              {/* Delete Selected */}
              {selectedRowIds.size > 0 && (
                <button
                  onClick={deleteSelectedRows}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  선택 삭제 ({selectedRowIds.size})
                </button>
              )}

              <div className="flex-1" />

              {/* Paste Hint */}
              <span className="text-xs text-slate-400 hidden lg:inline">
                Ctrl+V로 Excel에서 붙여넣기 가능
              </span>

              {/* Download Excel */}
              <button
                onClick={() => downloadDetailExcel(filteredRows)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                다운로드
              </button>

              {/* Save Button */}
              <button
                onClick={handleSave}
                disabled={saving || dirtyCount === 0}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg transition-all shadow-sm ${
                  dirtyCount > 0
                    ? 'text-white bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'
                    : 'text-slate-400 bg-slate-100 cursor-not-allowed'
                }`}
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    저장 중...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    저장 {dirtyCount > 0 && `(${dirtyCount})`}
                  </>
                )}
              </button>
            </div>

            {/* ── Excel-like Spreadsheet Table ── */}
            <div
              ref={tableRef}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden focus:outline-none"
              tabIndex={0}
              onKeyDown={handleGridKeyDown}
            >
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-500 text-sm">데이터를 불러오는 중...</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    {/* Header */}
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {/* Checkbox column */}
                        <th className="w-10 px-2 py-2.5 border-r border-slate-200 text-center">
                          <input
                            type="checkbox"
                            checked={filteredRows.length > 0 && selectedRowIds.size === filteredRows.length}
                            onChange={toggleAllSelection}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        </th>
                        {/* Row number */}
                        <th className="w-10 px-2 py-2.5 border-r border-slate-200 text-center text-xs font-semibold text-slate-400">
                          #
                        </th>
                        {/* Data columns */}
                        {COLUMNS.map((col) => (
                          <th
                            key={col.key}
                            className={`${col.width} px-3 py-2.5 border-r border-slate-200 text-xs font-semibold text-slate-600 tracking-wider ${
                              col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                            }`}
                          >
                            {col.label}
                          </th>
                        ))}
                        {/* Actions column */}
                        <th className="w-12 px-2 py-2.5 text-center text-xs font-semibold text-slate-400">
                          삭제
                        </th>
                      </tr>
                    </thead>
                    {/* Body */}
                    <tbody>
                      {filteredRows.length === 0 ? (
                        <tr>
                          <td colSpan={COLUMNS.length + 3} className="text-center py-16 text-slate-400">
                            <div className="flex flex-col items-center gap-3">
                              <svg className="w-12 h-12 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                              <p className="text-sm">주문 계획 데이터가 없습니다</p>
                              <button onClick={addRow} className="text-blue-500 hover:text-blue-700 text-sm font-medium">
                                + 새 행 추가하기
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredRows.map((row, rowIdx) => {
                          const isRowDirty = row._dirty;
                          const isNewRow = row._isNew;
                          return (
                            <tr
                              key={row.id}
                              className={`border-b border-slate-100 transition-colors ${
                                selectedRowIds.has(row.id) ? 'bg-blue-50/60' : isNewRow ? 'bg-green-50/30' : isRowDirty ? 'bg-amber-50/30' : 'hover:bg-slate-50/50'
                              }`}
                            >
                              {/* Checkbox */}
                              <td className="px-2 py-0 border-r border-slate-100 text-center">
                                <input
                                  type="checkbox"
                                  checked={selectedRowIds.has(row.id)}
                                  onChange={() => toggleRowSelection(row.id)}
                                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                />
                              </td>
                              {/* Row number */}
                              <td className="px-2 py-0 border-r border-slate-100 text-center text-xs text-slate-400 font-mono">
                                {rowIdx + 1}
                              </td>
                              {/* Data cells */}
                              {COLUMNS.map((col, colIdx) => {
                                const isSelected = selectedCell?.rowIdx === rowIdx && selectedCell?.colIdx === colIdx;
                                const isEditing = editingCell?.rowIdx === rowIdx && editingCell?.colIdx === colIdx;
                                const cellValue = row[col.key];

                                // Format display value
                                let displayValue: React.ReactNode = String(cellValue);
                                if (col.type === 'number' && typeof cellValue === 'number') {
                                  if (col.key === 'unitPrice') {
                                    displayValue = formatCurrency(cellValue);
                                  } else {
                                    displayValue = formatNumber(cellValue);
                                  }
                                }

                                // Color coding for actual vs planned
                                let valueColorClass = '';
                                if (col.key === 'actualQty' && typeof cellValue === 'number') {
                                  if (cellValue >= row.plannedQty && row.plannedQty > 0) {
                                    valueColorClass = 'text-emerald-600 font-semibold';
                                  } else if (cellValue > 0 && cellValue < row.plannedQty) {
                                    valueColorClass = 'text-amber-600';
                                  } else if (cellValue === 0 && row.plannedQty > 0) {
                                    valueColorClass = 'text-red-400';
                                  }
                                }

                                // Channel type badge
                                if (col.key === 'channelType') {
                                  displayValue = (
                                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                      cellValue === '온라인' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                                    }`}>
                                      {String(cellValue)}
                                    </span>
                                  );
                                }

                                return (
                                  <td
                                    key={col.key}
                                    className={`px-0 py-0 border-r border-slate-100 relative cursor-cell ${
                                      isSelected ? 'outline outline-2 outline-blue-500 outline-offset-[-2px] z-10' : ''
                                    } ${isEditing ? 'p-0' : ''}`}
                                    onClick={() => {
                                      if (!isEditing) {
                                        setSelectedCell({ rowIdx, colIdx });
                                      }
                                    }}
                                    onDoubleClick={() => startEditing(rowIdx, colIdx)}
                                  >
                                    {isEditing ? (
                                      col.type === 'select' ? (
                                        <select
                                          ref={editSelectRef}
                                          value={editValue}
                                          onChange={e => {
                                            setEditValue(e.target.value);
                                            const realRowIdx2 = rows.findIndex(r => r.id === row.id);
                                            if (realRowIdx2 !== -1) {
                                              setRows(prev => {
                                                const updated = [...prev];
                                                updated[realRowIdx2] = { ...updated[realRowIdx2], [col.key]: e.target.value, _dirty: true };
                                                return updated;
                                              });
                                            }
                                            setEditingCell(null);
                                          }}
                                          onBlur={cancelEdit}
                                          onKeyDown={e => handleCellKeyDown(e, rowIdx, colIdx)}
                                          className="w-full h-full px-3 py-1.5 text-sm bg-blue-50 border-0 outline-none focus:bg-blue-50"
                                        >
                                          {col.options?.map(opt => (
                                            <option key={opt} value={opt}>{opt}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input
                                          ref={editInputRef}
                                          type={col.type === 'number' ? 'number' : 'text'}
                                          value={editValue}
                                          onChange={e => setEditValue(e.target.value)}
                                          onBlur={() => {
                                            commitEdit();
                                            setShowAutocomplete(false);
                                          }}
                                          onKeyDown={e => handleCellKeyDown(e, rowIdx, colIdx)}
                                          className={`w-full h-full px-3 py-1.5 text-sm bg-blue-50 border-0 outline-none focus:bg-blue-50 ${
                                            col.align === 'right' ? 'text-right' : ''
                                          }`}
                                        />
                                      )
                                    ) : (
                                      <div className={`px-3 py-1.5 min-h-[32px] flex items-center ${
                                        col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : 'justify-start'
                                      } ${valueColorClass}`}>
                                        {(cellValue === '' || (cellValue === 0 && col.type === 'number' && col.key !== 'unitPrice')) ? (
                                          <span className="text-slate-300">{col.type === 'number' ? '0' : '-'}</span>
                                        ) : (
                                          displayValue
                                        )}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                              {/* Delete button */}
                              <td className="px-2 py-0 text-center">
                                <button
                                  onClick={() => deleteRow(row.id)}
                                  className="p-1 text-slate-300 hover:text-red-500 transition-colors rounded"
                                  title="삭제"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    {/* Footer with totals */}
                    {filteredRows.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-sm">
                          <td className="px-2 py-2.5 border-r border-slate-200" />
                          <td className="px-2 py-2.5 border-r border-slate-200" />
                          <td className="px-3 py-2.5 border-r border-slate-200 text-slate-700" colSpan={5}>
                            합계
                          </td>
                          <td className="px-3 py-2.5 border-r border-slate-200 text-right text-slate-700">
                            {formatNumber(summary.totalPlanned)}
                          </td>
                          <td className="px-3 py-2.5 border-r border-slate-200 text-right text-slate-700">
                            {formatNumber(summary.totalActual)}
                          </td>
                          <td className="px-3 py-2.5 border-r border-slate-200 text-right text-slate-500">
                            -
                          </td>
                          <td className="px-3 py-2.5 border-r border-slate-200 text-slate-500 text-xs">
                            -
                          </td>
                          <td className="px-2 py-2.5" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>

            {/* ── Bottom Action Bar ── */}
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={addRow}
                className="text-sm text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                행 추가
              </button>
              <div className="text-xs text-slate-400 flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-100 border border-green-300" />
                  신규 행
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-100 border border-amber-300" />
                  수정됨
                </span>
                <span>
                  Tab: 다음 셀 | Enter: 아래 셀 | F2: 편집 | Esc: 취소
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Autocomplete Dropdown (detail view) ── */}
      {viewMode === 'detail' && (
        <AutocompleteDropdown
          suggestions={filteredAutocomplete}
          onSelect={(value) => {
            setEditValue(value);
            commitEdit();
            setShowAutocomplete(false);
            if (editingCell) {
              const { rowIdx, colIdx } = editingCell;
              const row = filteredRows[rowIdx];
              if (row) {
                const col = COLUMNS[colIdx];
                const realRowIdx = rows.findIndex(r => r.id === row.id);
                if (realRowIdx !== -1) {
                  setRows(prev => {
                    const updated = [...prev];
                    updated[realRowIdx] = { ...updated[realRowIdx], [col.key]: value, _dirty: true };
                    return updated;
                  });
                }
              }
              setEditingCell(null);
            }
          }}
          visible={showAutocomplete && filteredAutocomplete.length > 0}
          top={autocompletePos.top}
          left={autocompletePos.left}
          width={autocompletePos.width}
        />
      )}

      {/* ── Paste Preview Modal ── */}
      {pastePreview && (
        <PastePreviewModal
          rows={pastePreview}
          onConfirm={confirmPaste}
          onCancel={() => setPastePreview(null)}
        />
      )}

      {/* ── Cell Breakdown Modal (pivot view) ── */}
      {breakdownModal && (
        <CellBreakdownModal
          productName={breakdownModal.productName}
          dateLabel={breakdownModal.dateLabel}
          breakdown={breakdownModal.breakdown}
          totalQty={breakdownModal.totalQty}
          onClose={() => setBreakdownModal(null)}
        />
      )}
    </main>
  );
}
