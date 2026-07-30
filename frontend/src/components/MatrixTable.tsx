'use client';

// 월별 매트릭스 테이블 + 엑셀(CSV) 다운로드 공용 컴포넌트.
// rows: [{ name, category?, values:number[], total:number }]

export interface MatrixRow {
  name: string;
  category?: string;
  values: number[];
  total: number;
}

interface MatrixData {
  months: string[];
  rows: MatrixRow[];
  col_totals: number[];
  grand_total: number;
}

const fmt = (n: number) => Number(n || 0).toLocaleString('ko-KR');

export function downloadMatrixCSV(
  filename: string,
  firstCol: string,
  data: MatrixData,
  opts?: { category?: boolean },
) {
  const BOM = '﻿';
  const head = [opts?.category ? '품목류' : null, firstCol, ...data.months, '합계'].filter(Boolean) as string[];
  const lines = [head.map((h) => `"${h}"`).join(',')];
  data.rows.forEach((r) => {
    const cells = [
      ...(opts?.category ? [r.category || ''] : []),
      r.name,
      ...r.values.map((v) => String(v)),
      String(r.total),
    ];
    lines.push(cells.map((c) => `"${c}"`).join(','));
  });
  const totalCells = [
    ...(opts?.category ? [''] : []),
    '총 합계',
    ...data.col_totals.map((v) => String(v)),
    String(data.grand_total),
  ];
  lines.push(totalCells.map((c) => `"${c}"`).join(','));
  const csv = BOM + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function MatrixTable({
  title, subtitle, firstCol, data, showCategory,
}: {
  title: string;
  subtitle?: string;
  firstCol: string;
  data: MatrixData | null;
  showCategory?: boolean;
}) {
  const th = 'text-xs font-semibold text-[#8A8F98] px-3 py-2 border-b border-[#23252A] whitespace-nowrap';
  const td = 'px-3 py-1.5 text-sm text-[#D0D6E0] border-b border-[#1A1B1E] whitespace-nowrap tabular-nums';
  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-[#F7F8F8]">{title}</div>
          {subtitle && <p className="text-xs text-[#62666D] mt-0.5">{subtitle}</p>}
        </div>
        <button
          onClick={() => data && downloadMatrixCSV(title.replace(/\s+/g, '_'), firstCol, data, { category: showCategory })}
          disabled={!data || data.rows.length === 0}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#1A1B1E] border border-[#23252A] text-[#D0D6E0] hover:bg-[#23252A] disabled:opacity-40"
        >
          ⬇ 엑셀 다운로드
        </button>
      </div>
      <div className="overflow-x-auto max-h-[460px] overflow-y-auto mt-2">
        <table className="w-full">
          <thead className="sticky top-0 bg-[#0F1011] z-10">
            <tr>
              {showCategory && <th className={`${th} text-left`}>품목류</th>}
              <th className={`${th} text-left`}>{firstCol}</th>
              {data?.months.map((m) => <th key={m} className={`${th} text-right`}>{m}</th>)}
              <th className={`${th} text-right`}>합계</th>
            </tr>
          </thead>
          <tbody>
            {!data || data.rows.length === 0 ? (
              <tr><td colSpan={(data?.months.length || 0) + (showCategory ? 3 : 2)} className="px-3 py-8 text-center text-sm text-[#62666D]">데이터 없음</td></tr>
            ) : (
              <>
                {data.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-white/5">
                    {showCategory && <td className={`${td} text-left text-[#8A8F98]`}>{r.category}</td>}
                    <td className={`${td} text-left text-[#F7F8F8]`}>{r.name}</td>
                    {r.values.map((v, j) => <td key={j} className={`${td} text-right ${v < 0 ? 'text-[#EB5757]' : ''}`}>{v ? fmt(v) : '-'}</td>)}
                    <td className={`${td} text-right font-semibold text-[#F0BF00]`}>{fmt(r.total)}</td>
                  </tr>
                ))}
                <tr className="bg-[#08090A] sticky bottom-0">
                  {showCategory && <td className={`${td} border-t border-[#23252A]`}></td>}
                  <td className={`${td} text-left font-bold text-[#F7F8F8] border-t border-[#23252A]`}>총 합계</td>
                  {data.col_totals.map((v, j) => <td key={j} className={`${td} text-right font-semibold text-[#D0D6E0] border-t border-[#23252A] ${v < 0 ? 'text-[#EB5757]' : ''}`}>{fmt(v)}</td>)}
                  <td className={`${td} text-right font-bold text-[#F0BF00] border-t border-[#23252A]`}>{fmt(data.grand_total)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
