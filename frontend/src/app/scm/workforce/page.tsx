'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ---------------------------------------------------------------------------
// API helper
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
  } catch { return defaultValue; }
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Department = '물류' | '생산' | 'CS' | '관리';
type StaffStatus = '근무중' | '휴무' | '연차' | '출장';
type ShiftType = '주간' | '야간' | '휴무' | '연차';
type TaskStatus = '진행중' | '완료' | '대기';
type TabKey = '인력현황' | '주간스케줄' | '공수관리';

interface Staff {
  id: string;
  name: string;
  department: Department;
  position: string;
  status: StaffStatus;
  task: string;
  phone: string;
}

interface ScheduleEntry {
  staffId: string;
  date: string; // YYYY-MM-DD
  shift: ShiftType;
}

interface Task {
  id: string;
  name: string;
  assigneeId: string;
  inputHours: number;
  estimatedHours: number;
  progress: number; // 0-100
  status: TaskStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEPARTMENTS: Department[] = ['물류', '생산', 'CS', '관리'];
const STAFF_STATUSES: StaffStatus[] = ['근무중', '휴무', '연차', '출장'];
const SHIFT_TYPES: ShiftType[] = ['주간', '야간', '휴무', '연차'];
const TASK_STATUSES: TaskStatus[] = ['진행중', '완료', '대기'];
const POSITIONS = ['팀장', '대리', '사원', '주임', '과장', '인턴'];
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

const STATUS_COLORS: Record<StaffStatus, string> = {
  '근무중': 'bg-[#27A644]/15 text-[#27A644]',
  '휴무': 'bg-[#141516] text-[#8A8F98]',
  '연차': 'bg-[#F0BF00]/15 text-[#F0BF00]',
  '출장': 'bg-[#5E6AD2]/15 text-[#828FFF]',
};

const SHIFT_COLORS: Record<ShiftType, string> = {
  '주간': 'bg-[#5E6AD2]/15 text-[#828FFF] border-[#5E6AD2]/30',
  '야간': 'bg-[#5E6AD2]/15 text-[#828FFF] border-[#5E6AD2]/30',
  '휴무': 'bg-[#141516] text-[#8A8F98] border-[#23252A]',
  '연차': 'bg-[#F0BF00]/15 text-[#F0BF00] border-[#F0BF00]/30',
};

const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  '진행중': 'bg-[#5E6AD2]/15 text-[#828FFF]',
  '완료': 'bg-[#27A644]/15 text-[#27A644]',
  '대기': 'bg-[#141516] text-[#8A8F98]',
};

const PIE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// ---------------------------------------------------------------------------
// Sample Data
// ---------------------------------------------------------------------------
const INITIAL_STAFF: Staff[] = [
  { id: 's1', name: '김민준', department: '물류', position: '팀장', status: '근무중', task: '입출고 관리', phone: '010-1234-5678' },
  { id: 's2', name: '이서윤', department: '생산', position: '대리', status: '근무중', task: '생산 라인 관리', phone: '010-2345-6789' },
  { id: 's3', name: '박지호', department: 'CS', position: '사원', status: '근무중', task: '고객 문의 대응', phone: '010-3456-7890' },
  { id: 's4', name: '최수아', department: '관리', position: '과장', status: '근무중', task: '인사/총무 관리', phone: '010-4567-8901' },
  { id: 's5', name: '정하은', department: '물류', position: '주임', status: '출장', task: '배송 모니터링', phone: '010-5678-9012' },
  { id: 's6', name: '강도윤', department: '생산', position: '사원', status: '연차', task: '품질 검수', phone: '010-6789-0123' },
  { id: 's7', name: '윤지민', department: 'CS', position: '대리', status: '근무중', task: '반품/교환 처리', phone: '010-7890-1234' },
  { id: 's8', name: '장예준', department: '물류', position: '사원', status: '근무중', task: '재고 실사', phone: '010-8901-2345' },
  { id: 's9', name: '한서진', department: '생산', position: '팀장', status: '근무중', task: '생산 계획 수립', phone: '010-9012-3456' },
  { id: 's10', name: '오유나', department: '관리', position: '인턴', status: '휴무', task: '데이터 입력', phone: '010-0123-4567' },
];

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function generateInitialSchedule(staff: Staff[], monday: Date): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  const shifts: ShiftType[] = ['주간', '야간', '휴무', '연차'];
  staff.forEach((s, sIdx) => {
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      let shift: ShiftType;
      if (i >= 5) {
        shift = sIdx % 3 === 0 ? '주간' : '휴무';
      } else if (s.status === '연차') {
        shift = '연차';
      } else if (s.status === '휴무') {
        shift = '휴무';
      } else {
        shift = shifts[((sIdx + i) % 3 === 0) ? 1 : 0];
      }
      entries.push({ staffId: s.id, date: formatDate(d), shift });
    }
  });
  return entries;
}

