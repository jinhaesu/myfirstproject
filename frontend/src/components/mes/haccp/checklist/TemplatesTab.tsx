'use client';

// 템플릿 탭 — 목록(카드/표) + 신규/편집/복제/삭제.
import { useEffect, useState, useCallback } from 'react';
import { mesGet, mesDelete, ChecklistTemplate } from '@/lib/mes/api';
import { C, Pill, ConfirmButton, EmptyState, useToast } from '@/lib/mes/ui';
import TemplateModal from './TemplateModal';

const cycleLabel: Record<string, string> = { daily: '매일', weekly: '주간', monthly: '월간', asneeded: '수시' };

export default function TemplatesTab() {
  const { toast, show, node: toastNode } = useToast();
  const [items, setItems] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; template: ChecklistTemplate | null; dup: ChecklistTemplate | null }>({ open: false, template: null, dup: null });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await mesGet<{ items: ChecklistTemplate[] }>('/templates', { items: [] });
    setItems(r.items || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (id: number) => {
    const r = await mesDelete(`/templates/${id}`);
    if (!r.ok) { show(r.error || '삭제 실패', 'danger'); return; }
    show('삭제되었습니다', 'info');
    load();
  };

  return (
    <div className="space-y-4">
      {toastNode}
      <div className="flex justify-end">
        <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => setModal({ open: true, template: null, dup: null })}>+ 새 템플릿</button>
      </div>

      {loading ? (
        <div className="py-14 text-center text-text-tertiary text-sm">불러오는 중…</div>
      ) : items.length === 0 ? (
        <EmptyState title="등록된 템플릿이 없습니다" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={C.th}>코드</th>
                <th className={C.th}>이름</th>
                <th className={C.th}>카테고리</th>
                <th className={C.th}>주기</th>
                <th className={C.th}>항목수</th>
                <th className={C.th}>상태</th>
                <th className={C.th} />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="hover:bg-bg-inset/50">
                  <td className={C.td}>{t.code}</td>
                  <td className={C.td}>{t.name}</td>
                  <td className={C.td}>{t.category}</td>
                  <td className={C.td}>{cycleLabel[t.cycle] || t.cycle}</td>
                  <td className={C.td}>{t.items?.length ?? 0}</td>
                  <td className={C.td}><Pill tone={t.is_active ? 'success' : 'muted'}>{t.is_active ? '활성' : '비활성'}</Pill></td>
                  <td className={C.td}>
                    <div className="flex gap-1.5">
                      <button className={`${C.btn} ${C.btnGhost} px-2.5 py-1`} onClick={() => setModal({ open: true, template: t, dup: null })}>편집</button>
                      <button className={`${C.btn} ${C.btnGhost} px-2.5 py-1`} onClick={() => setModal({ open: true, template: null, dup: t })}>복제</button>
                      <ConfirmButton className={`${C.btn} ${C.btnDanger} px-2.5 py-1`} onConfirm={() => remove(t.id)}>삭제</ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TemplateModal open={modal.open} onClose={() => setModal({ open: false, template: null, dup: null })} template={modal.template} duplicateFrom={modal.dup} onSaved={load} />
    </div>
  );
}
