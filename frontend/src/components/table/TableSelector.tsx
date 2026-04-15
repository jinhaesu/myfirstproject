'use client';

import type { TableInfo, TableSchema } from '@/types';

interface TableSelectorProps {
  tables: TableInfo | null;
  selectedTable: string;
  onSelectTable: (tableId: string) => void;
  schema: TableSchema | null;
  isLoading: boolean;
}

export function TableSelector({
  tables,
  selectedTable,
  onSelectTable,
  schema,
  isLoading,
}: TableSelectorProps) {
  return (
    <div className="bg-[#0F1011] rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-3">테이블 선택</h2>

      {/* 안내 메시지 */}
      <div className="mb-4 p-3 bg-[#5E6AD2]/10 border border-[#5E6AD2]/30 rounded-lg">
        <p className="text-xs text-[#828FFF] leading-relaxed">
          채팅으로 질문을 할때 구체적인 스키마를 확인해서 정확한 스키마의 단어를 써서 질문하세요. 한글로 질문해도 됩니다.
        </p>
      </div>

      {isLoading ? (
        <div className="text-[#8A8F98]">로딩 중...</div>
      ) : tables ? (
        <>
          <select
            value={selectedTable}
            onChange={(e) => onSelectTable(e.target.value)}
            className="w-full p-2 border border-[#23252A] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {tables.tables.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>

          {schema && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-[#D0D6E0] mb-2">스키마</h3>
              <div className="text-xs bg-[#08090A] rounded p-2 max-h-60 overflow-y-auto">
                {schema.columns.map((col) => (
                  <div key={col.name} className="py-1 border-b border-[#23252A] last:border-0">
                    <span className="font-medium text-[#7070FF]">{col.name}</span>
                    <span className="text-[#8A8F98] ml-2">{col.type}</span>
                    {col.description && (
                      <p className="text-[#62666D] text-xs mt-0.5">{col.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-[#EB5757]">테이블을 불러올 수 없습니다</div>
      )}
    </div>
  );
}
