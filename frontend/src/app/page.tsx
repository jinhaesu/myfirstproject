'use client';

import { ChatContainer } from '@/components/chat/ChatContainer';
import { TableSelector } from '@/components/table/TableSelector';
import { useTables } from '@/hooks/useTables';

export default function Home() {
  const {
    tables,
    selectedTable,
    setSelectedTable,
    schema,
    isLoading,
    error,
  } = useTables();

  return (
    <main className="min-h-screen bg-gray-100">
      {/* 헤더 */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">
            BigQuery Chat Analytics
          </h1>
          <p className="text-gray-500">자연어로 데이터를 분석하세요</p>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 사이드바 - 테이블 선택 */}
          <div className="lg:col-span-1">
            <TableSelector
              tables={tables}
              selectedTable={selectedTable}
              onSelectTable={setSelectedTable}
              schema={schema}
              isLoading={isLoading}
            />
          </div>

          {/* 메인 - 채팅 영역 */}
          <div className="lg:col-span-3 h-[calc(100vh-200px)]">
            <ChatContainer
              tableId={selectedTable}
              datasetId={tables?.dataset_id}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
