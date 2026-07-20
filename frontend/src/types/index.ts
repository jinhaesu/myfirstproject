export interface TableInfo {
  tables: string[];
  dataset_id: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  description?: string;
}

export interface TableSchema {
  table_name: string;
  dataset_id: string;
  columns: ColumnInfo[];
}

export interface ChatRequest {
  question: string;
  table_id?: string;
  dataset_id?: string;
}

export interface ChatResponse {
  question: string;
  sql: string;
  explanation: string;
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  row_count?: number;
  timestamp: Date;
}
