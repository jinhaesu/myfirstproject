'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { TableInfo, TableSchema } from '@/types';

export function useTables() {
  const [tables, setTables] = useState<TableInfo | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 테이블 목록 로드
  const loadTables = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getTables();
      setTables(data);
      if (data.tables.length > 0 && !selectedTable) {
        setSelectedTable(data.tables[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '테이블 목록을 불러올 수 없습니다');
    } finally {
      setIsLoading(false);
    }
  }, [selectedTable]);

  // 테이블 스키마 로드
  const loadSchema = useCallback(async (tableId: string) => {
    if (!tableId) return;
    setIsLoading(true);
    try {
      const data = await api.getTableSchema(tableId);
      setSchema(data);
    } catch (err) {
      console.error('Failed to load schema:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 초기 로드
  useEffect(() => {
    loadTables();
  }, [loadTables]);

  // 선택된 테이블 변경 시 스키마 로드
  useEffect(() => {
    if (selectedTable) {
      loadSchema(selectedTable);
    }
  }, [selectedTable, loadSchema]);

  return {
    tables,
    selectedTable,
    setSelectedTable,
    schema,
    isLoading,
    error,
    refresh: loadTables,
  };
}
