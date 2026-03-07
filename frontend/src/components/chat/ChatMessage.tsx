'use client';

import { useState } from 'react';
import { DataTable } from '../table/DataTable';
import { DataChart } from '../chart/DataChart';
import type { Message } from '@/types';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { saveAs } from 'file-saver';

interface ChatMessageProps {
  message: Message;
}

const COLLAPSE_THRESHOLD = 500; // 글자 수 기준

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [showChart, setShowChart] = useState(false);
  const isLong = !isUser && message.content.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);

  const handleDownloadCsv = () => {
    if (!message.columns || !message.rows) return;

    const headers = message.columns.join(',');
    const rows = message.rows.map(row =>
      message.columns!.map(col => {
        const value = row[col];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return String(value);
      }).join(',')
    ).join('\n');

    const csv = `${headers}\n${rows}`;
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `data_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadWord = async () => {
    const children: (Paragraph | Table)[] = [];

    children.push(
      new Paragraph({
        text: '데이터 분석 결과',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 200 },
      })
    );

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `생성일시: ${message.timestamp.toLocaleString('ko-KR')}`,
            size: 20,
            color: '666666',
          }),
        ],
        spacing: { after: 300 },
      })
    );

    children.push(
      new Paragraph({
        text: '분석 내용',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    );

    const contentLines = message.content.split('\n');
    for (const line of contentLines) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: line, size: 22 }),
          ],
          spacing: { after: 80 },
        })
      );
    }

    if (message.columns && message.rows && message.rows.length > 0) {
      children.push(
        new Paragraph({
          text: `조회 결과 (${message.row_count || message.rows.length}행)`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 100 },
        })
      );

      const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
      const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

      const headerRow = new TableRow({
        children: message.columns.map((col) =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: col, bold: true, size: 18, font: 'Malgun Gothic' })] })],
            borders,
            shading: { fill: 'E8E8E8' },
          })
        ),
      });

      const dataRows = message.rows.map((row) =>
        new TableRow({
          children: message.columns!.map((col) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: row[col] != null ? String(row[col]) : '', size: 18, font: 'Malgun Gothic' })] })],
              borders,
            })
          ),
        })
      );

      children.push(new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
    }

    const doc = new Document({ sections: [{ properties: {}, children }] });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, `분석결과_${new Date().toISOString().slice(0, 10)}.docx`);
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-full lg:max-w-5xl rounded-2xl p-4 ${
          isUser
            ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg'
            : 'bg-white border border-slate-200 shadow-md'
        }`}
      >
        {/* 메시지 내용 */}
        <div className="relative">
          <div
            className={`text-[13px] whitespace-pre-wrap leading-relaxed break-words ${isUser ? '' : 'text-slate-700'} ${
              isLong && !expanded ? 'max-h-[300px] overflow-hidden' : ''
            }`}
          >
            {message.content}
          </div>
          {isLong && !expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none" />
          )}
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {expanded ? '접기' : '더보기'}
            </button>
          )}
        </div>

        {/* 결과 테이블 */}
        {!isUser && message.columns && message.rows && message.rows.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                결과 ({message.row_count}행)
              </h4>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setShowChart(!showChart)}
                  className={`text-xs px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 ${
                    showChart ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  {showChart ? '테이블' : '차트'}
                </button>
                <button
                  onClick={handleDownloadCsv}
                  className="text-xs px-2.5 py-1 text-slate-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  CSV
                </button>
              </div>
            </div>

            {showChart ? (
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white p-3">
                <DataChart columns={message.columns} rows={message.rows} />
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <DataTable columns={message.columns} rows={message.rows} />
              </div>
            )}
          </div>
        )}

        {/* Word 다운로드 */}
        {!isUser && message.content.length > 200 && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <button
              onClick={handleDownloadWord}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Word 파일로 다운로드
            </button>
          </div>
        )}

        {/* 타임스탬프 */}
        <p className={`text-[10px] mt-2 flex items-center gap-1 ${isUser ? 'text-blue-200' : 'text-slate-400'}`}>
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {message.timestamp.toLocaleTimeString('ko-KR')}
        </p>
      </div>
    </div>
  );
}
