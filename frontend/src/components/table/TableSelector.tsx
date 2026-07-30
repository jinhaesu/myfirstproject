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
    <div className="bg-bg-1 rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-3">테이블 선택</h2>

      {/* 안내 메시지 */}
      <div className="mb-4 p-3 bg-brand/10 border border-brand/30 rounded-lg">
        <p className="text-xs text-accent leading-relaxed">
          채팅으로 질문을 할때 구체적인 스키마를 확인해서 정확한 스키마의 단어를 써서 질문하세요. 한글로 질문해도 됩니다.
        </p>
      </div>

      {isLoading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : tables ? (
        <>
          <select
            value={selectedTable}
            onChange={(e) => onSelectTable(e.target.value)}
            className="w-full p-2 border border-border-primary rounded-md focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {tables.tables.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>

          {schema && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-text-secondary mb-2">스키마</h3>
              <div className="text-xs bg-bg-0 rounded p-2 max-h-60 overflow-y-auto">
                {schema.columns.map((col) => (
                  <div key={col.name} className="py-1 border-b border-border-primary last:border-0">
                    <span className="font-medium text-link">{col.name}</span>
                    <span className="text-text-tertiary ml-2">{col.type}</span>
                    {col.description && (
                      <p className="text-text-quaternary text-xs mt-0.5">{col.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-danger">테이블을 불러올 수 없습니다</div>
      )}
    </div>
  );
}
