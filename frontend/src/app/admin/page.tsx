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

export default function AdminPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [gates, setGates] = useState<Gate[]>([]);
  const [pw, setPw] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);

  const load = useCallback(async () => {
    const w = await fetch('/api/admin/whoami', { headers: getAuthHeaders() }).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!w) return;
    setIsOwner(w.is_owner);
    if (w.is_owner) {
      const s = await fetch('/api/admin/security', { headers: getAuthHeaders() }).then((r) => r.ok ? r.json() : { gates: [] });
      setGates(s.gates || []); setOwnerEmail(s.owner_email || '');
    }
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  const savePw = async (key: string) => {
    if (!(pw[key] || '').trim()) { setMsg('암호를 입력하세요'); return; }
    const r = await fetch('/api/admin/security/gate-password', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ key, password: pw[key] }),
    });
    if (r.ok) { setMsg('저장되었습니다'); setPw((p) => ({ ...p, [key]: '' })); load(); }
    else { const d = await r.json().catch(() => ({})); setMsg('오류: ' + (d.detail || '')); }
  };

  if (isLoading || !user) return <div className="min-h-screen bg-[#08090A]" />;

  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />
      <main className="max-w-[900px] mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-[#F7F8F8] mb-1">관리자</h1>
        <p className="text-sm text-[#8A8F98] mb-6">보안 게이트 암호 등 전역 설정을 관리합니다. (대표 전용)</p>

        {isOwner === false && (
          <div className="bg-[#0F1011] border border-[#EB5757]/40 rounded-xl p-6 text-center">
            <div className="text-2xl mb-2">🚫</div>
            <div className="text-[#F7F8F8] font-semibold">접근 권한이 없습니다</div>
            <div className="text-xs text-[#8A8F98] mt-1">이 페이지는 대표 계정({ownerEmail || 'lion9080@joinandjoin.com'})만 사용할 수 있습니다.</div>
          </div>
        )}

        {isOwner && (
          <div className="space-y-4">
            <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-5">
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">보안 게이트 암호</div>
              <div className="space-y-4">
                {gates.map((g) => (
                  <div key={g.key} className="border-b border-[#1A1B1E] pb-4 last:border-0">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="text-sm text-[#F7F8F8]">{g.label}</div>
                        <div className="text-xs text-[#62666D]">
                          {g.is_set ? `설정됨 · ${g.updated_by || ''} · ${g.updated_at ? new Date(g.updated_at).toLocaleString('ko-KR') : ''}` : '미설정 (현재 대표만 진입 가능)'}
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-md ${g.is_set ? 'bg-[#27A644]/15 text-[#3FBE5B]' : 'bg-[#F0BF00]/15 text-[#F0BF00]'}`}>{g.is_set ? '설정됨' : '미설정'}</span>
                    </div>
                    <div className="flex gap-2">
                      <input type="password" value={pw[g.key] || ''} onChange={(e) => setPw((p) => ({ ...p, [g.key]: e.target.value }))}
                        placeholder={g.is_set ? '새 암호로 변경' : '암호 설정'}
                        className="flex-1 bg-[#08090A] border border-[#23252A] rounded-lg px-3 py-2 text-sm text-[#F7F8F8]" />
                      <button onClick={() => savePw(g.key)} className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#5E6AD2] hover:bg-[#4d58bd] text-white">{g.is_set ? '변경' : '설정'}</button>
                    </div>
                  </div>
                ))}
              </div>
              {msg && <div className="text-xs text-[#828FFF] mt-3">{msg}</div>}
            </div>
            <p className="text-xs text-[#62666D]">암호는 서버에 해시로 저장됩니다. 게이트가 미설정이면 대표 계정만 해당 화면(BOM 등)에 진입할 수 있습니다.</p>
          </div>
        )}
      </main>
    </div>
  );
}
