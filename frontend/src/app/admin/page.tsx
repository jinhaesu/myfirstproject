'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

const getAuthHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
};

interface Gate { key: string; label: string; is_set: boolean; updated_by: string | null; updated_at: string | null; }
interface MenuDef { key: string; label: string; }
interface UserRow { email: string; name: string; department: string | null; is_owner: boolean; in_directory: boolean; last_login: string | null; login_count: number; menus: string[]; custom: boolean; }

export default function AdminPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [gates, setGates] = useState<Gate[]>([]);
  const [pw, setPw] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [allMenus, setAllMenus] = useState<MenuDef[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [profileDraft, setProfileDraft] = useState<Record<string, { name: string; department: string }>>({});
  const [permMsg, setPermMsg] = useState('');
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);

  const load = useCallback(async () => {
    const w = await fetch('/api/admin/whoami', { headers: getAuthHeaders() }).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!w) return;
    setIsOwner(w.is_owner);
    if (w.is_owner) {
      const s = await fetch('/api/admin/security', { headers: getAuthHeaders() }).then((r) => r.ok ? r.json() : { gates: [] });
      setGates(s.gates || []); setOwnerEmail(s.owner_email || '');
      const u = await fetch('/api/admin/users', { headers: getAuthHeaders() }).then((r) => r.ok ? r.json() : { users: [], all_menus: [] });
      setAllMenus(u.all_menus || []); setUsers(u.users || []);
      const d: Record<string, string[]> = {};
      const pf: Record<string, { name: string; department: string }> = {};
      (u.users || []).forEach((row: UserRow) => { d[row.email] = row.menus; pf[row.email] = { name: row.name || '', department: row.department || '' }; });
      setDraft(d); setProfileDraft(pf);
    }
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  const toggleMenu = (email: string, key: string) => {
    setDraft((prev) => {
      const cur = new Set(prev[email] || []);
      if (cur.has(key)) cur.delete(key); else cur.add(key);
      return { ...prev, [email]: Array.from(cur) };
    });
  };
  const setProfile = (email: string, field: 'name' | 'department', v: string) => {
    setProfileDraft((prev) => ({ ...prev, [email]: { ...(prev[email] || { name: '', department: '' }), [field]: v } }));
  };
  const saveRow = async (email: string) => {
    const pf = profileDraft[email] || { name: '', department: '' };
    await fetch('/api/admin/users/profile', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ email, name: pf.name, department: pf.department }) });
    const r = await fetch('/api/admin/users/permissions', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ email, menu_keys: draft[email] || [] }),
    });
    if (r.ok) { setPermMsg(`${email} 저장됨`); load(); }
    else { const d = await r.json().catch(() => ({})); setPermMsg('오류: ' + (d.detail || '')); }
    setTimeout(() => setPermMsg(''), 3000);
  };
  const addEmail = async () => {
    const em = newEmail.trim();
    if (!em || !em.includes('@')) { setPermMsg('올바른 이메일을 입력하세요'); return; }
    await fetch('/api/admin/users/profile', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ email: em }) });
    setNewEmail(''); load();
  };

  const savePw = async (key: string) => {
    if (!(pw[key] || '').trim()) { setMsg('암호를 입력하세요'); return; }
    const r = await fetch('/api/admin/security/gate-password', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ key, password: pw[key] }),
    });
    if (r.ok) { setMsg('저장되었습니다'); setPw((p) => ({ ...p, [key]: '' })); load(); }
    else { const d = await r.json().catch(() => ({})); setMsg('오류: ' + (d.detail || '')); }
  };

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[900px] mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-text-primary mb-1">관리자</h1>
        <p className="text-sm text-text-tertiary mb-6">보안 게이트 암호 등 전역 설정을 관리합니다. (대표 전용)</p>

        {isOwner === false && (
          <div className="bg-bg-1 border border-danger/40 rounded-xl p-6 text-center">
            <div className="text-2xl mb-2">🚫</div>
            <div className="text-text-primary font-semibold">접근 권한이 없습니다</div>
            <div className="text-xs text-text-tertiary mt-1">이 페이지는 대표 계정({ownerEmail || 'lion9080@joinandjoin.com'})만 사용할 수 있습니다.</div>
          </div>
        )}

        {isOwner && (
          <div className="space-y-4">
            <div className="bg-bg-1 border border-border-primary rounded-xl p-5">
              <div className="text-sm font-semibold text-text-primary mb-3">보안 게이트 암호</div>
              <div className="space-y-4">
                {gates.map((g) => (
                  <div key={g.key} className="border-b border-bg-inset pb-4 last:border-0">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="text-sm text-text-primary">{g.label}</div>
                        <div className="text-xs text-text-quaternary">
                          {g.is_set ? `설정됨 · ${g.updated_by || ''} · ${g.updated_at ? new Date(g.updated_at).toLocaleString('ko-KR') : ''}` : '미설정 (현재 대표만 진입 가능)'}
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-md ${g.is_set ? 'bg-success/15 text-success-light' : 'bg-warning/15 text-warning'}`}>{g.is_set ? '설정됨' : '미설정'}</span>
                    </div>
                    <div className="flex gap-2">
                      <input type="password" value={pw[g.key] || ''} onChange={(e) => setPw((p) => ({ ...p, [g.key]: e.target.value }))}
                        placeholder={g.is_set ? '새 암호로 변경' : '암호 설정'}
                        className="flex-1 bg-bg-0 border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary" />
                      <button onClick={() => savePw(g.key)} className="px-3 py-2 rounded-lg text-sm font-semibold bg-brand hover:bg-brand-hover text-white">{g.is_set ? '변경' : '설정'}</button>
                    </div>
                  </div>
                ))}
              </div>
              {msg && <div className="text-xs text-accent mt-3">{msg}</div>}
            </div>
            <p className="text-xs text-text-quaternary">암호는 서버에 해시로 저장됩니다. 게이트가 미설정이면 대표 계정만 해당 화면(BOM 등)에 진입할 수 있습니다.</p>

            {/* 직원별 메뉴 조회 권한 */}
            <div className="bg-bg-1 border border-border-primary rounded-xl p-5">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-semibold text-text-primary">직원별 메뉴 조회 권한</div>
                {permMsg && <div className="text-xs text-accent">{permMsg}</div>}
              </div>
              <p className="text-xs text-text-quaternary mb-3">로그인한 이메일별로 이름·부서·볼 수 있는 메뉴를 지정합니다. 기본값은 <b className="text-text-tertiary">영업부 매출 관리·분석</b>만 노출됩니다. 대표 계정은 항상 전체 접근입니다.</p>
              <div className="flex items-center gap-2 mb-4">
                <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="이메일 직접 추가 (@joinandjoin.com)" className="flex-1 bg-bg-0 border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary" />
                <button onClick={addEmail} className="px-3 py-2 rounded-lg text-xs font-semibold bg-bg-inset border border-border-primary text-text-secondary hover:bg-border-primary">+ 추가</button>
              </div>
              <div className="space-y-3">
                {users.map((row) => (
                  <div key={row.email} className={`border border-bg-inset rounded-lg p-3 ${row.is_owner ? 'opacity-80' : ''}`}>
                    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input value={profileDraft[row.email]?.name ?? ''} onChange={(e) => setProfile(row.email, 'name', e.target.value)} disabled={row.is_owner} placeholder="이름" className="w-24 bg-bg-0 border border-border-primary rounded px-2 py-1 text-sm text-text-primary disabled:opacity-60" />
                        <input value={profileDraft[row.email]?.department ?? ''} onChange={(e) => setProfile(row.email, 'department', e.target.value)} disabled={row.is_owner} placeholder="부서" className="w-24 bg-bg-0 border border-border-primary rounded px-2 py-1 text-sm text-text-primary disabled:opacity-60" />
                        <span className="text-xs text-text-quaternary">{row.email}</span>
                        {row.is_owner && <span className="text-[10px] text-warning">대표</span>}
                        {!row.in_directory && <span className="text-[10px] text-text-quaternary">미로그인</span>}
                      </div>
                      {!row.is_owner && (
                        <button onClick={() => saveRow(row.email)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white">저장</button>
                      )}
                    </div>
                    <div className="text-[11px] text-text-quaternary mb-2">
                      {row.last_login ? `최근 로그인 ${new Date(row.last_login).toLocaleString('ko-KR')} · ${row.login_count}회` : '로그인 기록 없음'}
                      {!row.is_owner && !row.custom && ' · 기본권한(영업부만)'}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {allMenus.map((m) => {
                        const on = row.is_owner || (draft[row.email] || []).includes(m.key);
                        const isSales = m.key === 'sales';
                        return (
                          <button
                            key={m.key}
                            disabled={row.is_owner}
                            onClick={() => toggleMenu(row.email, m.key)}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${on ? 'bg-brand/15 text-accent border-brand/40' : 'bg-bg-0 text-text-quaternary border-border-primary hover:text-text-tertiary'} ${row.is_owner ? 'cursor-default' : ''}`}
                            title={isSales ? '기본 노출 메뉴' : ''}
                          >
                            {on ? '● ' : '○ '}{m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {users.length === 0 && <div className="text-xs text-text-quaternary text-center py-4">로그인 이력이 없습니다.</div>}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
