'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@/components/nd/icons';

interface ExcelGridProps {
  columns: string[];  // 열 헤더 (1월~12월 또는 1일~31일)
  data: string[][];   // 2D 배열 데이터
  onChange: (data: string[][]) => void;
  allowAddRow?: boolean;
  allowAddColumn?: boolean;
  firstColumnEditable?: boolean;  // 첫 번째 열(기준) 편집 가능 여부
}

export function ExcelGrid({
  columns,
  data,
  onChange,
  allowAddRow = true,
  allowAddColumn = false,
  firstColumnEditable = true,
}: ExcelGridProps) {
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // 셀 값 변경
  const handleCellChange = useCallback((rowIndex: number, colIndex: number, value: string) => {
    const newData = data.map((row, ri) =>
      ri === rowIndex
        ? row.map((cell, ci) => (ci === colIndex ? value : cell))
        : row
    );
    onChange(newData);
  }, [data, onChange]);

  // 행 추가 (맨 아래)
  const handleAddRow = useCallback(() => {
    const newRow = new Array(columns.length + 1).fill('');
    onChange([...data, newRow]);
  }, [data, columns.length, onChange]);

  // 특정 위치에 행 삽입 (해당 행 아래에 추가)
  const handleInsertRowBelow = useCallback((rowIndex: number) => {
    const newRow = new Array(columns.length + 1).fill('');
    const newData = [
      ...data.slice(0, rowIndex + 1),
      newRow,
      ...data.slice(rowIndex + 1)
    ];
    onChange(newData);
  }, [data, columns.length, onChange]);

  // 특정 위치에 행 삽입 (해당 행 위에 추가)
  const handleInsertRowAbove = useCallback((rowIndex: number) => {
    const newRow = new Array(columns.length + 1).fill('');
    const newData = [
      ...data.slice(0, rowIndex),
      newRow,
      ...data.slice(rowIndex)
    ];
    onChange(newData);
  }, [data, columns.length, onChange]);

  // 행 삭제
  const handleDeleteRow = useCallback((rowIndex: number) => {
    if (data.length <= 1) return;
    const newData = data.filter((_, i) => i !== rowIndex);
    onChange(newData);
  }, [data, onChange]);

  // 붙여넣기 처리
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    if (!selectedCell) return;

    const pasteData = e.clipboardData.getData('text');
    const rows = pasteData.split('\n').map(row => row.split('\t'));

    const newData = [...data];
    rows.forEach((pasteRow, ri) => {
      const targetRow = selectedCell.row + ri;
      if (targetRow >= newData.length) {
        // 새 행 추가
        newData.push(new Array(columns.length + 1).fill(''));
      }
      pasteRow.forEach((cell, ci) => {
        const targetCol = selectedCell.col + ci;
        if (targetCol < newData[targetRow].length) {
          newData[targetRow][targetCol] = cell.trim();
        }
      });
    });

    onChange(newData);
  }, [selectedCell, data, columns.length, onChange]);

  // 복사 처리
  const handleCopy = useCallback((e: React.ClipboardEvent) => {
    if (!selectedCell) return;
    const cellValue = data[selectedCell.row]?.[selectedCell.col] || '';
    e.clipboardData.setData('text/plain', cellValue);
    e.preventDefault();
  }, [selectedCell, data]);

  // 키보드 네비게이션
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!selectedCell) return;

    const { row, col } = selectedCell;
    let newRow = row;
    let newCol = col;

    switch (e.key) {
      case 'ArrowUp':
        newRow = Math.max(0, row - 1);
        break;
      case 'ArrowDown':
        newRow = Math.min(data.length - 1, row + 1);
        break;
      case 'ArrowLeft':
        newCol = Math.max(0, col - 1);
        break;
      case 'ArrowRight':
        newCol = Math.min(columns.length, col + 1);
        break;
      case 'Enter':
        if (editingCell) {
          setEditingCell(null);
          newRow = Math.min(data.length - 1, row + 1);
        } else {
          setEditingCell(selectedCell);
        }
        break;
      case 'Escape':
        setEditingCell(null);
        break;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) {
          newCol = col > 0 ? col - 1 : columns.length;
          if (newCol === columns.length && row > 0) {
            newRow = row - 1;
          }
        } else {
          newCol = col < columns.length ? col + 1 : 0;
          if (newCol === 0 && row < data.length - 1) {
            newRow = row + 1;
          }
        }
        break;
      default:
        return;
    }

    if (newRow !== row || newCol !== col) {
      e.preventDefault();
      setSelectedCell({ row: newRow, col: newCol });
      setEditingCell(null);
    }
  }, [selectedCell, editingCell, data.length, columns.length]);

  return (
    <div className="border border-border-primary rounded-lg overflow-hidden">
      <div
        ref={gridRef}
        className="overflow-auto max-h-[400px]"
        onPaste={handlePaste}
        onCopy={handleCopy}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <table className="w-full border-collapse">
          <thead className="bg-bg-2 sticky top-0 z-10">
            <tr>
              {allowAddRow && (
                <th className="border-r border-b border-border-primary px-1 py-2 w-[70px] text-center text-xs font-medium text-text-tertiary">
                  행 관리
                </th>
              )}
              <th className="border-r border-b border-border-primary px-3 py-2 text-left text-sm font-semibold text-text-secondary min-w-[120px]">
                기준
              </th>
              {columns.map((col, i) => (
                <th
                  key={i}
                  className="border-r border-b border-border-primary px-3 py-2 text-center text-sm font-semibold text-text-secondary min-w-[80px]"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-bg-secondary group">
                {/* 행 관리 버튼들 */}
                {allowAddRow && (
                  <td className="border-r border-b border-border-primary px-1 py-1 bg-bg-0">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleInsertRowAbove(rowIndex)}
                        className="p-0.5 text-text-quaternary hover:text-link transition-colors opacity-0 group-hover:opacity-100"
                        title="위에 행 추가"
                      >
                        <ArrowUpIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInsertRowBelow(rowIndex)}
                        className="p-0.5 text-text-quaternary hover:text-link transition-colors opacity-0 group-hover:opacity-100"
                        title="아래에 행 추가"
                      >
                        <ArrowDownIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(rowIndex)}
                        className={`p-0.5 text-text-quaternary hover:text-danger transition-colors ${data.length <= 1 ? 'opacity-30 cursor-not-allowed' : 'opacity-0 group-hover:opacity-100'}`}
                        title="행 삭제"
                        disabled={data.length <= 1}
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                )}
                {/* 첫 번째 열 (기준) */}
                <td
                  className={`border-r border-b border-border-primary px-1 py-1 ${
                    selectedCell?.row === rowIndex && selectedCell?.col === 0
                      ? 'ring-2 ring-brand ring-inset'
                      : ''
                  }`}
                  onClick={() => setSelectedCell({ row: rowIndex, col: 0 })}
                  onDoubleClick={() => firstColumnEditable && setEditingCell({ row: rowIndex, col: 0 })}
                >
                  {editingCell?.row === rowIndex && editingCell?.col === 0 ? (
                    <input
                      type="text"
                      value={row[0] || ''}
                      onChange={(e) => handleCellChange(rowIndex, 0, e.target.value)}
                      onBlur={() => setEditingCell(null)}
                      autoFocus
                      className="w-full px-2 py-1 text-sm border-0 outline-none bg-bg-1"
                    />
                  ) : (
                    <div className="px-2 py-1 text-sm text-text-primary min-h-[28px]">
                      {row[0] || ''}
                    </div>
                  )}
                </td>
                {/* 데이터 열들 */}
                {columns.map((_, colIndex) => {
                  const cellIndex = colIndex + 1;
                  const isSelected = selectedCell?.row === rowIndex && selectedCell?.col === cellIndex;
                  const isEditing = editingCell?.row === rowIndex && editingCell?.col === cellIndex;

                  return (
                    <td
                      key={colIndex}
                      className={`border-r border-b border-border-primary px-1 py-1 ${
                        isSelected ? 'ring-2 ring-brand ring-inset' : ''
                      }`}
                      onClick={() => setSelectedCell({ row: rowIndex, col: cellIndex })}
                      onDoubleClick={() => setEditingCell({ row: rowIndex, col: cellIndex })}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          value={row[cellIndex] || ''}
                          onChange={(e) => handleCellChange(rowIndex, cellIndex, e.target.value)}
                          onBlur={() => setEditingCell(null)}
                          autoFocus
                          className="w-full px-2 py-1 text-sm border-0 outline-none bg-bg-1 text-right"
                        />
                      ) : (
                        <div className="px-2 py-1 text-sm text-text-primary text-right min-h-[28px]">
                          {row[cellIndex] || ''}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 하단 버튼 */}
      <div className="flex items-center gap-2 p-2 bg-bg-0 border-t border-border-primary">
        {allowAddRow && (
          <button
            type="button"
            onClick={handleAddRow}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-link hover:bg-brand/10 rounded transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            행 추가
          </button>
        )}
        <span className="text-xs text-text-tertiary ml-auto">
          Tip: Ctrl+C/V로 복사/붙여넣기, 더블클릭으로 편집
        </span>
      </div>
    </div>
  );
}
