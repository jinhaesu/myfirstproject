'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
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
  } catch {
    return defaultValue;
  }
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type InventoryStatus = '정상' | '주의' | '부족' | '품절';
type OutboundStatus = '준비중' | '출고완료' | '배송중' | '배송완료';
type AlertPriority = '긴급' | '주의' | '참고';

interface InventoryItem {
  id: number;
  skuCode: string;
  productName: string;
  category: string;
  currentStock: number;
  safetyStock: number;
  reorderPoint: number;
  status: InventoryStatus;
  lastInboundDate: string;
}

interface OutboundRecord {
  id: number;
  outboundNo: string;
  outboundDate: string;
  productName: string;
  sku: string;
  quantity: number;
  region: string;
  courier: string;
  trackingNo: string;
  status: OutboundStatus;
}

interface AlertItem {
  id: number;
  productName: string;
  skuCode: string;
  category: string;
  currentStock: number;
  safetyStock: number;
  reorderPoint: number;
  shortage: number;
  priority: AlertPriority;
}

type TabKey = '재고현황' | '출고현황' | '재고알림';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
const SAMPLE_INVENTORY: InventoryItem[] = [
  { id: 1, skuCode: 'SK-1001', productName: '수분 크림 50ml', category: '스킨케어', currentStock: 320, safetyStock: 100, reorderPoint: 150, status: '정상', lastInboundDate: '2026-03-10' },
  { id: 2, skuCode: 'SK-1002', productName: '비타민C 세럼 30ml', category: '스킨케어', currentStock: 85, safetyStock: 100, reorderPoint: 120, status: '주의', lastInboundDate: '2026-03-05' },
  { id: 3, skuCode: 'MK-2001', productName: '매트 립스틱 #01 로즈', category: '메이크업', currentStock: 450, safetyStock: 200, reorderPoint: 250, status: '정상', lastInboundDate: '2026-03-08' },
  { id: 4, skuCode: 'MK-2002', productName: '쿠션 파운데이션 SPF50', category: '메이크업', currentStock: 12, safetyStock: 80, reorderPoint: 100, status: '부족', lastInboundDate: '2026-02-20' },
  { id: 5, skuCode: 'SK-1003', productName: '히알루론산 토너 200ml', category: '스킨케어', currentStock: 0, safetyStock: 150, reorderPoint: 200, status: '품절', lastInboundDate: '2026-01-15' },
  { id: 6, skuCode: 'HC-3001', productName: '손상모발 트리트먼트 300ml', category: '헤어케어', currentStock: 220, safetyStock: 80, reorderPoint: 100, status: '정상', lastInboundDate: '2026-03-09' },
  { id: 7, skuCode: 'HC-3002', productName: '볼류밍 샴푸 500ml', category: '헤어케어', currentStock: 65, safetyStock: 70, reorderPoint: 90, status: '주의', lastInboundDate: '2026-03-01' },
  { id: 8, skuCode: 'BD-4001', productName: '바디 로션 400ml', category: '바디케어', currentStock: 180, safetyStock: 100, reorderPoint: 130, status: '정상', lastInboundDate: '2026-03-07' },
  { id: 9, skuCode: 'BD-4002', productName: '바디 스크럽 250ml', category: '바디케어', currentStock: 25, safetyStock: 60, reorderPoint: 80, status: '부족', lastInboundDate: '2026-02-25' },
  { id: 10, skuCode: 'MK-2003', productName: '아이섀도 팔레트 12색', category: '메이크업', currentStock: 300, safetyStock: 100, reorderPoint: 150, status: '정상', lastInboundDate: '2026-03-11' },
  { id: 11, skuCode: 'SK-1004', productName: '레티놀 나이트크림 30ml', category: '스킨케어', currentStock: 45, safetyStock: 50, reorderPoint: 70, status: '주의', lastInboundDate: '2026-03-02' },
  { id: 12, skuCode: 'SN-5001', productName: '선크림 SPF50+ 60ml', category: '선케어', currentStock: 500, safetyStock: 200, reorderPoint: 300, status: '정상', lastInboundDate: '2026-03-12' },
  { id: 13, skuCode: 'SN-5002', productName: '선스틱 SPF50+ 20g', category: '선케어', currentStock: 0, safetyStock: 100, reorderPoint: 120, status: '품절', lastInboundDate: '2026-02-10' },
  { id: 14, skuCode: 'MK-2004', productName: '워터프루프 마스카라', category: '메이크업', currentStock: 210, safetyStock: 80, reorderPoint: 100, status: '정상', lastInboundDate: '2026-03-06' },
  { id: 15, skuCode: 'SK-1005', productName: '클렌징 오일 200ml', category: '스킨케어', currentStock: 130, safetyStock: 90, reorderPoint: 110, status: '정상', lastInboundDate: '2026-03-04' },
  { id: 16, skuCode: 'MK-2005', productName: '브로우 펜슬 #02 브라운', category: '메이크업', currentStock: 8, safetyStock: 50, reorderPoint: 60, status: '부족', lastInboundDate: '2026-02-28' },
  { id: 17, skuCode: 'HC-3003', productName: '두피 스케일링 세럼 100ml', category: '헤어케어', currentStock: 95, safetyStock: 40, reorderPoint: 60, status: '정상', lastInboundDate: '2026-03-03' },
  { id: 18, skuCode: 'BD-4003', productName: '핸드크림 세트 (3종)', category: '바디케어', currentStock: 340, safetyStock: 120, reorderPoint: 160, status: '정상', lastInboundDate: '2026-03-10' },
];

