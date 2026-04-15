'use client';

import { useState, useRef, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const years = Array.from({ length: 13 }, (_, i) => 2018 + i);
const kpiTypes = ['매출', '광고선전비', '공헌이익', '판매량'] as const;
const monthLabels = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

interface PreviewRow {
  담당자: string;
  구분: string;
  판매채널: string;
  monthly: number[];
}

interface ExcelUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultYear?: number;
}

export function ExcelUploadModal({ isOpen, onClose, onSuccess, defaultYear }: ExcelUploadModalProps) {
  // Step control
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 state
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  const [department, setDepartment] = useState('');
  const [year, setYear] = useState(defaultYear || new Date().getFullYear());
  const [kpiType, setKpiType] = useState<string>('매출');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
    };
  };

  const getAuthHeadersJson = () => {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  };

  const resetState = () => {
    setStep(1);
    setFile(null);
    setIsDragOver(false);
    setIsUploading(false);
    setUploadError(null);
    setPreviewData([]);
    setDepartment('');
    setYear(defaultYear || new Date().getFullYear());
    setKpiType('매출');
    setIsSubmitting(false);
    setSubmitError(null);
    setSuccessCount(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const isValidExcelFile = (f: File) => {
    const validExtensions = ['.xlsx', '.xls'];
    const fileName = f.name.toLowerCase();
    return validExtensions.some(ext => fileName.endsWith(ext));
  };

  const handleFileSelect = (f: File) => {
    setUploadError(null);
    if (!isValidExcelFile(f)) {
      setUploadError('xlsx 또는 xls 파일만 업로드할 수 있습니다.');
      return;
    }
    setFile(f);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  const handlePreview = async () => {
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/api/targets/preview-excel`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.detail || `업로드 실패 (${res.status})`);
      }

      const data = await res.json();
      // API 응답을 flat rows로 변환
      const flatRows: PreviewRow[] = [];
      for (const mgr of (data.managers || [])) {
        for (const ch of (mgr.channels || [])) {
          flatRows.push({
            담당자: mgr.manager,
            구분: ch.category,
            판매채널: ch.channel,
            monthly: ch.monthly,
          });
        }
      }
      setPreviewData(flatRows);
      setStep(2);
    } catch (error: any) {
      setUploadError(error.message || '파일 미리보기 중 오류가 발생했습니다.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpload = async () => {
    if (!department.trim()) {
      setSubmitError('부서를 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const formData = new FormData();
      formData.append('file', file!);
      formData.append('department', department);
      formData.append('year', String(year));
      formData.append('kpi_type', kpiType);

      const res = await fetch(`${API_BASE}/api/targets/upload-excel`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.detail || `업로드 실패 (${res.status})`);
      }

      const data = await res.json();
      setSuccessCount(Array.isArray(data) ? data.length : (data.count || data.created || previewData.length));
    } catch (error: any) {
      setSubmitError(error.message || '업로드 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuccessClose = () => {
    resetState();
    onSuccess();
    onClose();
  };

  // Group preview data by 담당자
  const groupedData = previewData.reduce<Record<string, PreviewRow[]>>((acc, row) => {
    const key = row.담당자 || '(미지정)';
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const formatNumber = (num: number) => {
    if (num === 0 || num === null || num === undefined) return '-';
    return new Intl.NumberFormat('ko-KR').format(num);
  };

  const calcGroupTotal = (rows: PreviewRow[], monthIdx: number) => {
    return rows.reduce((sum, row) => sum + (row.monthly[monthIdx] || 0), 0);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-[#0F1011] rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#23252A] flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#F7F8F8]">
            엑셀 업로드
            {step === 2 && <span className="ml-2 text-sm font-normal text-[#8A8F98]">- 미리보기</span>}
          </h2>
          <button
            onClick={handleClose}
            className="p-2 text-[#62666D] hover:text-[#D0D6E0] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Success message */}
          {successCount !== null ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-[#27A644]/15 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[#F7F8F8] mb-2">업로드 완료</h3>
              <p className="text-[#8A8F98] mb-6">
                총 <span className="font-bold text-[#7070FF]">{successCount}건</span>의 목표 데이터가 등록되었습니다.
              </p>
              <button
                onClick={handleSuccessClose}
                className="px-6 py-2 bg-[#5E6AD2] text-white rounded-lg hover:bg-[#828FFF] transition-colors"
              >
                확인
              </button>
            </div>
          ) : step === 1 ? (
            /* Step 1: File Selection */
            <div>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                  isDragOver
                    ? 'border-blue-400 bg-[#5E6AD2]/10'
                    : file
                    ? 'border-emerald-300 bg-[#27A644]/10'
                    : 'border-[#23252A] bg-[#08090A] hover:border-blue-400 hover:bg-[#5E6AD2]/10'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleInputChange}
                  className="hidden"
                />
                {file ? (
                  <div>
                    <div className="w-12 h-12 bg-[#27A644]/15 rounded-full flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-[#27A644]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-[#F7F8F8]">{file.name}</p>
                    <p className="text-xs text-[#8A8F98] mt-1">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                    <p className="text-xs text-[#62666D] mt-2">클릭하여 다른 파일 선택</p>
                  </div>
                ) : (
                  <div>
                    <div className="w-12 h-12 bg-[#232326] rounded-full flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-[#8A8F98]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-[#D0D6E0]">
                      엑셀 파일을 드래그하거나 클릭하여 선택하세요
                    </p>
                    <p className="text-xs text-[#62666D] mt-1">.xlsx, .xls 파일만 지원</p>
                  </div>
                )}
              </div>

              {uploadError && (
                <div className="mt-4 p-3 bg-[#EB5757]/10 border border-[#EB5757]/30 rounded-lg">
                  <p className="text-sm text-[#EB5757]">{uploadError}</p>
                </div>
              )}
            </div>
          ) : (
            /* Step 2: Preview & Settings */
            <div>
              {/* Settings form */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1">부서</label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="영업부"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1">기준 년도</label>
                  <select
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>{y}년</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1">KPI 구분</label>
                  <div className="flex flex-wrap gap-2">
                    {kpiTypes.map((type) => (
                      <label
                        key={type}
                        className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                          kpiType === type
                            ? 'bg-[#5E6AD2] text-white'
                            : 'bg-[#141516] text-[#D0D6E0] hover:bg-[#141516]/7'
                        }`}
                      >
                        <input
                          type="radio"
                          name="kpiType"
                          value={type}
                          checked={kpiType === type}
                          onChange={() => setKpiType(type)}
                          className="sr-only"
                        />
                        {type}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview table */}
              <div className="border border-[#23252A] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#141516] border-b border-[#23252A]">
                        <th className="px-3 py-2 text-left font-medium text-[#8A8F98] whitespace-nowrap sticky left-0 bg-[#141516] z-10">담당자</th>
                        <th className="px-3 py-2 text-left font-medium text-[#8A8F98] whitespace-nowrap">구분</th>
                        <th className="px-3 py-2 text-left font-medium text-[#8A8F98] whitespace-nowrap">판매채널</th>
                        {monthLabels.map((m) => (
                          <th key={m} className="px-3 py-2 text-right font-medium text-[#8A8F98] whitespace-nowrap">{m}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(groupedData).map(([manager, rows]) => (
                        <ManagerGroup
                          key={manager}
                          manager={manager}
                          rows={rows}
                          formatNumber={formatNumber}
                          calcGroupTotal={calcGroupTotal}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {previewData.length > 0 && (
                <p className="mt-3 text-xs text-[#8A8F98]">
                  총 {previewData.length}건의 데이터가 미리보기에 표시되었습니다.
                </p>
              )}

              {submitError && (
                <div className="mt-4 p-3 bg-[#EB5757]/10 border border-[#EB5757]/30 rounded-lg">
                  <p className="text-sm text-[#EB5757]">{submitError}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {successCount === null && (
          <div className="px-6 py-4 border-t border-[#23252A] flex items-center justify-between">
            <div>
              {step === 2 && (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 text-[#8A8F98] hover:bg-[#141516]/5 rounded-lg transition-colors text-sm"
                >
                  ← 파일 다시 선택
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-[#8A8F98] hover:bg-[#141516]/5 rounded-lg transition-colors"
              >
                취소
              </button>
              {step === 1 ? (
                <button
                  onClick={handlePreview}
                  disabled={!file || isUploading}
                  className="px-4 py-2 bg-[#5E6AD2] text-white rounded-lg hover:bg-[#828FFF] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isUploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      처리 중...
                    </>
                  ) : (
                    '미리보기'
                  )}
                </button>
              ) : (
                <button
                  onClick={handleUpload}
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-[#27A644] text-white rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      업로드 중...
                    </>
                  ) : (
                    '업로드'
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* Sub-component: Manager group in the preview table */
function ManagerGroup({
  manager,
  rows,
  formatNumber,
  calcGroupTotal,
}: {
  manager: string;
  rows: PreviewRow[];
  formatNumber: (n: number) => string;
  calcGroupTotal: (rows: PreviewRow[], monthIdx: number) => number;
}) {
  return (
    <>
      {rows.map((row, idx) => (
        <tr key={`${manager}-${idx}`} className="border-b border-[#23252A] hover:bg-[#141516]/5">
          {idx === 0 ? (
            <td
              className="px-3 py-2 font-medium text-[#F7F8F8] whitespace-nowrap sticky left-0 bg-[#0F1011] z-10"
              rowSpan={rows.length}
            >
              {manager}
            </td>
          ) : null}
          <td className="px-3 py-2 text-[#8A8F98] whitespace-nowrap">{row.구분}</td>
          <td className="px-3 py-2 text-[#8A8F98] whitespace-nowrap">{row.판매채널}</td>
          {row.monthly.map((val, mIdx) => (
            <td key={mIdx} className="px-3 py-2 text-right text-[#D0D6E0] whitespace-nowrap tabular-nums">
              {formatNumber(val)}
            </td>
          ))}
        </tr>
      ))}
      {/* Subtotal row */}
      <tr className="bg-[#5E6AD2]/10 border-b border-[#5E6AD2]/30">
        <td className="px-3 py-2 font-semibold text-[#828FFF] whitespace-nowrap sticky left-0 bg-[#5E6AD2]/10 z-10">
          {manager} 소계
        </td>
        <td className="px-3 py-2" colSpan={2}></td>
        {monthLabels.map((_, mIdx) => (
          <td key={mIdx} className="px-3 py-2 text-right font-semibold text-[#828FFF] whitespace-nowrap tabular-nums">
            {formatNumber(calcGroupTotal(rows, mIdx))}
          </td>
        ))}
      </tr>
    </>
  );
}
