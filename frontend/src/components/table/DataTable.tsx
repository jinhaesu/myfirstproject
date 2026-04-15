'use client';

import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { useMemo } from 'react';

interface DataTableProps {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function DataTable({ columns, rows }: DataTableProps) {
  const columnHelper = createColumnHelper<Record<string, unknown>>();

  const tableColumns = useMemo(
    () =>
      columns.map((col) =>
        columnHelper.accessor(col, {
          header: col,
          cell: (info) => {
            const value = info.getValue();
            if (value === null || value === undefined) {
              return <span className="text-[#62666D]">NULL</span>;
            }
            if (typeof value === 'object') {
              return JSON.stringify(value);
            }
            return String(value);
          },
        })
      ),
    [columns, columnHelper]
  );

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  });

  if (rows.length === 0) {
    return (
      <div className="text-center text-[#8A8F98] py-8">
        결과가 없습니다
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-[#23252A]">
        <thead className="bg-[#08090A]">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-4 py-3 text-left text-xs font-medium text-[#8A8F98] uppercase tracking-wider"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="bg-[#0F1011] divide-y divide-[#23252A]">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-[#141516]/5">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className="px-4 py-2 text-sm text-[#F7F8F8] whitespace-nowrap max-w-xs truncate"
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 페이지네이션 */}
      <div className="flex items-center justify-between px-4 py-3 border-t">
        <div className="text-sm text-[#8A8F98]">
          {rows.length}개 중 {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}-
          {Math.min(
            (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
            rows.length
          )}
          개 표시
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#141516]/5"
          >
            이전
          </button>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#141516]/5"
          >
            다음
          </button>
        </div>
      </div>
    </div>
  );
}