const SAMPLE_OUTBOUND: OutboundRecord[] = [
  { id: 1, outboundNo: 'OUT-20260312-001', outboundDate: '2026-03-12 09:15', productName: '수분 크림 50ml', sku: 'SK-1001', quantity: 24, region: '서울 강남구', courier: 'CJ대한통운', trackingNo: '6012345678901', status: '출고완료' },
  { id: 2, outboundNo: 'OUT-20260312-002', outboundDate: '2026-03-12 09:30', productName: '매트 립스틱 #01 로즈', sku: 'MK-2001', quantity: 50, region: '경기 성남시', courier: '한진택배', trackingNo: '4209876543210', status: '배송중' },
  { id: 3, outboundNo: 'OUT-20260312-003', outboundDate: '2026-03-12 10:00', productName: '선크림 SPF50+ 60ml', sku: 'SN-5001', quantity: 100, region: '부산 해운대구', courier: '롯데택배', trackingNo: '2031234567890', status: '준비중' },
  { id: 4, outboundNo: 'OUT-20260311-001', outboundDate: '2026-03-11 08:45', productName: '아이섀도 팔레트 12색', sku: 'MK-2003', quantity: 30, region: '인천 남동구', courier: 'CJ대한통운', trackingNo: '6012345678902', status: '배송완료' },
  { id: 5, outboundNo: 'OUT-20260311-002', outboundDate: '2026-03-11 11:20', productName: '손상모발 트리트먼트 300ml', sku: 'HC-3001', quantity: 15, region: '대구 수성구', courier: '한진택배', trackingNo: '4209876543211', status: '배송중' },
  { id: 6, outboundNo: 'OUT-20260311-003', outboundDate: '2026-03-11 14:00', productName: '핸드크림 세트 (3종)', sku: 'BD-4003', quantity: 40, region: '서울 마포구', courier: 'CJ대한통운', trackingNo: '6012345678903', status: '배송완료' },
  { id: 7, outboundNo: 'OUT-20260310-001', outboundDate: '2026-03-10 09:00', productName: '클렌징 오일 200ml', sku: 'SK-1005', quantity: 20, region: '광주 서구', courier: '롯데택배', trackingNo: '2031234567891', status: '배송완료' },
  { id: 8, outboundNo: 'OUT-20260310-002', outboundDate: '2026-03-10 10:30', productName: '볼류밍 샴푸 500ml', sku: 'HC-3002', quantity: 35, region: '대전 유성구', courier: 'CJ대한통운', trackingNo: '6012345678904', status: '배송완료' },
  { id: 9, outboundNo: 'OUT-20260309-001', outboundDate: '2026-03-09 13:15', productName: '바디 로션 400ml', sku: 'BD-4001', quantity: 60, region: '서울 송파구', courier: '한진택배', trackingNo: '4209876543212', status: '배송완료' },
  { id: 10, outboundNo: 'OUT-20260309-002', outboundDate: '2026-03-09 15:45', productName: '워터프루프 마스카라', sku: 'MK-2004', quantity: 45, region: '경기 수원시', courier: 'CJ대한통운', trackingNo: '6012345678905', status: '배송완료' },
  { id: 11, outboundNo: 'OUT-20260308-001', outboundDate: '2026-03-08 08:30', productName: '수분 크림 50ml', sku: 'SK-1001', quantity: 18, region: '제주 제주시', courier: '롯데택배', trackingNo: '2031234567892', status: '배송완료' },
  { id: 12, outboundNo: 'OUT-20260312-004', outboundDate: '2026-03-12 11:00', productName: '레티놀 나이트크림 30ml', sku: 'SK-1004', quantity: 10, region: '경기 고양시', courier: 'CJ대한통운', trackingNo: '6012345678906', status: '준비중' },
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
const fmt = (n: number) => n.toLocaleString('ko-KR');

const statusColor: Record<InventoryStatus, string> = {
  정상: 'bg-[#27A644]/15 text-[#27A644]',
  주의: 'bg-[#F0BF00]/15 text-[#F0BF00]',
  부족: 'bg-[#FC7840]/15 text-[#FC7840]',
  품절: 'bg-[#EB5757]/15 text-[#EB5757]',
};

const outboundStatusColor: Record<OutboundStatus, string> = {
  준비중: 'bg-[#141516] text-[#8A8F98]',
  출고완료: 'bg-[#5E6AD2]/15 text-[#828FFF]',
  배송중: 'bg-[#5E6AD2]/15 text-[#828FFF]',
  배송완료: 'bg-[#27A644]/15 text-[#27A644]',
};

const priorityColor: Record<AlertPriority, string> = {
  긴급: 'bg-[#EB5757]/15 text-[#EB5757] border-red-300',
  주의: 'bg-[#FC7840]/15 text-[#FC7840] border-orange-300',
  참고: 'bg-[#F0BF00]/15 text-[#F0BF00] border-yellow-300',
};

const deriveStatus = (current: number, safety: number, reorder: number): InventoryStatus => {
  if (current === 0) return '품절';
  if (current < safety) return '부족';
  if (current < reorder) return '주의';
  return '정상';
};

const derivePriority = (current: number, safety: number): AlertPriority => {
  if (current === 0) return '긴급';
  if (current < safety * 0.5) return '긴급';
  if (current < safety) return '주의';
  return '참고';
};

const toCSV = (headers: string[], rows: string[][]) => {
  const bom = '\uFEFF';
  const content = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
  return bom + content;
};

const downloadCSV = (filename: string, csvContent: string) => {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function InventoryPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // State
  const [activeTab, setActiveTab] = useState<TabKey>('재고현황');
  const [inventory, setInventory] = useState<InventoryItem[]>(SAMPLE_INVENTORY);
  const [outbound, setOutbound] = useState<OutboundRecord[]>(SAMPLE_OUTBOUND);

  // Inventory filters
  const [invSearch, setInvSearch] = useState('');
  const [invCategoryFilter, setInvCategoryFilter] = useState('전체');
  const [invStatusFilter, setInvStatusFilter] = useState<'전체' | InventoryStatus>('전체');

  // Outbound filters
  const [obDateFilter, setObDateFilter] = useState('');
  const [obStatusFilter, setObStatusFilter] = useState<'전체' | OutboundStatus>('전체');

  // Modals
  const [showInvModal, setShowInvModal] = useState(false);
  const [editingInv, setEditingInv] = useState<InventoryItem | null>(null);
  const [showObModal, setShowObModal] = useState(false);

  // Inventory form
  const [invForm, setInvForm] = useState({
    skuCode: '',
    productName: '',
    category: '스킨케어',
    currentStock: 0,
    safetyStock: 0,
    reorderPoint: 0,
    lastInboundDate: new Date().toISOString().split('T')[0],
  });

  // Outbound form
  const [obForm, setObForm] = useState({
    productName: '',
    sku: '',
    quantity: 0,
    region: '',
    courier: 'CJ대한통운',
    trackingNo: '',
    status: '준비중' as OutboundStatus,
  });

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // Derived categories
  const categories = useMemo(() => {
    const cats = new Set(inventory.map((i) => i.category));
    return ['전체', ...Array.from(cats).sort()];
  }, [inventory]);

  // Filtered inventory
  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      const matchSearch =
        invSearch === '' || item.productName.toLowerCase().includes(invSearch.toLowerCase());
      const matchCategory = invCategoryFilter === '전체' || item.category === invCategoryFilter;
      const matchStatus = invStatusFilter === '전체' || item.status === invStatusFilter;
      return matchSearch && matchCategory && matchStatus;
    });
  }, [inventory, invSearch, invCategoryFilter, invStatusFilter]);

  // Filtered outbound
  const filteredOutbound = useMemo(() => {
    return outbound.filter((item) => {
      const matchDate =
        obDateFilter === '' || item.outboundDate.startsWith(obDateFilter);
      const matchStatus = obStatusFilter === '전체' || item.status === obStatusFilter;
      return matchDate && matchStatus;
    });
  }, [outbound, obDateFilter, obStatusFilter]);

  // Alert items
  const alertItems: AlertItem[] = useMemo(() => {
    return inventory
      .filter((item) => item.currentStock <= item.reorderPoint)
      .map((item) => ({
        id: item.id,
        productName: item.productName,
        skuCode: item.skuCode,
        category: item.category,
        currentStock: item.currentStock,
        safetyStock: item.safetyStock,
        reorderPoint: item.reorderPoint,
        shortage: Math.max(0, item.safetyStock - item.currentStock),
        priority: derivePriority(item.currentStock, item.safetyStock),
      }))
      .sort((a, b) => {
        const order: Record<AlertPriority, number> = { 긴급: 0, 주의: 1, 참고: 2 };
        return order[a.priority] - order[b.priority];
      });
  }, [inventory]);

  // Summary cards
  const totalSKU = inventory.length;
  const totalStock = inventory.reduce((sum, i) => sum + i.currentStock, 0);
  const lowStockCount = inventory.filter(
    (i) => i.status === '부족' || i.status === '품절'
  ).length;
  const todayOutbound = outbound.filter((o) =>
    o.outboundDate.startsWith('2026-03-12')
  ).length;

  // Chart: stock by category (horizontal bar)
  const categoryChartData = useMemo(() => {
    const map = new Map<string, { current: number; safety: number }>();
    inventory.forEach((item) => {
      const existing = map.get(item.category) || { current: 0, safety: 0 };
      existing.current += item.currentStock;
      existing.safety += item.safetyStock;
      map.set(item.category, existing);
    });
    return Array.from(map.entries()).map(([category, data]) => ({
      category,
      현재재고: data.current,
      안전재고: data.safety,
    }));
  }, [inventory]);

  // Chart: daily outbound trend
  const outboundTrendData = useMemo(() => {
    const map = new Map<string, number>();
    outbound.forEach((o) => {
      const date = o.outboundDate.split(' ')[0];
      map.set(date, (map.get(date) || 0) + o.quantity);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, quantity]) => ({ date: date.slice(5), 출고수량: quantity }));
  }, [outbound]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openAddInvModal = () => {
    setEditingInv(null);
    setInvForm({
      skuCode: '',
      productName: '',
      category: '스킨케어',
      currentStock: 0,
      safetyStock: 0,
      reorderPoint: 0,
      lastInboundDate: new Date().toISOString().split('T')[0],
    });
    setShowInvModal(true);
  };

  const openEditInvModal = (item: InventoryItem) => {
    setEditingInv(item);
    setInvForm({
      skuCode: item.skuCode,
      productName: item.productName,
      category: item.category,
      currentStock: item.currentStock,
      safetyStock: item.safetyStock,
      reorderPoint: item.reorderPoint,
      lastInboundDate: item.lastInboundDate,
    });
    setShowInvModal(true);
  };

  const saveInventoryItem = () => {
    if (!invForm.skuCode || !invForm.productName) return;
    const status = deriveStatus(invForm.currentStock, invForm.safetyStock, invForm.reorderPoint);
    if (editingInv) {
      setInventory((prev) =>
        prev.map((item) =>
          item.id === editingInv.id ? { ...item, ...invForm, status } : item
        )
      );
    } else {
      const newId = Math.max(0, ...inventory.map((i) => i.id)) + 1;
      setInventory((prev) => [...prev, { id: newId, ...invForm, status }]);
    }
    setShowInvModal(false);
  };

  const openAddObModal = () => {
    setObForm({
      productName: '',
      sku: '',
      quantity: 0,
      region: '',
      courier: 'CJ대한통운',
      trackingNo: '',
      status: '준비중',
    });
    setShowObModal(true);
  };

  const saveOutboundRecord = () => {
    if (!obForm.productName || !obForm.sku) return;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const newId = Math.max(0, ...outbound.map((o) => o.id)) + 1;
    const outboundNo = `OUT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(newId).padStart(3, '0')}`;
    setOutbound((prev) => [
      { id: newId, outboundNo, outboundDate: dateStr, ...obForm },
      ...prev,
    ]);
    setShowObModal(false);
  };

  const handleOrderRequest = (alertItem: AlertItem) => {
    alert(`[발주요청] ${alertItem.productName} (${alertItem.skuCode})\n부족수량: ${alertItem.shortage}개\n발주 요청이 전송되었습니다.`);
  };

  const downloadInventoryExcel = () => {
    const headers = ['SKU코드', '상품명', '카테고리', '현재재고', '안전재고', '발주점', '상태', '최종입고일'];
    const rows = filteredInventory.map((i) => [
      i.skuCode, i.productName, i.category,
      String(i.currentStock), String(i.safetyStock), String(i.reorderPoint),
      i.status, i.lastInboundDate,
    ]);
    downloadCSV('재고현황.csv', toCSV(headers, rows));
  };

  const downloadOutboundExcel = () => {
    const headers = ['출고번호', '출고일시', '상품명', 'SKU', '수량', '배송지', '택배사', '운송장번호', '상태'];
    const rows = filteredOutbound.map((o) => [
      o.outboundNo, o.outboundDate, o.productName, o.sku,
      String(o.quantity), o.region, o.courier, o.trackingNo, o.status,
    ]);
    downloadCSV('출고현황.csv', toCSV(headers, rows));
  };

  // ---------------------------------------------------------------------------
  // Auth loading / guard
  // ---------------------------------------------------------------------------
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-[#08090A] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#5E6AD2] border-t-transparent rounded-full animate-spin" />
          <p className="text-[#8A8F98]">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const tabs: TabKey[] = ['재고현황', '출고현황', '재고알림'];

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-[#08090A]">
      <Navigation />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#F7F8F8]">재고/출고현황</h1>
          <p className="text-[#8A8F98] mt-1">
            상품 재고 및 출고 현황을 한눈에 관리하세요
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* 총 SKU 수 */}
          <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#8A8F98]">총 SKU 수</p>
                <p className="text-2xl font-bold text-[#F7F8F8] mt-1">{fmt(totalSKU)}</p>
              </div>
              <div className="w-11 h-11 bg-[#5E6AD2]/15 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-[#7070FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
            </div>
          </div>

          {/* 총 재고수량 */}
          <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#8A8F98]">총 재고수량</p>
                <p className="text-2xl font-bold text-[#F7F8F8] mt-1">{fmt(totalStock)}</p>
              </div>
              <div className="w-11 h-11 bg-[#5E6AD2]/15 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-[#7070FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
              </div>
            </div>
          </div>

          {/* 재고부족 품목 */}
          <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#EB5757]/30 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#EB5757]">재고부족 품목</p>
                <p className="text-2xl font-bold text-[#EB5757] mt-1">{fmt(lowStockCount)}</p>
              </div>
              <div className="w-11 h-11 bg-[#EB5757]/15 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-[#EB5757]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
            </div>
          </div>

          {/* 금일 출고건수 */}
          <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#8A8F98]">금일 출고건수</p>
                <p className="text-2xl font-bold text-[#F7F8F8] mt-1">{fmt(todayOutbound)}</p>
              </div>
              <div className="w-11 h-11 bg-[#27A644]/15 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-[#27A644]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-[#0F1011] rounded-xl p-1 shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] mb-6 w-fit">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-[#5E6AD2] text-white shadow-[0px_1px_3px_rgba(0,0,0,0.2)]'
                  : 'text-[#8A8F98] hover:bg-[#141516]/5'
              }`}
            >
              {tab}
              {tab === '재고알림' && alertItems.length > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  activeTab === tab ? 'bg-[#0F1011]/20 text-white' : 'bg-[#EB5757]/15 text-[#EB5757]'
                }`}>
                  {alertItems.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ================================================================= */}
        {/* 재고현황 Tab                                                       */}
        {/* ================================================================= */}
        {activeTab === '재고현황' && (
          <div className="space-y-6">
            {/* Filters row */}
            <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
              <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 w-full lg:w-auto">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#62666D]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="상품명 검색..."
                    value={invSearch}
                    onChange={(e) => setInvSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Category filter */}
                <select
                  value={invCategoryFilter}
                  onChange={(e) => setInvCategoryFilter(e.target.value)}
                  className="px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[#0F1011]"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>

                {/* Status filter */}
                <select
                  value={invStatusFilter}
                  onChange={(e) => setInvStatusFilter(e.target.value as typeof invStatusFilter)}
                  className="px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[#0F1011]"
                >
                  <option value="전체">상태: 전체</option>
                  <option value="정상">정상</option>
                  <option value="주의">주의</option>
                  <option value="부족">부족</option>
                  <option value="품절">품절</option>
                </select>

                {/* Action buttons */}
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={downloadInventoryExcel}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-[#27A644]/10 text-[#27A644] rounded-lg text-sm font-medium hover:bg-[#27A644]/15 transition-colors border border-emerald-200"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Excel 다운로드
                  </button>
                  <button
                    onClick={openAddInvModal}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-[#5E6AD2] text-white rounded-lg text-sm font-medium hover:bg-[#828FFF] transition-colors shadow-[0px_1px_3px_rgba(0,0,0,0.2)]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    재고 등록
                  </button>
                </div>
              </div>
            </div>

            {/* Inventory table */}
            <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#08090A] border-b border-[#23252A]">
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">SKU코드</th>
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">상품명</th>
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">카테고리</th>
                      <th className="text-right px-5 py-3.5 font-semibold text-[#8A8F98]">현재재고</th>
                      <th className="text-right px-5 py-3.5 font-semibold text-[#8A8F98]">안전재고</th>
                      <th className="text-right px-5 py-3.5 font-semibold text-[#8A8F98]">발주점</th>
                      <th className="text-center px-5 py-3.5 font-semibold text-[#8A8F98]">상태</th>
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">최종입고일</th>
                      <th className="text-center px-5 py-3.5 font-semibold text-[#8A8F98]">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#23252A]">
                    {filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-5 py-12 text-center text-[#62666D]">
                          검색 결과가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-[#141516]/5/50 transition-colors">
                          <td className="px-5 py-3.5 font-mono text-xs text-[#8A8F98]">{item.skuCode}</td>
                          <td className="px-5 py-3.5 font-medium text-[#F7F8F8]">{item.productName}</td>
                          <td className="px-5 py-3.5 text-[#8A8F98]">{item.category}</td>
                          <td className="px-5 py-3.5 text-right font-semibold text-[#F7F8F8]">{fmt(item.currentStock)}</td>
                          <td className="px-5 py-3.5 text-right text-[#8A8F98]">{fmt(item.safetyStock)}</td>
                          <td className="px-5 py-3.5 text-right text-[#8A8F98]">{fmt(item.reorderPoint)}</td>
                          <td className="px-5 py-3.5 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${statusColor[item.status]}`}>
                              {item.status}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-[#8A8F98]">{item.lastInboundDate}</td>
                          <td className="px-5 py-3.5 text-center">
                            <button
                              onClick={() => openEditInvModal(item)}
                              className="text-[#7070FF] hover:text-[#828FFF] text-xs font-medium hover:underline"
                            >
                              수정
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 bg-[#08090A] border-t border-[#23252A] text-sm text-[#8A8F98]">
                총 {fmt(filteredInventory.length)}개 품목
              </div>
            </div>

            {/* Stock level bar chart */}
            <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-6">
              <h3 className="text-base font-bold text-[#F7F8F8] mb-4">카테고리별 재고 현황</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={categoryChartData}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1C1C1F" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: '#8A8F98' }} />
                    <YAxis dataKey="category" type="category" tick={{ fontSize: 12, fill: '#8A8F98' }} width={70} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #34343A',
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                      }}
                      formatter={(value: number) => fmt(value)}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="현재재고" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="안전재고" fill="#232326" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* 출고현황 Tab                                                       */}
        {/* ================================================================= */}
        {activeTab === '출고현황' && (
          <div className="space-y-6">
            {/* Filters row */}
            <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
              <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
                {/* Date filter */}
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-[#8A8F98]">출고일</label>
                  <input
                    type="date"
                    value={obDateFilter}
                    onChange={(e) => setObDateFilter(e.target.value)}
                    className="px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[#0F1011]"
                  />
                  {obDateFilter && (
                    <button
                      onClick={() => setObDateFilter('')}
                      className="text-xs text-[#62666D] hover:text-[#D0D6E0]"
                    >
                      초기화
                    </button>
                  )}
                </div>

                {/* Status filter */}
                <select
                  value={obStatusFilter}
                  onChange={(e) => setObStatusFilter(e.target.value as typeof obStatusFilter)}
                  className="px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[#0F1011]"
                >
                  <option value="전체">상태: 전체</option>
                  <option value="준비중">준비중</option>
                  <option value="출고완료">출고완료</option>
                  <option value="배송중">배송중</option>
                  <option value="배송완료">배송완료</option>
                </select>

                {/* Action buttons */}
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={downloadOutboundExcel}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-[#27A644]/10 text-[#27A644] rounded-lg text-sm font-medium hover:bg-[#27A644]/15 transition-colors border border-emerald-200"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Excel 다운로드
                  </button>
                  <button
                    onClick={openAddObModal}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-[#5E6AD2] text-white rounded-lg text-sm font-medium hover:bg-[#828FFF] transition-colors shadow-[0px_1px_3px_rgba(0,0,0,0.2)]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    출고 등록
                  </button>
                </div>
              </div>
            </div>

            {/* Outbound table */}
            <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#08090A] border-b border-[#23252A]">
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">출고번호</th>
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">출고일시</th>
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">상품명</th>
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">SKU</th>
                      <th className="text-right px-5 py-3.5 font-semibold text-[#8A8F98]">수량</th>
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">배송지</th>
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">택배사</th>
                      <th className="text-left px-5 py-3.5 font-semibold text-[#8A8F98]">운송장번호</th>
                      <th className="text-center px-5 py-3.5 font-semibold text-[#8A8F98]">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#23252A]">
                    {filteredOutbound.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-5 py-12 text-center text-[#62666D]">
                          검색 결과가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredOutbound.map((item) => (
                        <tr key={item.id} className="hover:bg-[#141516]/5/50 transition-colors">
                          <td className="px-5 py-3.5 font-mono text-xs text-[#8A8F98]">{item.outboundNo}</td>
                          <td className="px-5 py-3.5 text-[#8A8F98]">{item.outboundDate}</td>
                          <td className="px-5 py-3.5 font-medium text-[#F7F8F8]">{item.productName}</td>
                          <td className="px-5 py-3.5 font-mono text-xs text-[#8A8F98]">{item.sku}</td>
                          <td className="px-5 py-3.5 text-right font-semibold text-[#F7F8F8]">{fmt(item.quantity)}</td>
                          <td className="px-5 py-3.5 text-[#8A8F98]">{item.region}</td>
                          <td className="px-5 py-3.5 text-[#8A8F98]">{item.courier}</td>
                          <td className="px-5 py-3.5 font-mono text-xs text-[#8A8F98]">{item.trackingNo}</td>
                          <td className="px-5 py-3.5 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${outboundStatusColor[item.status]}`}>
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 bg-[#08090A] border-t border-[#23252A] text-sm text-[#8A8F98]">
                총 {fmt(filteredOutbound.length)}건
              </div>
            </div>

            {/* Daily outbound trend */}
            <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-6">
              <h3 className="text-base font-bold text-[#F7F8F8] mb-4">일별 출고 추이</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={outboundTrendData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1C1C1F" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#8A8F98' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#8A8F98' }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #34343A',
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                      }}
                      formatter={(value: number) => [fmt(value) + '개', '출고수량']}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Line
                      type="monotone"
                      dataKey="출고수량"
                      stroke="#6366f1"
                      strokeWidth={2.5}
                      dot={{ r: 5, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 7, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* 재고알림 Tab                                                       */}
        {/* ================================================================= */}
        {activeTab === '재고알림' && (
          <div className="space-y-4">
            {alertItems.length === 0 ? (
              <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-12 text-center">
                <div className="w-16 h-16 bg-[#27A644]/15 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-lg font-semibold text-[#D0D6E0]">모든 재고가 정상입니다</p>
                <p className="text-sm text-[#8A8F98] mt-1">재고 부족 알림이 없습니다.</p>
              </div>
            ) : (
              <>
                <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#EB5757]/15 rounded-xl flex items-center justify-center">
                      <svg className="w-5 h-5 text-[#EB5757]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-bold text-[#F7F8F8]">재고 부족 알림</h3>
                      <p className="text-sm text-[#8A8F98]">
                        안전재고 이하 또는 발주점 이하 품목 {alertItems.length}건
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {alertItems.map((item) => (
                    <div
                      key={item.id}
                      className={`bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border p-5 ${
                        item.priority === '긴급'
                          ? 'border-[#EB5757]/30'
                          : item.priority === '주의'
                          ? 'border-[#FC7840]/30'
                          : 'border-[#F0BF00]/30'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${priorityColor[item.priority]}`}>
                              {item.priority}
                            </span>
                            <span className="text-xs text-[#62666D] font-mono">{item.skuCode}</span>
                          </div>
                          <h4 className="font-bold text-[#F7F8F8]">{item.productName}</h4>
                          <p className="text-xs text-[#8A8F98] mt-0.5">{item.category}</p>
                        </div>
                        <button
                          onClick={() => handleOrderRequest(item)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-[#5E6AD2] text-white rounded-lg text-xs font-semibold hover:bg-[#828FFF] transition-colors shadow-[0px_1px_3px_rgba(0,0,0,0.2)] shrink-0"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                          </svg>
                          발주요청
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-3 mt-4">
                        <div className="bg-[#08090A] rounded-lg p-3 text-center">
                          <p className="text-xs text-[#8A8F98] mb-1">현재재고</p>
                          <p className={`text-lg font-bold ${item.currentStock === 0 ? 'text-[#EB5757]' : 'text-[#F7F8F8]'}`}>
                            {fmt(item.currentStock)}
                          </p>
                        </div>
                        <div className="bg-[#08090A] rounded-lg p-3 text-center">
                          <p className="text-xs text-[#8A8F98] mb-1">안전재고</p>
                          <p className="text-lg font-bold text-[#F7F8F8]">{fmt(item.safetyStock)}</p>
                        </div>
                        <div className="bg-[#EB5757]/10 rounded-lg p-3 text-center">
                          <p className="text-xs text-[#EB5757] mb-1">부족수량</p>
                          <p className="text-lg font-bold text-[#EB5757]">{fmt(item.shortage)}</p>
                        </div>
                      </div>

                      {/* Stock bar visualization */}
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-[#8A8F98] mb-1">
                          <span>재고 수준</span>
                          <span>{item.safetyStock > 0 ? Math.round((item.currentStock / item.safetyStock) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-[#141516] rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              item.currentStock === 0
                                ? 'bg-[#EB5757]'
                                : item.currentStock < item.safetyStock * 0.5
                                ? 'bg-[#EB5757]/80'
                                : item.currentStock < item.safetyStock
                                ? 'bg-[#FC7840]/80'
                                : 'bg-[#F0BF00]/80'
                            }`}
                            style={{
                              width: `${Math.min(100, item.safetyStock > 0 ? (item.currentStock / item.safetyStock) * 100 : 0)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* Inventory Add/Edit Modal                                           */}
      {/* ================================================================= */}
      {showInvModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowInvModal(false)}
          />
          <div className="relative bg-[#0F1011] rounded-2xl shadow-2xl border border-[#23252A] w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-[#F7F8F8]">
                  {editingInv ? '재고 수정' : '재고 등록'}
                </h2>
                <button
                  onClick={() => setShowInvModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#141516]/5 text-[#62666D] hover:text-[#D0D6E0] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">SKU 코드</label>
                  <input
                    type="text"
                    value={invForm.skuCode}
                    onChange={(e) => setInvForm((f) => ({ ...f, skuCode: e.target.value }))}
                    placeholder="예: SK-1006"
                    className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">상품명</label>
                  <input
                    type="text"
                    value={invForm.productName}
                    onChange={(e) => setInvForm((f) => ({ ...f, productName: e.target.value }))}
                    placeholder="상품명을 입력하세요"
                    className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">카테고리</label>
                  <select
                    value={invForm.category}
                    onChange={(e) => setInvForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[#0F1011]"
                  >
                    <option value="스킨케어">스킨케어</option>
                    <option value="메이크업">메이크업</option>
                    <option value="헤어케어">헤어케어</option>
                    <option value="바디케어">바디케어</option>
                    <option value="선케어">선케어</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">현재재고</label>
                    <input
                      type="number"
                      min={0}
                      value={invForm.currentStock}
                      onChange={(e) => setInvForm((f) => ({ ...f, currentStock: Number(e.target.value) }))}
                      className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">안전재고</label>
                    <input
                      type="number"
                      min={0}
                      value={invForm.safetyStock}
                      onChange={(e) => setInvForm((f) => ({ ...f, safetyStock: Number(e.target.value) }))}
                      className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">발주점</label>
                    <input
                      type="number"
                      min={0}
                      value={invForm.reorderPoint}
                      onChange={(e) => setInvForm((f) => ({ ...f, reorderPoint: Number(e.target.value) }))}
                      className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">최종입고일</label>
                  <input
                    type="date"
                    value={invForm.lastInboundDate}
                    onChange={(e) => setInvForm((f) => ({ ...f, lastInboundDate: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[#23252A]">
                <button
                  onClick={() => setShowInvModal(false)}
                  className="px-5 py-2.5 text-sm font-medium text-[#8A8F98] hover:bg-[#141516]/5 rounded-lg transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={saveInventoryItem}
                  className="px-5 py-2.5 bg-[#5E6AD2] text-white rounded-lg text-sm font-medium hover:bg-[#828FFF] transition-colors shadow-[0px_1px_3px_rgba(0,0,0,0.2)]"
                >
                  {editingInv ? '수정 완료' : '등록'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Outbound Add Modal                                                 */}
      {/* ================================================================= */}
      {showObModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowObModal(false)}
          />
          <div className="relative bg-[#0F1011] rounded-2xl shadow-2xl border border-[#23252A] w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-[#F7F8F8]">출고 등록</h2>
                <button
                  onClick={() => setShowObModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#141516]/5 text-[#62666D] hover:text-[#D0D6E0] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">상품명</label>
                  <input
                    type="text"
                    value={obForm.productName}
                    onChange={(e) => setObForm((f) => ({ ...f, productName: e.target.value }))}
                    placeholder="상품명을 입력하세요"
                    className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">SKU</label>
                    <input
                      type="text"
                      value={obForm.sku}
                      onChange={(e) => setObForm((f) => ({ ...f, sku: e.target.value }))}
                      placeholder="예: SK-1001"
                      className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">수량</label>
                    <input
                      type="number"
                      min={1}
                      value={obForm.quantity}
                      onChange={(e) => setObForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
                      className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">배송지 (지역)</label>
                  <input
                    type="text"
                    value={obForm.region}
                    onChange={(e) => setObForm((f) => ({ ...f, region: e.target.value }))}
                    placeholder="예: 서울 강남구"
                    className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">택배사</label>
                    <select
                      value={obForm.courier}
                      onChange={(e) => setObForm((f) => ({ ...f, courier: e.target.value }))}
                      className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[#0F1011]"
                    >
                      <option value="CJ대한통운">CJ대한통운</option>
                      <option value="한진택배">한진택배</option>
                      <option value="롯데택배">롯데택배</option>
                      <option value="우체국택배">우체국택배</option>
                      <option value="로젠택배">로젠택배</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">운송장번호</label>
                    <input
                      type="text"
                      value={obForm.trackingNo}
                      onChange={(e) => setObForm((f) => ({ ...f, trackingNo: e.target.value }))}
                      placeholder="운송장번호"
                      className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">상태</label>
                  <select
                    value={obForm.status}
                    onChange={(e) => setObForm((f) => ({ ...f, status: e.target.value as OutboundStatus }))}
                    className="w-full px-4 py-2.5 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[#0F1011]"
                  >
                    <option value="준비중">준비중</option>
                    <option value="출고완료">출고완료</option>
                    <option value="배송중">배송중</option>
                    <option value="배송완료">배송완료</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[#23252A]">
                <button
                  onClick={() => setShowObModal(false)}
                  className="px-5 py-2.5 text-sm font-medium text-[#8A8F98] hover:bg-[#141516]/5 rounded-lg transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={saveOutboundRecord}
                  className="px-5 py-2.5 bg-[#5E6AD2] text-white rounded-lg text-sm font-medium hover:bg-[#828FFF] transition-colors shadow-[0px_1px_3px_rgba(0,0,0,0.2)]"
                >
                  등록
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
