'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import NuldamSystemBar from '@/components/NuldamSystemBar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CalculatorIcon, CaretDownIcon, ChartBarIcon, ChartLineIcon, ChatIcon, ClipboardTextIcon, CloudIcon, FactoryIcon, HeadsetIcon, LinkIcon, MenuIcon, PackageIcon, PhoneIcon, PresentationChartIcon, ShieldCheckIcon, SignOutIcon, StackIcon, StorefrontIcon, TruckIcon, UsersIcon, XIcon } from '@/components/nd/icons';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  section?: string; // 섹션 헤더 (이 아이템 위에 표시)
}

interface NavGroup {
  key: string;
  label: string;
  icon: string;
  items: NavItem[];
  pathPrefix: string[];
  ownerOnly?: boolean;
}

const OWNER_EMAIL = 'lion9080@joinandjoin.com';

const navGroups: NavGroup[] = [
  {
    key: 'sales',
    label: '영업부 매출 관리·분석',
    icon: 'sales',
    pathPrefix: ['/', '/channels', '/settlement'],
    items: [
      { href: '/channels', label: '채널별 매출 취합', icon: 'channel' },
      { href: '/settlement', label: '월별 결산', icon: 'settlement' },
      { href: '/contribution-margin', label: '공헌이익 시뮬레이션', icon: 'simulation' },
    ],
  },
  {
    key: 'scm',
    label: 'SCM 관리',
    icon: 'scm',
    pathPrefix: ['/scm'],
    items: [
      { href: '/scm/products', label: '품목 관리', icon: 'products' },
      { href: '/scm/bom', label: 'BOM·원부재료', icon: 'products' },
    ],
  },
  {
    key: 'logistics',
    label: '작업 관리',
    icon: 'production',
    pathPrefix: ['/inventory/logistics', '/inventory/production'],
    items: [
      { href: '/inventory/logistics', label: '물류 작업 실적', icon: 'orders' },
      { href: '/inventory/production', label: '생산 작업 실적', icon: 'production' },
    ],
  },
  {
    key: 'inventory',
    label: '재고 관리',
    icon: 'inventory',
    pathPrefix: ['/inventory'],
    items: [
      { href: '/inventory', label: '재고 현황·실사', icon: 'inventory' },
    ],
  },
  {
    key: 'mapping',
    label: '매핑 관리',
    icon: 'mapping',
    pathPrefix: ['/inventory/mapping'],
    items: [
      { href: '/inventory/mapping', label: '품목 매핑 관계', icon: 'mapping' },
    ],
  },
  {
    key: 'purchase',
    label: '구매 관리',
    icon: 'orders',
    pathPrefix: ['/purchase'],
    items: [
      { href: '/purchase', label: '구매·발주 관리', icon: 'orders' },
    ],
  },
  {
    key: 'management',
    label: '경영관리',
    icon: 'target',
    pathPrefix: ['/management'],
    items: [
      { href: '/management', label: '경영 교차분석', icon: 'target' },
    ],
  },
  {
    key: 'admin',
    label: '관리',
    icon: 'admin',
    pathPrefix: ['/admin'],
    ownerOnly: true,
    items: [
      { href: '/admin', label: '보안·권한 관리', icon: 'admin' },
    ],
  },
];

const iconMap: Record<string, JSX.Element> = {
  sabangnet: <CloudIcon className="w-4 h-4" />,
  cs: <HeadsetIcon className="w-4 h-4" />,
  chat: <ChatIcon className="w-4 h-4" />,
  target: <PresentationChartIcon className="w-4 h-4" />,
  channel: <StorefrontIcon className="w-4 h-4" />,
  settlement: <CalculatorIcon className="w-4 h-4" />,
  orders: <ClipboardTextIcon className="w-4 h-4" />,
  workforce: <UsersIcon className="w-4 h-4" />,
  production: <FactoryIcon className="w-4 h-4" />,
  inventory: <PackageIcon className="w-4 h-4" />,
  sales: <ChartBarIcon className="w-4 h-4" />,
  products: <StackIcon className="w-4 h-4" />,
  results: <ChartLineIcon className="w-4 h-4" />,
  mapping: <LinkIcon className="w-4 h-4" />,
  productList: <PackageIcon className="w-4 h-4" />,
  voiceCs: <PhoneIcon className="w-4 h-4" />,
  scm: <TruckIcon className="w-4 h-4" />,
  simulation: <ChartLineIcon className="w-4 h-4" />,
  admin: <ShieldCheckIcon className="w-4 h-4" />,
};

