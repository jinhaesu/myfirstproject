'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  section?: string; // 섹션 헤더 (이 아이템 위에 표시)
}

interface NavGroup {
  label: string;
  icon: string;
  items: NavItem[];
  pathPrefix: string[];
}

const navGroups: NavGroup[] = [
  {
    label: '영업부 매출 관리·분석',
    icon: 'sales',
    pathPrefix: ['/', '/channels', '/settlement'],
    items: [
      { href: '/', label: 'AI 매출 분석', icon: 'chat' },
      { href: '/channels', label: '채널별 매출 취합', icon: 'channel' },
      { href: '/settlement', label: '월별 결산', icon: 'settlement' },
      { href: '/contribution-margin', label: '공헌이익 시뮬레이션', icon: 'simulation' },
    ],
  },
  {
    label: 'SCM 관리',
    icon: 'scm',
    pathPrefix: ['/scm'],
    items: [
      { href: '/scm/products', label: '품목 관리', icon: 'products' },
      { href: '/scm/bom', label: 'BOM·원부재료', icon: 'products' },
    ],
  },
  {
    label: '물류·재고 관리',
    icon: 'inventory',
    pathPrefix: ['/inventory'],
    items: [
      { href: '/inventory', label: '재고 대시보드', icon: 'inventory' },
      { href: '/inventory/production', label: '생산 실적', icon: 'production' },
    ],
  },
  {
    label: '매핑 관리',
    icon: 'mapping',
    pathPrefix: ['/sabangnet/mapping'],
    items: [
      { href: '/sabangnet/mapping', label: '매핑 자동화', icon: 'mapping' },
    ],
  },
  {
    label: 'CS 관리',
    icon: 'voiceCs',
    pathPrefix: ['/sabangnet/cs', '/sabangnet/voice-cs'],
    items: [
      { href: '/sabangnet/cs', label: '게시판 CS 대응', icon: 'cs' },
      { href: '/sabangnet/voice-cs', label: '음성 CS 대응', icon: 'voiceCs' },
    ],
  },
];

const iconMap: Record<string, JSX.Element> = {
  sabangnet: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
    </svg>
  ),
  cs: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
    </svg>
  ),
  chat: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  target: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  channel: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  settlement: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  orders: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  workforce: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  production: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
  ),
  inventory: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  sales: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  products: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  results: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  mapping: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  ),
  productList: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  voiceCs: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  scm: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  simulation: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M7 14l4-4 4 4 6-6" />
    </svg>
  ),
};

export function Navigation() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isGroupActive = (group: NavGroup) => {
    if (pathname === '/' && group.pathPrefix.includes('/')) return true;
    return group.pathPrefix.some((p) => p !== '/' && pathname.startsWith(p));
  };

  return (
    <header className="bg-[#0F1011]/80 backdrop-blur-md shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border-b border-[#23252A] sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-4 py-2.5">
        <div className="flex items-center justify-between">
          {/* 로고 */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <div className="w-9 h-9 bg-gradient-to-br from-[#5E6AD2] to-[#5E6AD2] rounded-xl flex items-center justify-center shadow-[0px_7px_32px_rgba(0,0,0,0.35)]">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-[#5E6AD2] to-[#5E6AD2] bg-clip-text text-transparent hidden lg:block">
                Nuldam Analytics
              </h1>
            </Link>

            {/* 데스크톱 네비게이션 */}
            <nav className="hidden md:flex items-center gap-1" ref={dropdownRef}>
              {navGroups.map((group) => {
                const active = isGroupActive(group);
                const isOpen = openGroup === group.label;
                return (
                  <div key={group.label} className="relative">
                    <button
                      onClick={() => setOpenGroup(isOpen ? null : group.label)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                        active
                          ? 'bg-[#5E6AD2]/10 text-[#828FFF]'
                          : 'text-[#8A8F98] hover:bg-white/5/5 hover:text-[#F7F8F8]'
                      }`}
                    >
                      {iconMap[group.icon]}
                      <span>{group.label}</span>
                      <svg
                        className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* 드롭다운 */}
                    {isOpen && (
                      <div className="absolute top-full left-0 mt-1 w-56 bg-[#0F1011] rounded-xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] border border-[#23252A] py-2 z-50">
                        {group.items.map((item, idx) => {
                          const itemActive = pathname === item.href;
                          return (
                            <div key={item.href}>
                              {item.section && (
                                <>
                                  {idx > 0 && <div className="border-t border-[#23252A] my-1" />}
                                  <p className="px-4 pt-2 pb-1 text-xs font-bold text-[#62666D] uppercase tracking-wider">
                                    {item.section}
                                  </p>
                                </>
                              )}
                              <Link
                                href={item.href}
                                onClick={() => setOpenGroup(null)}
                                className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                                  itemActive
                                    ? 'bg-[#5E6AD2]/10 text-[#828FFF] font-semibold'
                                    : 'text-[#8A8F98] hover:bg-white/5/5 hover:text-[#F7F8F8]'
                                }`}
                              >
                                {iconMap[item.icon]}
                                {item.label}
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>

          {/* 사용자 정보 + 모바일 버거 */}
          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden sm:flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 bg-gradient-to-br from-[#27A644] to-[#00B8CC] rounded-full flex items-center justify-center text-white font-semibold text-xs">
                    {user.name.charAt(0)}
                  </div>
                  <span className="text-sm text-[#D0D6E0] font-medium">{user.name}</span>
                </div>
                <button
                  onClick={logout}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-sm text-[#8A8F98] hover:text-[#EB5757] hover:bg-[#EB5757]/10 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  로그아웃
                </button>
              </div>
            )}

            {/* 모바일 햄버거 */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 text-[#8A8F98] hover:bg-white/5/5 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* 모바일 메뉴 */}
        {mobileOpen && (
          <div className="md:hidden mt-3 pt-3 border-t border-[#23252A] pb-2">
            {navGroups.map((group) => (
              <div key={group.label} className="mb-3">
                <p className="px-3 py-1 text-xs font-bold text-[#62666D] uppercase tracking-wider">
                  {group.label}
                </p>
                {group.items.map((item, idx) => {
                  const itemActive = pathname === item.href;
                  return (
                    <div key={item.href}>
                      {item.section && (
                        <>
                          {idx > 0 && <div className="border-t border-[#23252A] my-1 mx-3" />}
                          <p className="px-3 pt-2 pb-1 text-xs font-bold text-[#62666D] uppercase tracking-wider">
                            {item.section}
                          </p>
                        </>
                      )}
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          itemActive
                            ? 'bg-[#5E6AD2]/10 text-[#828FFF] font-semibold'
                            : 'text-[#8A8F98] hover:bg-white/5/5'
                        }`}
                      >
                        {iconMap[item.icon]}
                        {item.label}
                      </Link>
                    </div>
                  );
                })}
              </div>
            ))}
            {user && (
              <div className="sm:hidden pt-2 mt-2 border-t border-[#23252A] flex items-center justify-between px-3">
                <span className="text-sm text-[#D0D6E0] font-medium">{user.name}</span>
                <button onClick={logout} className="text-sm text-[#EB5757] hover:text-[#EB5757]">로그아웃</button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