const INITIAL_TASKS: Task[] = [
  { id: 't1', name: '3월 입고 검수', assigneeId: 's1', inputHours: 24, estimatedHours: 30, progress: 80, status: '진행중' },
  { id: 't2', name: '신규 상품 등록', assigneeId: 's2', inputHours: 16, estimatedHours: 20, progress: 100, status: '완료' },
  { id: 't3', name: 'CS 매뉴얼 업데이트', assigneeId: 's3', inputHours: 8, estimatedHours: 16, progress: 50, status: '진행중' },
  { id: 't4', name: '급여 정산', assigneeId: 's4', inputHours: 12, estimatedHours: 12, progress: 100, status: '완료' },
  { id: 't5', name: '거래처 출장 미팅', assigneeId: 's5', inputHours: 32, estimatedHours: 40, progress: 60, status: '진행중' },
  { id: 't6', name: '반품 처리 자동화', assigneeId: 's7', inputHours: 20, estimatedHours: 36, progress: 55, status: '진행중' },
  { id: 't7', name: '재고 실사 보고서', assigneeId: 's8', inputHours: 6, estimatedHours: 10, progress: 0, status: '대기' },
  { id: 't8', name: '4월 생산 계획', assigneeId: 's9', inputHours: 28, estimatedHours: 32, progress: 70, status: '진행중' },
  { id: 't9', name: 'ERP 데이터 이관', assigneeId: 's10', inputHours: 4, estimatedHours: 20, progress: 20, status: '진행중' },
  { id: 't10', name: '배송 지연 분석', assigneeId: 's1', inputHours: 10, estimatedHours: 14, progress: 30, status: '진행중' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function WorkforcePage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // Tabs
  const [activeTab, setActiveTab] = useState<TabKey>('인력현황');

  // Staff state
  const [staffList, setStaffList] = useState<Staff[]>(INITIAL_STAFF);
  const [departmentFilter, setDepartmentFilter] = useState<Department | '전체'>('전체');
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

  // Schedule state
  const [currentMonday, setCurrentMonday] = useState<Date>(() => getMonday(new Date()));
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);

  // Task state
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [showTaskModal, setShowTaskModal] = useState(false);

  // Initialize schedule
  useEffect(() => {
    setSchedule(generateInitialSchedule(staffList, currentMonday));
  }, [currentMonday, staffList]);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const filteredStaff = useMemo(() => {
    if (departmentFilter === '전체') return staffList;
    return staffList.filter(s => s.department === departmentFilter);
  }, [staffList, departmentFilter]);

  const summaryCards = useMemo(() => {
    const total = staffList.length;
    const working = staffList.filter(s => s.status === '근무중').length;
    const available = staffList.filter(s => s.status === '근무중' || s.status === '출장').length;
    const totalInput = tasks.reduce((a, t) => a + t.inputHours, 0);
    const totalEstimated = tasks.reduce((a, t) => a + t.estimatedHours, 0);
    const utilization = totalEstimated > 0 ? Math.round((totalInput / totalEstimated) * 100) : 0;
    return { total, working, available, utilization };
  }, [staffList, tasks]);

  // Weekly dates for schedule tab
  const weekDates = useMemo(() => {
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentMonday);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [currentMonday]);

  // Bar chart data (per assignee weekly hours vs 40h)
  const barChartData = useMemo(() => {
    const map = new Map<string, number>();
    tasks.forEach(t => {
      const prev = map.get(t.assigneeId) || 0;
      map.set(t.assigneeId, prev + t.inputHours);
    });
    return staffList
      .filter(s => map.has(s.id))
      .map(s => ({
        name: s.name,
        투입시간: map.get(s.id) || 0,
        기준시간: 40,
      }));
  }, [staffList, tasks]);

  // Pie chart data (task status distribution)
  const pieData = useMemo(() => {
    const counts: Record<TaskStatus, number> = { '진행중': 0, '완료': 0, '대기': 0 };
    tasks.forEach(t => { counts[t.status]++; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [tasks]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleSaveStaff = useCallback((staff: Staff) => {
    setStaffList(prev => {
      const idx = prev.findIndex(s => s.id === staff.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = staff;
        return next;
      }
      return [...prev, staff];
    });
    setShowStaffModal(false);
    setEditingStaff(null);
  }, []);

  const handleDeleteStaff = useCallback((id: string) => {
    setStaffList(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleShiftChange = useCallback((staffId: string, date: string) => {
    setSchedule(prev => {
      return prev.map(e => {
        if (e.staffId === staffId && e.date === date) {
          const currentIdx = SHIFT_TYPES.indexOf(e.shift);
          const nextIdx = (currentIdx + 1) % SHIFT_TYPES.length;
          return { ...e, shift: SHIFT_TYPES[nextIdx] };
        }
        return e;
      });
    });
  }, []);

  const handleWeekNav = useCallback((direction: -1 | 1) => {
    setCurrentMonday(prev => {
      const next = new Date(prev);
      next.setDate(next.getDate() + direction * 7);
      return next;
    });
  }, []);

  const handleSaveTask = useCallback((task: Task) => {
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === task.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = task;
        return next;
      }
      return [...prev, task];
    });
    setShowTaskModal(false);
  }, []);

  const handleDeleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  // ---------------------------------------------------------------------------
  // Loading / Auth guard renders
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

  if (!user) return null;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  const formatNum = (n: number) => n.toLocaleString('ko-KR');

  const weekLabel = (() => {
    const start = weekDates[0];
    const end = weekDates[6];
    return `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일 ~ ${end.getMonth() + 1}월 ${end.getDate()}일`;
  })();

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-[#08090A]">
      <Navigation />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#F7F8F8]">인력배치 / 공수 관리</h1>
          <p className="text-[#8A8F98] mt-1">SCM 인력 현황과 업무 공수를 관리하세요</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <SummaryCard
            label="총 인원"
            value={formatNum(summaryCards.total)}
            unit="명"
            icon={
              <svg className="w-6 h-6 text-[#7070FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            }
            accent="blue"
          />
          <SummaryCard
            label="금일 근무"
            value={formatNum(summaryCards.working)}
            unit="명"
            icon={
              <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            accent="emerald"
          />
          <SummaryCard
            label="가용 인력"
            value={formatNum(summaryCards.available)}
            unit="명"
            icon={
              <svg className="w-6 h-6 text-[#7070FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            }
            accent="indigo"
          />
          <SummaryCard
            label="평균 공수율"
            value={formatNum(summaryCards.utilization)}
            unit="%"
            icon={
              <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
            accent="amber"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[#0F1011] rounded-xl p-1 shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] w-fit">
          {(['인력현황', '주간스케줄', '공수관리'] as TabKey[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-[#5E6AD2] text-white shadow-[0px_3px_12px_rgba(0,0,0,0.2)]'
                  : 'text-[#8A8F98] hover:bg-[#141516]/5'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === '인력현황' && (
          <StaffTab
            staff={filteredStaff}
            departmentFilter={departmentFilter}
            onFilterChange={setDepartmentFilter}
            onAdd={() => { setEditingStaff(null); setShowStaffModal(true); }}
            onEdit={(s) => { setEditingStaff(s); setShowStaffModal(true); }}
            onDelete={handleDeleteStaff}
          />
        )}

        {activeTab === '주간스케줄' && (
          <ScheduleTab
            staff={staffList}
            schedule={schedule}
            weekDates={weekDates}
            weekLabel={weekLabel}
            onShiftChange={handleShiftChange}
            onWeekNav={handleWeekNav}
          />
        )}

        {activeTab === '공수관리' && (
          <TaskTab
            tasks={tasks}
            staffList={staffList}
            barChartData={barChartData}
            pieData={pieData}
            onAdd={() => setShowTaskModal(true)}
            onDelete={handleDeleteTask}
          />
        )}
      </div>

      {/* Staff Modal */}
      {showStaffModal && (
        <StaffModal
          staff={editingStaff}
          onSave={handleSaveStaff}
          onClose={() => { setShowStaffModal(false); setEditingStaff(null); }}
        />
      )}

      {/* Task Modal */}
      {showTaskModal && (
        <TaskModal
          staffList={staffList}
          onSave={handleSaveTask}
          onClose={() => setShowTaskModal(false)}
        />
      )}
    </main>
  );
}

// ===========================================================================
// Summary Card
// ===========================================================================
function SummaryCard({ label, value, unit, icon, accent }: {
  label: string;
  value: string;
  unit: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl bg-${accent}-50 flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-[#8A8F98]">{label}</p>
        <p className="text-2xl font-bold text-[#F7F8F8] mt-0.5">
          {value}
          <span className="text-sm font-normal text-[#62666D] ml-1">{unit}</span>
        </p>
      </div>
    </div>
  );
}

// ===========================================================================
// Staff Tab
// ===========================================================================
function StaffTab({ staff, departmentFilter, onFilterChange, onAdd, onEdit, onDelete }: {
  staff: Staff[];
  departmentFilter: Department | '전체';
  onFilterChange: (d: Department | '전체') => void;
  onAdd: () => void;
  onEdit: (s: Staff) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] overflow-hidden">
      {/* Toolbar */}
      <div className="p-4 border-b border-[#23252A] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#8A8F98]">부서 필터:</span>
          {(['전체', ...DEPARTMENTS] as (Department | '전체')[]).map(dep => (
            <button
              key={dep}
              onClick={() => onFilterChange(dep)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                departmentFilter === dep
                  ? 'bg-[#5E6AD2] text-white'
                  : 'bg-[#141516] text-[#8A8F98] hover:bg-[#141516]/7'
              }`}
            >
              {dep}
            </button>
          ))}
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#5E6AD2] text-white text-sm font-medium rounded-lg hover:bg-[#828FFF] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          인력 추가
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#08090A]">
              <th className="text-left px-4 py-3 font-semibold text-[#8A8F98]">이름</th>
              <th className="text-left px-4 py-3 font-semibold text-[#8A8F98]">부서</th>
              <th className="text-left px-4 py-3 font-semibold text-[#8A8F98]">직급</th>
              <th className="text-left px-4 py-3 font-semibold text-[#8A8F98]">상태</th>
              <th className="text-left px-4 py-3 font-semibold text-[#8A8F98]">담당업무</th>
              <th className="text-left px-4 py-3 font-semibold text-[#8A8F98]">연락처</th>
              <th className="text-center px-4 py-3 font-semibold text-[#8A8F98]">관리</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-[#62666D]">등록된 인력이 없습니다.</td>
              </tr>
            )}
            {staff.map(s => (
              <tr key={s.id} className="border-t border-[#23252A] hover:bg-[#141516]/5/60 transition-colors">
                <td className="px-4 py-3 font-medium text-[#F7F8F8]">{s.name}</td>
                <td className="px-4 py-3">
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#5E6AD2]/10 text-[#828FFF]">
                    {s.department}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#8A8F98]">{s.position}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[s.status]}`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#8A8F98]">{s.task}</td>
                <td className="px-4 py-3 text-[#8A8F98] font-mono text-xs">{s.phone}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => onEdit(s)}
                      className="p-1.5 rounded-lg text-[#62666D] hover:text-[#7070FF] hover:bg-[#5E6AD2]/10 transition-colors"
                      title="수정"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`${s.name} 인력을 삭제하시겠습니까?`)) onDelete(s.id);
                      }}
                      className="p-1.5 rounded-lg text-[#62666D] hover:text-[#EB5757] hover:bg-[#EB5757]/10 transition-colors"
                      title="삭제"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#23252A] bg-[#08090A]/50 text-xs text-[#8A8F98]">
        총 <span className="font-semibold text-[#D0D6E0]">{staff.length}</span>명 조회됨
      </div>
    </div>
  );
}

// ===========================================================================
// Staff Modal
// ===========================================================================
function StaffModal({ staff, onSave, onClose }: {
  staff: Staff | null;
  onSave: (s: Staff) => void;
  onClose: () => void;
}) {
  const isEdit = !!staff;
  const [form, setForm] = useState<Staff>(
    staff || {
      id: `s${Date.now()}`,
      name: '',
      department: '물류',
      position: '사원',
      status: '근무중',
      task: '',
      phone: '',
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-[#0F1011] rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#23252A] flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#F7F8F8]">{isEdit ? '인력 수정' : '인력 추가'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#141516]/5 text-[#62666D] hover:text-[#D0D6E0] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[#D0D6E0] mb-1">이름 *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="홍길동"
              required
            />
          </div>
          {/* Department & Position */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#D0D6E0] mb-1">부서</label>
              <select
                value={form.department}
                onChange={e => setForm(p => ({ ...p, department: e.target.value as Department }))}
                className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#D0D6E0] mb-1">직급</label>
              <select
                value={form.position}
                onChange={e => setForm(p => ({ ...p, position: e.target.value }))}
                className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-[#D0D6E0] mb-1">상태</label>
            <div className="flex gap-2">
              {STAFF_STATUSES.map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, status: st }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    form.status === st
                      ? `${STATUS_COLORS[st]} border-current`
                      : 'bg-[#0F1011] text-[#8A8F98] border-[#23252A] hover:bg-[#141516]/5'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
          {/* Task */}
          <div>
            <label className="block text-sm font-medium text-[#D0D6E0] mb-1">담당업무</label>
            <input
              type="text"
              value={form.task}
              onChange={e => setForm(p => ({ ...p, task: e.target.value }))}
              className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="업무 내용"
            />
          </div>
          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-[#D0D6E0] mb-1">연락처</label>
            <input
              type="text"
              value={form.phone}
              onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
              className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="010-0000-0000"
            />
          </div>
          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[#8A8F98] bg-[#141516] rounded-lg hover:bg-[#141516]/7 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-[#5E6AD2] rounded-lg hover:bg-[#828FFF] transition-colors"
            >
              {isEdit ? '수정' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===========================================================================
// Schedule Tab
// ===========================================================================
function ScheduleTab({ staff, schedule, weekDates, weekLabel, onShiftChange, onWeekNav }: {
  staff: Staff[];
  schedule: ScheduleEntry[];
  weekDates: Date[];
  weekLabel: string;
  onShiftChange: (staffId: string, date: string) => void;
  onWeekNav: (dir: -1 | 1) => void;
}) {
  const getShift = (staffId: string, date: Date): ShiftType => {
    const dateStr = formatDate(date);
    const entry = schedule.find(e => e.staffId === staffId && e.date === dateStr);
    return entry?.shift || '주간';
  };

  return (
    <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] overflow-hidden">
      {/* Week navigation */}
      <div className="p-4 border-b border-[#23252A] flex items-center justify-between">
        <button
          onClick={() => onWeekNav(-1)}
          className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-[#8A8F98] bg-[#141516] rounded-lg hover:bg-[#141516]/7 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          이전 주
        </button>
        <h3 className="text-sm font-bold text-[#D0D6E0]">{weekLabel}</h3>
        <button
          onClick={() => onWeekNav(1)}
          className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-[#8A8F98] bg-[#141516] rounded-lg hover:bg-[#141516]/7 transition-colors"
        >
          다음 주
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-b border-[#23252A] flex items-center gap-4 flex-wrap">
        <span className="text-xs text-[#8A8F98] font-medium">범례:</span>
        {SHIFT_TYPES.map(st => (
          <span key={st} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${SHIFT_COLORS[st]}`}>
            {st}
          </span>
        ))}
        <span className="text-xs text-[#62666D] ml-auto">셀을 클릭하여 근무 유형을 변경하세요</span>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#08090A]">
              <th className="text-left px-4 py-3 font-semibold text-[#8A8F98] min-w-[120px] sticky left-0 bg-[#08090A] z-10">
                이름
              </th>
              {weekDates.map((d, i) => {
                const isWeekend = i >= 5;
                return (
                  <th
                    key={i}
                    className={`text-center px-2 py-3 font-semibold min-w-[80px] ${
                      isWeekend ? 'text-[#EB5757]' : 'text-[#8A8F98]'
                    }`}
                  >
                    <div>{WEEKDAYS[i]}</div>
                    <div className="text-xs font-normal mt-0.5">
                      {d.getMonth() + 1}/{d.getDate()}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {staff.map(s => (
              <tr key={s.id} className="border-t border-[#23252A] hover:bg-[#141516]/5/40 transition-colors">
                <td className="px-4 py-2 font-medium text-[#F7F8F8] sticky left-0 bg-[#0F1011] z-10">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-[#5E6AD2]/15 text-[#7070FF] flex items-center justify-center text-xs font-bold shrink-0">
                      {s.name[0]}
                    </div>
                    <div>
                      <div className="text-sm">{s.name}</div>
                      <div className="text-[10px] text-[#62666D]">{s.department}</div>
                    </div>
                  </div>
                </td>
                {weekDates.map((d, i) => {
                  const shift = getShift(s.id, d);
                  const dateStr = formatDate(d);
                  return (
                    <td key={i} className="px-1 py-1.5 text-center">
                      <button
                        onClick={() => onShiftChange(s.id, dateStr)}
                        className={`w-full px-2 py-1.5 rounded-lg text-xs font-medium border transition-all hover:scale-105 hover:shadow-[0px_1px_3px_rgba(0,0,0,0.2)] cursor-pointer ${SHIFT_COLORS[shift]}`}
                        title={`클릭하여 변경 (현재: ${shift})`}
                      >
                        {shift}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary footer */}
      <div className="px-4 py-3 border-t border-[#23252A] bg-[#08090A]/50 flex items-center gap-6 text-xs text-[#8A8F98]">
        {SHIFT_TYPES.map(st => {
          const count = schedule.filter(e => e.shift === st).length;
          return (
            <span key={st}>
              {st}: <span className="font-semibold text-[#D0D6E0]">{count}</span>건
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// Task Tab
// ===========================================================================
function TaskTab({ tasks, staffList, barChartData, pieData, onAdd, onDelete }: {
  tasks: Task[];
  staffList: Staff[];
  barChartData: { name: string; 투입시간: number; 기준시간: number }[];
  pieData: { name: string; value: number }[];
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  const getAssigneeName = (id: string) => staffList.find(s => s.id === id)?.name || '-';

  return (
    <div className="space-y-6">
      {/* Task Table */}
      <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] overflow-hidden">
        <div className="p-4 border-b border-[#23252A] flex items-center justify-between">
          <h3 className="text-base font-bold text-[#F7F8F8]">업무 목록</h3>
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#5E6AD2] text-white text-sm font-medium rounded-lg hover:bg-[#828FFF] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            업무 추가
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#08090A]">
                <th className="text-left px-4 py-3 font-semibold text-[#8A8F98]">업무명</th>
                <th className="text-left px-4 py-3 font-semibold text-[#8A8F98]">담당자</th>
                <th className="text-center px-4 py-3 font-semibold text-[#8A8F98]">투입시간</th>
                <th className="text-center px-4 py-3 font-semibold text-[#8A8F98]">예상시간</th>
                <th className="text-center px-4 py-3 font-semibold text-[#8A8F98]">진행률</th>
                <th className="text-center px-4 py-3 font-semibold text-[#8A8F98]">상태</th>
                <th className="text-center px-4 py-3 font-semibold text-[#8A8F98]">관리</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-[#62666D]">등록된 업무가 없습니다.</td>
                </tr>
              )}
              {tasks.map(t => (
                <tr key={t.id} className="border-t border-[#23252A] hover:bg-[#141516]/5/60 transition-colors">
                  <td className="px-4 py-3 font-medium text-[#F7F8F8]">{t.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-[#5E6AD2]/15 text-[#7070FF] flex items-center justify-center text-[10px] font-bold shrink-0">
                        {getAssigneeName(t.assigneeId)[0]}
                      </span>
                      <span className="text-[#D0D6E0]">{getAssigneeName(t.assigneeId)}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-[#8A8F98] font-mono">{t.inputHours}h</td>
                  <td className="px-4 py-3 text-center text-[#8A8F98] font-mono">{t.estimatedHours}h</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-center">
                      <div className="w-20 h-2 bg-[#232326] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            t.progress >= 100
                              ? 'bg-[#27A644]'
                              : t.progress >= 50
                                ? 'bg-[#5E6AD2]'
                                : 'bg-[#F0BF00]/100'
                          }`}
                          style={{ width: `${Math.min(t.progress, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-[#8A8F98] w-8 text-right">{t.progress}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${TASK_STATUS_COLORS[t.status]}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => {
                        if (confirm(`"${t.name}" 업무를 삭제하시겠습니까?`)) onDelete(t.id);
                      }}
                      className="p-1.5 rounded-lg text-[#62666D] hover:text-[#EB5757] hover:bg-[#EB5757]/10 transition-colors"
                      title="삭제"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-[#23252A] bg-[#08090A]/50 text-xs text-[#8A8F98] flex items-center gap-4">
          <span>총 <span className="font-semibold text-[#D0D6E0]">{tasks.length}</span>건</span>
          <span>진행중 <span className="font-semibold text-[#7070FF]">{tasks.filter(t => t.status === '진행중').length}</span></span>
          <span>완료 <span className="font-semibold text-[#27A644]">{tasks.filter(t => t.status === '완료').length}</span></span>
          <span>대기 <span className="font-semibold text-[#8A8F98]">{tasks.filter(t => t.status === '대기').length}</span></span>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bar Chart: 담당자별 주간 투입시간 */}
        <div className="lg:col-span-2 bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
          <h3 className="text-base font-bold text-[#F7F8F8] mb-4">담당자별 주간 투입시간</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1C1C1F" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: '#8A8F98' }}
                  axisLine={{ stroke: '#23252A' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#8A8F98' }}
                  axisLine={{ stroke: '#23252A' }}
                  tickLine={false}
                  unit="h"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1C1C1F',
                    border: '1px solid #34343A',
                    borderRadius: '12px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    fontSize: '13px',
                  }}
                  formatter={(value: number, name: string) => [`${value}h`, name]}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '기준 40h', position: 'right', fontSize: 11, fill: '#ef4444' }} />
                <Bar dataKey="투입시간" fill="#6366f1" radius={[6, 6, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie Chart: 업무 상태 분포 */}
        <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
          <h3 className="text-base font-bold text-[#F7F8F8] mb-4">업무 상태 분포</h3>
          <div className="h-80 flex flex-col items-center justify-center">
            <ResponsiveContainer width="100%" height="75%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1C1C1F',
                    border: '1px solid #34343A',
                    borderRadius: '12px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    fontSize: '13px',
                  }}
                  formatter={(value: number, name: string) => [`${value}건`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-3 mt-2">
              {pieData.map((d, idx) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs text-[#8A8F98]">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                  />
                  {d.name} ({d.value})
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Utilization Pie Chart */}
      <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
        <h3 className="text-base font-bold text-[#F7F8F8] mb-4">담당자별 공수 활용률</h3>
        <UtilizationChart tasks={tasks} staffList={staffList} />
      </div>
    </div>
  );
}

// ===========================================================================
// Utilization Chart (per assignee)
// ===========================================================================
function UtilizationChart({ tasks, staffList }: { tasks: Task[]; staffList: Staff[] }) {
  const data = useMemo(() => {
    const map = new Map<string, { input: number; estimated: number }>();
    tasks.forEach(t => {
      const prev = map.get(t.assigneeId) || { input: 0, estimated: 0 };
      map.set(t.assigneeId, {
        input: prev.input + t.inputHours,
        estimated: prev.estimated + t.estimatedHours,
      });
    });
    return staffList
      .filter(s => map.has(s.id))
      .map(s => {
        const d = map.get(s.id)!;
        const rate = d.estimated > 0 ? Math.round((d.input / d.estimated) * 100) : 0;
        return { name: s.name, value: rate };
      });
  }, [tasks, staffList]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {data.map(d => (
        <div key={d.name} className="flex flex-col items-center gap-2 p-3 rounded-xl bg-[#08090A] border border-[#23252A]">
          <div className="relative w-16 h-16">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18" cy="18" r="14"
                fill="none"
                stroke="#1C1C1F"
                strokeWidth="3"
              />
              <circle
                cx="18" cy="18" r="14"
                fill="none"
                stroke={d.value >= 80 ? '#10b981' : d.value >= 50 ? '#6366f1' : '#f59e0b'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(d.value / 100) * 87.96} 87.96`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-[#D0D6E0]">{d.value}%</span>
            </div>
          </div>
          <span className="text-xs font-medium text-[#8A8F98]">{d.name}</span>
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// Task Modal
// ===========================================================================
function TaskModal({ staffList, onSave, onClose }: {
  staffList: Staff[];
  onSave: (t: Task) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Task>({
    id: `t${Date.now()}`,
    name: '',
    assigneeId: staffList[0]?.id || '',
    inputHours: 0,
    estimatedHours: 0,
    progress: 0,
    status: '대기',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-[#0F1011] rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#23252A] flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#F7F8F8]">업무 추가</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#141516]/5 text-[#62666D] hover:text-[#D0D6E0] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Task Name */}
          <div>
            <label className="block text-sm font-medium text-[#D0D6E0] mb-1">업무명 *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="업무 이름을 입력하세요"
              required
            />
          </div>
          {/* Assignee */}
          <div>
            <label className="block text-sm font-medium text-[#D0D6E0] mb-1">담당자</label>
            <select
              value={form.assigneeId}
              onChange={e => setForm(p => ({ ...p, assigneeId: e.target.value }))}
              className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.department})</option>
              ))}
            </select>
          </div>
          {/* Hours */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#D0D6E0] mb-1">투입시간 (h)</label>
              <input
                type="number"
                min={0}
                value={form.inputHours}
                onChange={e => setForm(p => ({ ...p, inputHours: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#D0D6E0] mb-1">예상시간 (h)</label>
              <input
                type="number"
                min={0}
                value={form.estimatedHours}
                onChange={e => setForm(p => ({ ...p, estimatedHours: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          {/* Progress */}
          <div>
            <label className="block text-sm font-medium text-[#D0D6E0] mb-1">
              진행률: <span className="text-[#7070FF] font-bold">{form.progress}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={form.progress}
              onChange={e => setForm(p => ({ ...p, progress: Number(e.target.value) }))}
              className="w-full h-2 bg-[#232326] rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-[#62666D] mt-1">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-[#D0D6E0] mb-1">상태</label>
            <div className="flex gap-2">
              {TASK_STATUSES.map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, status: st }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    form.status === st
                      ? `${TASK_STATUS_COLORS[st]} border-current`
                      : 'bg-[#0F1011] text-[#8A8F98] border-[#23252A] hover:bg-[#141516]/5'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[#8A8F98] bg-[#141516] rounded-lg hover:bg-[#141516]/7 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-[#5E6AD2] rounded-lg hover:bg-[#828FFF] transition-colors"
            >
              추가
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