export function Navigation() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const isOwner = (user?.email || '').toLowerCase() === OWNER_EMAIL;
  const [allowedMenus, setAllowedMenus] = useState<string[] | null>(null);

  // 이메일별 조회 권한 로드 (오너는 전체). 로딩 전엔 기본(sales)만 노출해 깜빡임 방지.
  useEffect(() => {
    if (!user) { setAllowedMenus(null); return; }
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    fetch('/api/admin/my-menus', { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAllowedMenus(d?.menus || ['sales']))
      .catch(() => setAllowedMenus(['sales']));
  }, [user]);

  const effectiveMenus = allowedMenus ?? ['sales'];
  const visibleGroups = navGroups.filter((g) => {
    if (g.ownerOnly) return isOwner;
    if (isOwner) return true;
    return effectiveMenus.includes(g.key);
  });
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

  // 가장 구체적인(긴) pathPrefix를 가진 그룹만 활성 — /inventory vs /inventory/logistics 중복 강조 방지
  const _matchLen = (group: NavGroup) =>
    Math.max(0, ...group.pathPrefix.filter((p) => p !== '/' && pathname.startsWith(p)).map((p) => p.length));
  const bestMatchLen = Math.max(0, ...visibleGroups.map(_matchLen));
  const isGroupActive = (group: NavGroup) => {
    if (pathname === '/') return group.pathPrefix.includes('/');
    const my = _matchLen(group);
    return my > 0 && my === bestMatchLen;
  };

  return (
    <>
    <NuldamSystemBar current="scm" />
    <header className="bg-bg-1 border-b border-border-primary sticky top-[40px] z-50">
      <div className="max-w-[1400px] mx-auto px-4 py-2.5">
        <div className="flex items-center justify-between">
          {/* 로고 */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons3d/scm.png" alt="" width={32} height={32} className="nd-icon3d w-8 h-8 shrink-0" />
              <span className="text-lg font-medium text-text-primary hidden lg:block">
                매출·SCM
              </span>
            </Link>

            {/* 데스크톱 네비게이션 */}
            <nav className="hidden md:flex items-center gap-1" ref={dropdownRef}>
              {visibleGroups.map((group) => {
                const active = isGroupActive(group);
                const isOpen = openGroup === group.label;
                return (
                  <div key={group.label} className="relative">
                    <button
                      onClick={() => setOpenGroup(isOpen ? null : group.label)}
                      className={`flex items-center gap-1 px-2 lg:px-2.5 py-2 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${
                        active
                          ? 'bg-brand/10 text-accent'
                          : 'text-text-tertiary hover:bg-bg-secondary hover:text-text-primary'
                      }`}
                    >
                      <span className="shrink-0">{iconMap[group.icon]}</span>
                      <span className="whitespace-nowrap">{group.label}</span>
                      <CaretDownIcon className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* 드롭다운 */}
                    {isOpen && (
                      <div className="absolute top-full left-0 mt-1 w-56 bg-bg-1 rounded-xl shadow-nd-f border border-border-secondary py-2 z-50">
                        {group.items.map((item, idx) => {
                          const itemActive = pathname === item.href;
                          return (
                            <div key={item.href}>
                              {item.section && (
                                <>
                                  {idx > 0 && <div className="border-t border-border-primary my-1" />}
                                  <p className="px-4 pt-2 pb-1 text-xs font-medium text-text-tertiary">
                                    {item.section}
                                  </p>
                                </>
                              )}
                              <Link
                                href={item.href}
                                onClick={() => setOpenGroup(null)}
                                className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                                  itemActive
                                    ? 'bg-brand/10 text-accent font-medium'
                                    : 'text-text-tertiary hover:bg-bg-secondary hover:text-text-primary'
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
            <ThemeToggle />
            {user && (
              <div className="hidden sm:flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 bg-bg-2 border border-border-primary rounded-full flex items-center justify-center text-text-secondary font-medium text-xs">
                    {user.name.charAt(0)}
                  </div>
                  <span className="text-sm text-text-secondary font-medium">{user.name}</span>
                </div>
                <button
                  onClick={logout}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-sm text-text-tertiary hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
                >
                  <SignOutIcon className="w-4 h-4" />
                  로그아웃
                </button>
              </div>
            )}

            {/* 모바일 햄버거 */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 text-text-tertiary hover:bg-bg-secondary rounded-lg"
            >
              {mobileOpen ? <XIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* 모바일 메뉴 */}
        {mobileOpen && (
          <div className="md:hidden mt-3 pt-3 border-t border-border-primary pb-2">
            {visibleGroups.map((group) => (
              <div key={group.label} className="mb-3">
                <p className="px-3 py-1 text-xs font-medium text-text-tertiary">
                  {group.label}
                </p>
                {group.items.map((item, idx) => {
                  const itemActive = pathname === item.href;
                  return (
                    <div key={item.href}>
                      {item.section && (
                        <>
                          {idx > 0 && <div className="border-t border-border-primary my-1 mx-3" />}
                          <p className="px-3 pt-2 pb-1 text-xs font-medium text-text-tertiary">
                            {item.section}
                          </p>
                        </>
                      )}
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          itemActive
                            ? 'bg-brand/10 text-accent font-medium'
                            : 'text-text-tertiary hover:bg-bg-secondary'
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
              <div className="sm:hidden pt-2 mt-2 border-t border-border-primary flex items-center justify-between px-3">
                <span className="text-sm text-text-secondary font-medium">{user.name}</span>
                <button onClick={logout} className="text-sm text-danger hover:text-danger">로그아웃</button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
    </>
  );
}
