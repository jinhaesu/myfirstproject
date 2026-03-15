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
    const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return defaultValue;
  }
};

const postSafe = async <T,>(path: string, body: unknown, defaultValue: T): Promise<T> => {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
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

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const COLUMNS: ColumnDef[] = [
  { key: 'productName',  label: '품명',       width: 'w-40', type: 'text' },
  { key: 'productOwner', label: '품주명',     width: 'w-28', type: 'text' },
  { key: 'channelType',  label: '채널구분',   width: 'w-24', type: 'select', options: ['온라인', '오프라인'], align: 'center' },
  { key: 'channelName',  label: '채널명',     width: 'w-32', type: 'text' },
  { key: 'assignee',     label: '담당자',     width: 'w-24', type: 'text' },
  { key: 'plannedQty',   label: '계획수량',   width: 'w-24', type: 'number', align: 'right' },
  { key: 'actualQty',    label: '실제수량',   width: 'w-24', type: 'number', align: 'right' },
  { key: 'unitPrice',    label: '단가',       width: 'w-28', type: 'number', align: 'right' },
  { key: 'memo',         label: '비고',       width: 'w-44', type: 'text' },
];

const CHANNEL_NAMES_ONLINE = ['스마트스토어', '쿠팡', '11번가', '지마켓', '옥션', '카페24', '카카오선물하기', '에이블리', '위메프'];
const CHANNEL_NAMES_OFFLINE = ['백화점', '올리브영', 'H&B매장', '할인점', '대리점', '직영매장', '면세점', '홈쇼핑'];

// ─────────────────────────────────────────────
// Sample Data
// ─────────────────────────────────────────────
const generateSampleData = (): OrderPlanRow[] => [
  { id: 1,  productName: '시카 리페어 크림 50ml',      productOwner: '(주)코스메틱랩',  channelType: '온라인',  channelName: '스마트스토어', assignee: '김민수', plannedQty: 2000, actualQty: 1850, unitPrice: 28000, memo: '봄 프로모션' },
  { id: 2,  productName: '시카 리페어 크림 50ml',      productOwner: '(주)코스메틱랩',  channelType: '온라인',  channelName: '쿠팡',       assignee: '김민수', plannedQty: 3000, actualQty: 2900, unitPrice: 26000, memo: '로켓배송' },
  { id: 3,  productName: '히알루론산 세럼 30ml',       productOwner: '(주)코스메틱랩',  channelType: '온라인',  channelName: '카카오선물하기', assignee: '이지은', plannedQty: 1500, actualQty: 1200, unitPrice: 35000, memo: '선물세트 구성' },
  { id: 4,  productName: '히알루론산 세럼 30ml',       productOwner: '(주)코스메틱랩',  channelType: '오프라인', channelName: '올리브영',    assignee: '이지은', plannedQty: 5000, actualQty: 4800, unitPrice: 32000, memo: '매장 입점 2차' },
  { id: 5,  productName: '톤업 선크림 SPF50+ 60ml',    productOwner: '(주)뷰티사이언스', channelType: '온라인',  channelName: '11번가',     assignee: '박서연', plannedQty: 2500, actualQty: 0,    unitPrice: 22000, memo: '여름 시즌 준비' },
  { id: 6,  productName: '톤업 선크림 SPF50+ 60ml',    productOwner: '(주)뷰티사이언스', channelType: '오프라인', channelName: '백화점',     assignee: '박서연', plannedQty: 1000, actualQty: 600,  unitPrice: 25000, memo: '신세계/현대 입점' },
  { id: 7,  productName: '벨벳 매트 립스틱 #로즈레드',   productOwner: '(주)뷰티사이언스', channelType: '온라인',  channelName: '에이블리',   assignee: '최유나', plannedQty: 1800, actualQty: 1800, unitPrice: 18000, memo: '완판 목표' },
  { id: 8,  productName: '글로우 쿠션 파운데이션 15g',   productOwner: '(주)코스메틱랩',  channelType: '온라인',  channelName: '카페24',     assignee: '최유나', plannedQty: 2200, actualQty: 1900, unitPrice: 42000, memo: '자사몰 단독' },
  { id: 9,  productName: '케라틴 실크 샴푸 500ml',      productOwner: '(주)헤어프로',    channelType: '오프라인', channelName: 'H&B매장',    assignee: '정하늘', plannedQty: 4000, actualQty: 3200, unitPrice: 15000, memo: '대용량 기획전' },
  { id: 10, productName: '케라틴 실크 샴푸 500ml',      productOwner: '(주)헤어프로',    channelType: '온라인',  channelName: '쿠팡',       assignee: '정하늘', plannedQty: 6000, actualQty: 5500, unitPrice: 13500, memo: '쿠팡 특가' },
  { id: 11, productName: '시어버터 바디로션 300ml',     productOwner: '(주)코스메틱랩',  channelType: '오프라인', channelName: '할인점',     assignee: '김민수', plannedQty: 3500, actualQty: 3500, unitPrice: 12000, memo: 'E마트/홈플러스' },
  { id: 12, productName: '레티놀 나이트 크림 40ml',     productOwner: '(주)뷰티사이언스', channelType: '온라인',  channelName: '스마트스토어', assignee: '이지은', plannedQty: 1200, actualQty: 950,  unitPrice: 48000, memo: '프리미엄 라인' },
  { id: 13, productName: '딥 클렌징 폼 150ml',         productOwner: '(주)코스메틱랩',  channelType: '온라인',  channelName: '위메프',     assignee: '박서연', plannedQty: 2000, actualQty: 1100, unitPrice: 16000, memo: '타임딜 예정' },
  { id: 14, productName: '볼륨 마스카라 블랙',          productOwner: '(주)뷰티사이언스', channelType: '오프라인', channelName: '면세점',     assignee: '최유나', plannedQty: 800,  actualQty: 400,  unitPrice: 20000, memo: '면세점 전용 패키지' },
  { id: 15, productName: '코코넛 바디스크럽 250g',     productOwner: '(주)코스메틱랩',  channelType: '온라인',  channelName: '옥션',       assignee: '정하늘', plannedQty: 1500, actualQty: 1500, unitPrice: 19000, memo: '리미티드 에디션' },
];

const SAMPLE_PRODUCTS = [
  '시카 리페어 크림 50ml', '히알루론산 세럼 30ml', '톤업 선크림 SPF50+ 60ml',
  '벨벳 매트 립스틱 #로즈레드', '글로우 쿠션 파운데이션 15g', '케라틴 실크 샴푸 500ml',
  '두피 스케일링 토닉 150ml', '시어버터 바디로션 300ml', '레티놀 나이트 크림 40ml',
  '딥 클렌징 폼 150ml', '볼륨 마스카라 블랙', '코코넛 바디스크럽 250g',
  '그린티 클렌징 오일 200ml', '아이브로우 펜슬 세트',
];

const SAMPLE_ASSIGNEES = ['김민수', '이지은', '박서연', '최유나', '정하늘'];

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

const createEmptyRow = (): EditableRow => ({
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
  _dirty: true,
  _isNew: true,
});

// ─────────────────────────────────────────────
// Excel Download
// ─────────────────────────────────────────────
const downloadExcel = (rows: EditableRow[]) => {
  const BOM = '\uFEFF';
  const headers = ['품명', '품주명', '채널구분', '채널명', '담당자', '계획수량', '실제수량', '단가', '비고'];
  const csvRows = rows.map(r => [
    r.productName, r.productOwner, r.channelType, r.channelName, r.assignee,
    r.plannedQty, r.actualQty, r.unitPrice, r.memo,
  ]);
  const csv = [headers, ...csvRows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `주문계획_${new Date().toISOString().slice(0, 10)}.csv`;
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
// Main Component
// ═══════════════════════════════════════════════
export default function OrderPlanPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

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

  // ── Selection / Editing State ──
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

  // ── Summary Stats ──
  const summary = useMemo(() => {
    const totalPlanned = filteredRows.reduce((s, r) => s + r.plannedQty, 0);
    const totalActual = filteredRows.reduce((s, r) => s + r.actualQty, 0);
    const achievementRate = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
    const totalPlannedAmount = filteredRows.reduce((s, r) => s + r.plannedQty * r.unitPrice, 0);
    const totalActualAmount = filteredRows.reduce((s, r) => s + r.actualQty * r.unitPrice, 0);

    // By channel type
    const byChannel: Record<string, { planned: number; actual: number; amount: number }> = {};
    filteredRows.forEach(r => {
      if (!byChannel[r.channelType]) byChannel[r.channelType] = { planned: 0, actual: 0, amount: 0 };
      byChannel[r.channelType].planned += r.plannedQty;
      byChannel[r.channelType].actual += r.actualQty;
      byChannel[r.channelType].amount += r.actualQty * r.unitPrice;
    });

    // By assignee
    const byAssignee: Record<string, { planned: number; actual: number; rate: number }> = {};
    filteredRows.forEach(r => {
      if (!byAssignee[r.assignee]) byAssignee[r.assignee] = { planned: 0, actual: 0, rate: 0 };
      byAssignee[r.assignee].planned += r.plannedQty;
      byAssignee[r.assignee].actual += r.actualQty;
    });
    Object.values(byAssignee).forEach(v => {
      v.rate = v.planned > 0 ? Math.round((v.actual / v.planned) * 100) : 0;
    });

    return { totalPlanned, totalActual, achievementRate, totalPlannedAmount, totalActualAmount, byChannel, byAssignee };
  }, [filteredRows]);

  // ── Unique assignees from current data ──
  const uniqueAssignees = useMemo(() => {
    const set = new Set(rows.map(r => r.assignee).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  // ── Dirty Row Count ──
  const dirtyCount = useMemo(() => rows.filter(r => r._dirty).length, [rows]);

  // ── Cell Editing ──
  const startEditing = useCallback((rowIdx: number, colIdx: number) => {
    const row = filteredRows[rowIdx];
    if (!row) return;
    const col = COLUMNS[colIdx];
    setEditingCell({ rowIdx, colIdx });
    setEditValue(String(row[col.key]));
    setSelectedCell({ rowIdx, colIdx });

    // Show autocomplete for product name or assignee
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
      // Move to next cell
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

  // ── Grid keyboard navigation when not editing ──
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
        // Start typing to edit
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
      // Only handle paste when the table is focused (or within it)
      if (!tableRef.current?.contains(document.activeElement) && document.activeElement !== tableRef.current) return;

      // If we're editing a single cell, let default paste behavior happen
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
  }, [editingCell]);

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
      ...partial,
      _dirty: true,
      _isNew: true,
    }));
    setRows(prev => [...prev, ...newRows]);
    setPastePreview(null);
  }, [pastePreview]);

  // ── Row Operations ──
  const addRow = useCallback(() => {
    setRows(prev => [...prev, createEmptyRow()]);
  }, []);

  const addMultipleRows = useCallback((count: number) => {
    const newRows = Array.from({ length: count }, () => createEmptyRow());
    setRows(prev => [...prev, ...newRows]);
  }, []);

  const deleteRow = useCallback((id: number) => {
    setRows(prev => prev.filter(r => r.id !== id));
    // If it's a persisted row (positive id), call the delete API
    if (id > 0) {
      deleteSafe(`/api/scm/order-plans/${id}`);
    }
  }, []);

  const deleteSelectedRows = useCallback(() => {
    if (selectedRowIds.size === 0) return;
    if (!window.confirm(`선택한 ${selectedRowIds.size}개 행을 삭제하시겠습니까?`)) return;

    // Delete persisted rows from API
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
      start_date: dateRange.start,
      end_date: dateRange.end,
    }));

    const result = await postSafe<{ success: boolean; data?: OrderPlanRow[] }>(
      '/api/scm/order-plans/bulk',
      { items: payload },
      { success: true }
    );

    if (result.success) {
      // Mark all rows as clean
      setRows(prev => prev.map(r => ({ ...r, _dirty: false, _isNew: false })));
      setSaveMessage({ type: 'success', text: `${dirtyRows.length}건이 저장되었습니다.` });
    } else {
      setSaveMessage({ type: 'error', text: '저장 중 오류가 발생했습니다.' });
    }

    setSaving(false);
    setTimeout(() => setSaveMessage(null), 3000);
  }, [rows, dateRange]);

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

  // ── Filtered autocomplete based on input ──
  const filteredAutocomplete = useMemo(() => {
    if (!editingCell || !showAutocomplete) return [];
    const col = COLUMNS[editingCell.colIdx];
    const searchVal = editValue.toLowerCase();
    if (!searchVal) return autocompleteSuggestions.slice(0, 10);
    return autocompleteSuggestions.filter(s => s.toLowerCase().includes(searchVal)).slice(0, 10);
  }, [editingCell, showAutocomplete, editValue, autocompleteSuggestions]);

  // ── Focus input when editing starts ──
  useEffect(() => {
    if (editingCell) {
      setTimeout(() => {
        editInputRef.current?.focus();
        editSelectRef.current?.focus();
      }, 0);
    }
  }, [editingCell]);

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
            <p className="text-slate-500 mt-1">채널별 주문 계획을 수립하고 실적을 관리하세요</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          {/* Total Planned */}
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-4 text-white shadow-lg shadow-blue-500/20">
            <p className="text-blue-100 text-xs font-medium mb-1">총 계획수량</p>
            <p className="text-2xl font-bold">{formatNumber(summary.totalPlanned)}</p>
            <p className="text-blue-200 text-xs mt-1">{formatCurrency(summary.totalPlannedAmount)}</p>
          </div>
          {/* Total Actual */}
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl p-4 text-white shadow-lg shadow-emerald-500/20">
            <p className="text-emerald-100 text-xs font-medium mb-1">총 실제수량</p>
            <p className="text-2xl font-bold">{formatNumber(summary.totalActual)}</p>
            <p className="text-emerald-200 text-xs mt-1">{formatCurrency(summary.totalActualAmount)}</p>
          </div>
          {/* Achievement Rate */}
          <div className={`bg-gradient-to-br ${summary.achievementRate >= 80 ? 'from-indigo-500 to-indigo-600 shadow-indigo-500/20' : 'from-amber-500 to-amber-600 shadow-amber-500/20'} rounded-2xl p-4 text-white shadow-lg`}>
            <p className="text-white/80 text-xs font-medium mb-1">달성률</p>
            <p className="text-2xl font-bold">{summary.achievementRate}%</p>
            <div className="w-full bg-white/20 rounded-full h-1.5 mt-2">
              <div className="bg-white rounded-full h-1.5 transition-all" style={{ width: `${Math.min(100, summary.achievementRate)}%` }} />
            </div>
          </div>
          {/* By Channel */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <p className="text-slate-500 text-xs font-medium mb-2">채널별 실적</p>
            {Object.entries(summary.byChannel).map(([ch, data]) => (
              <div key={ch} className="flex items-center justify-between text-sm mb-1 last:mb-0">
                <span className={`font-medium ${ch === '온라인' ? 'text-blue-600' : 'text-orange-600'}`}>{ch}</span>
                <span className="text-slate-700">{formatNumber(data.actual)} / {formatNumber(data.planned)}</span>
              </div>
            ))}
            {Object.keys(summary.byChannel).length === 0 && (
              <p className="text-slate-400 text-xs">데이터 없음</p>
            )}
          </div>
          {/* By Assignee */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm col-span-2 lg:col-span-1">
            <p className="text-slate-500 text-xs font-medium mb-2">담당자별 달성률</p>
            <div className="space-y-1.5 max-h-24 overflow-y-auto">
              {Object.entries(summary.byAssignee).sort((a, b) => b[1].rate - a[1].rate).map(([name, data]) => (
                <div key={name} className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600 w-12 truncate font-medium">{name}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${data.rate >= 90 ? 'bg-emerald-500' : data.rate >= 70 ? 'bg-blue-500' : 'bg-amber-500'}`}
                      style={{ width: `${Math.min(100, data.rate)}%` }}
                    />
                  </div>
                  <span className={`w-10 text-right font-semibold ${data.rate >= 90 ? 'text-emerald-600' : data.rate >= 70 ? 'text-blue-600' : 'text-amber-600'}`}>
                    {data.rate}%
                  </span>
                </div>
              ))}
              {Object.keys(summary.byAssignee).length === 0 && (
                <p className="text-slate-400 text-xs">데이터 없음</p>
              )}
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
            {filteredRows.length}건 {dirtyCount > 0 && <span className="text-amber-500 font-medium">({dirtyCount}건 수정됨)</span>}
          </span>
        </div>

        {/* ── Toolbar ── */}
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
            onClick={() => downloadExcel(filteredRows)}
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
                                        // Auto-commit select changes
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
                      <td className="px-3 py-2.5 border-r border-slate-200 text-slate-700" colSpan={4}>
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
                        달성률 {summary.achievementRate}%
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
      </div>

      {/* ── Autocomplete Dropdown ── */}
      <AutocompleteDropdown
        suggestions={filteredAutocomplete}
        onSelect={(value) => {
          setEditValue(value);
          commitEdit();
          setShowAutocomplete(false);
          // Move after selecting
          if (editingCell) {
            const { rowIdx, colIdx } = editingCell;
            // Apply the value immediately
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

      {/* ── Paste Preview Modal ── */}
      {pastePreview && (
        <PastePreviewModal
          rows={pastePreview}
          onConfirm={confirmPaste}
          onCancel={() => setPastePreview(null)}
        />
      )}
    </main>
  );
}
