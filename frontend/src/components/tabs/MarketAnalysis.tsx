'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { marketAnalysisApi } from '@/lib/api';

interface Keyword {
  id: string;
  keyword: string;
  category: string | null;
  enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
}

interface MetricPoint {
  id: string;
  platform: string;
  date: string;
  content_count: number;
  view_count: number;
  hashtags: string[] | null;
  search_volume: number | null;
}

interface SentimentData {
  id: string;
  platform: string;
  date: string;
  positive_ratio: number;
  negative_ratio: number;
  neutral_ratio: number;
  positive_keywords: string[];
  negative_keywords: string[];
  sample_size: number;
}

interface CompareData {
  [keywordId: string]: {
    keyword: string;
    category: string | null;
    metrics: {
      platform: string;
      date: string;
      content_count: number;
      view_count: number;
      search_volume: number | null;
    }[];
  };
}

const CHART_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6'];

const PLATFORMS = [
  { key: '', label: '전체' },
  { key: 'instagram', label: '인스타그램' },
  { key: 'youtube', label: '유튜브' },
  { key: 'naver_blog', label: '네이버 블로그' },
];

const DATE_RANGES = [
  { days: 7, label: '최근 7일' },
  { days: 30, label: '최근 30일' },
  { days: 90, label: '최근 90일' },
];

function SimpleLineChart({
  datasets,
  labels,
  title,
}: {
  datasets: { name: string; data: number[]; color: string }[];
  labels: string[];
  title: string;
}) {
  if (!labels.length || !datasets.length) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        데이터가 없습니다
      </div>
    );
  }

  const padding = { top: 30, right: 30, bottom: 50, left: 70 };
  const width = 800;
  const height = 400;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const allValues = datasets.flatMap((d) => d.data);
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  const xStep = labels.length > 1 ? chartW / (labels.length - 1) : chartW;

  const getX = (i: number) => padding.left + (labels.length > 1 ? i * xStep : chartW / 2);
  const getY = (v: number) => padding.top + chartH - ((v - minVal) / range) * chartH;

  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) =>
    Math.round(minVal + (range / yTicks) * i)
  );

  const labelStep = Math.max(1, Math.floor(labels.length / 8));

  return (
    <div className="w-full">
      <h4 className="text-sm font-semibold text-gray-700 mb-2">{title}</h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Y axis grid + labels */}
        {yTickValues.map((val, i) => (
          <g key={`y-${i}`}>
            <line
              x1={padding.left}
              y1={getY(val)}
              x2={width - padding.right}
              y2={getY(val)}
              stroke="#E5E7EB"
              strokeWidth="1"
            />
            <text
              x={padding.left - 10}
              y={getY(val) + 4}
              textAnchor="end"
              fontSize="11"
              fill="#6B7280"
            >
              {val.toLocaleString('ko-KR')}
            </text>
          </g>
        ))}

        {/* X axis labels */}
        {labels.map((label, i) =>
          i % labelStep === 0 ? (
            <text
              key={`x-${i}`}
              x={getX(i)}
              y={height - 10}
              textAnchor="middle"
              fontSize="10"
              fill="#6B7280"
            >
              {label}
            </text>
          ) : null
        )}

        {/* Data lines */}
        {datasets.map((ds, dsIdx) => {
          if (ds.data.length < 2) return null;
          const pathD = ds.data
            .map((val, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(val)}`)
            .join(' ');
          return (
            <g key={`ds-${dsIdx}`}>
              <path d={pathD} fill="none" stroke={ds.color} strokeWidth="2.5" />
              {ds.data.map((val, i) => (
                <circle
                  key={`pt-${dsIdx}-${i}`}
                  cx={getX(i)}
                  cy={getY(val)}
                  r="3"
                  fill={ds.color}
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-2 justify-center">
        {datasets.map((ds, i) => (
          <div key={i} className="flex items-center gap-1.5 text-sm text-gray-600">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: ds.color }}
            />
            {ds.name}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MarketAnalysis() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [sentimentData, setSentimentData] = useState<SentimentData[]>([]);
  const [compareData, setCompareData] = useState<CompareData>({});
  const [activePlatform, setActivePlatform] = useState('');
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [activeKeywordId, setActiveKeywordId] = useState<string | null>(null);

  // 키워드 목록 조회
  const fetchKeywords = useCallback(async () => {
    try {
      const data = await marketAnalysisApi.getKeywords();
      setKeywords(data as Keyword[]);
    } catch (err) {
      console.error('키워드 목록 조회 실패:', err);
    }
  }, []);

  useEffect(() => {
    fetchKeywords();
  }, [fetchKeywords]);

  // 단일 키워드 메트릭 조회
  const fetchMetrics = useCallback(async (keywordId: string) => {
    try {
      setLoading(true);
      const data = await marketAnalysisApi.getMetrics(keywordId, activePlatform || undefined, days);
      setMetrics(data as MetricPoint[]);
    } catch (err) {
      console.error('메트릭 조회 실패:', err);
    } finally {
      setLoading(false);
    }
  }, [activePlatform, days]);

  // 감성 분석 조회
  const fetchSentiment = useCallback(async (keywordId: string) => {
    try {
      const data = await marketAnalysisApi.getSentiment(keywordId, activePlatform || undefined, days);
      setSentimentData(data as SentimentData[]);
    } catch (err) {
      console.error('감성 분석 조회 실패:', err);
    }
  }, [activePlatform, days]);

  // 비교 데이터 조회
  const fetchCompare = useCallback(async () => {
    if (selectedIds.size < 2) return;
    try {
      setLoading(true);
      const ids = Array.from(selectedIds);
      const data = await marketAnalysisApi.compare(ids, activePlatform || undefined, days);
      setCompareData(data as CompareData);
    } catch (err) {
      console.error('비교 데이터 조회 실패:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedIds, activePlatform, days]);

  // 활성 키워드 변경 시 데이터 조회
  useEffect(() => {
    if (activeKeywordId) {
      fetchMetrics(activeKeywordId);
      fetchSentiment(activeKeywordId);
    }
  }, [activeKeywordId, fetchMetrics, fetchSentiment]);

  // 비교 모드
  useEffect(() => {
    if (selectedIds.size >= 2) {
      fetchCompare();
    }
  }, [selectedIds, fetchCompare]);

  // 키워드 추가
  const handleAddKeyword = async () => {
    if (!newKeyword.trim()) return;
    try {
      await marketAnalysisApi.createKeyword({
        keyword: newKeyword.trim(),
        category: newCategory.trim() || undefined,
      });
      setNewKeyword('');
      setNewCategory('');
      setShowAddForm(false);
      fetchKeywords();
    } catch (err) {
      console.error('키워드 추가 실패:', err);
    }
  };

  // 키워드 삭제
  const handleDelete = async (id: string) => {
    try {
      await marketAnalysisApi.deleteKeyword(id);
      if (activeKeywordId === id) {
        setActiveKeywordId(null);
        setMetrics([]);
        setSentimentData([]);
      }
      selectedIds.delete(id);
      setSelectedIds(new Set(selectedIds));
      fetchKeywords();
    } catch (err) {
      console.error('키워드 삭제 실패:', err);
    }
  };

  // 키워드 토글
  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await marketAnalysisApi.updateKeyword(id, { enabled: !enabled });
      fetchKeywords();
    } catch (err) {
      console.error('키워드 토글 실패:', err);
    }
  };

  // 데이터 수집
  const handleCollect = async (id: string) => {
    try {
      setCollectingId(id);
      await marketAnalysisApi.collectMetrics(id);
      if (activeKeywordId === id) {
        fetchMetrics(id);
        fetchSentiment(id);
      }
    } catch (err) {
      console.error('데이터 수집 실패:', err);
    } finally {
      setCollectingId(null);
    }
  };

  // 비교 선택 토글
  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // 메트릭 데이터를 차트용으로 변환
  const buildMetricsChart = () => {
    if (selectedIds.size >= 2 && Object.keys(compareData).length > 0) {
      // 비교 모드
      const allDates = new Set<string>();
      Object.values(compareData).forEach((kw) =>
        kw.metrics.forEach((m) => allDates.add(m.date.split('T')[0]))
      );
      const sortedDates = Array.from(allDates).sort();

      const datasets = Object.entries(compareData).map(([, kw], idx) => {
        const dateMap: Record<string, number> = {};
        kw.metrics.forEach((m) => {
          const d = m.date.split('T')[0];
          dateMap[d] = (dateMap[d] || 0) + m.content_count;
        });
        return {
          name: kw.keyword,
          color: CHART_COLORS[idx % CHART_COLORS.length],
          data: sortedDates.map((d) => dateMap[d] || 0),
        };
      });

      return { labels: sortedDates, datasets };
    }

    // 단일 키워드
    if (!metrics.length) return { labels: [], datasets: [] };

    const dateMap: Record<string, { content: number; view: number }> = {};
    metrics.forEach((m) => {
      const d = m.date.split('T')[0];
      if (!dateMap[d]) dateMap[d] = { content: 0, view: 0 };
      dateMap[d].content += m.content_count;
      dateMap[d].view += m.view_count;
    });

    const sortedDates = Object.keys(dateMap).sort();
    return {
      labels: sortedDates,
      datasets: [
        {
          name: '콘텐츠 수',
          color: CHART_COLORS[0],
          data: sortedDates.map((d) => dateMap[d].content),
        },
        {
          name: '조회 수',
          color: CHART_COLORS[1],
          data: sortedDates.map((d) => dateMap[d].view),
        },
      ],
    };
  };

  // 해시태그 수집
  const allHashtags = Array.from(
    new Set(metrics.flatMap((m) => m.hashtags || []))
  ).slice(0, 30);

  // 최신 감성 데이터
  const latestSentiment = sentimentData.length > 0 ? sentimentData[0] : null;

  const chartData = buildMetricsChart();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">시장 분석</h1>
        <div className="flex gap-2">
          {DATE_RANGES.map((dr) => (
            <button
              key={dr.days}
              onClick={() => setDays(dr.days)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                days === dr.days
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {dr.label}
            </button>
          ))}
        </div>
      </div>

      {/* 키워드 관리 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">키워드 관리</h2>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            {showAddForm ? '닫기' : '+ 키워드 추가'}
          </button>
        </div>

        {/* 추가 폼 */}
        {showAddForm && (
          <div className="flex gap-3 mb-4 p-4 bg-gray-50 rounded-lg">
            <input
              type="text"
              placeholder="키워드 입력"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="카테고리 (선택)"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleAddKeyword}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
            >
              추가
            </button>
          </div>
        )}

        {/* 키워드 목록 */}
        <div className="space-y-2">
          {keywords.length === 0 && (
            <p className="text-gray-400 text-center py-4">등록된 키워드가 없습니다</p>
          )}
          {keywords.map((kw) => (
            <div
              key={kw.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                activeKeywordId === kw.id
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => setActiveKeywordId(kw.id)}
            >
              {/* 비교 체크박스 */}
              <input
                type="checkbox"
                checked={selectedIds.has(kw.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleSelect(kw.id);
                }}
                className="w-4 h-4 text-blue-600 rounded"
              />

              {/* 키워드 정보 */}
              <div className="flex-1">
                <span className="font-medium text-gray-900">{kw.keyword}</span>
                {kw.category && (
                  <span className="ml-2 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                    {kw.category}
                  </span>
                )}
              </div>

              {/* ON/OFF 토글 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle(kw.id, kw.enabled);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  kw.enabled
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {kw.enabled ? 'ON' : 'OFF'}
              </button>

              {/* 수집 버튼 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCollect(kw.id);
                }}
                disabled={collectingId === kw.id}
                className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-200 transition-colors disabled:opacity-50"
              >
                {collectingId === kw.id ? '수집 중...' : '수집'}
              </button>

              {/* 삭제 버튼 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(kw.id);
                }}
                className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-medium hover:bg-red-200 transition-colors"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 플랫폼 탭 */}
      <div className="flex gap-1 mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-1">
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            onClick={() => setActivePlatform(p.key)}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activePlatform === p.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 메트릭 차트 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          {selectedIds.size >= 2 ? '키워드 비교' : '메트릭 추이'}
        </h2>
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : (
          <SimpleLineChart
            datasets={chartData.datasets}
            labels={chartData.labels}
            title={selectedIds.size >= 2 ? '콘텐츠 수 비교' : '콘텐츠 수 / 조회 수'}
          />
        )}
      </div>

      {/* 관련 해시태그 */}
      {allHashtags.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">관련 해시태그</h2>
          <div className="flex flex-wrap gap-2">
            {allHashtags.map((tag, i) => (
              <span
                key={i}
                className="bg-blue-100 text-blue-700 rounded-full px-3 py-1 text-sm"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 감성 분석 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">감성 분석 결과</h2>

        {!latestSentiment ? (
          <p className="text-gray-400 text-center py-4">감성 분석 데이터가 없습니다</p>
        ) : (
          <div className="space-y-6">
            {/* 감성 비율 바 */}
            <div>
              <div className="flex text-sm text-gray-600 mb-1">
                <span className="flex-1">
                  긍정 {(latestSentiment.positive_ratio * 100).toFixed(1)}%
                </span>
                <span className="flex-1 text-center">
                  중립 {(latestSentiment.neutral_ratio * 100).toFixed(1)}%
                </span>
                <span className="flex-1 text-right">
                  부정 {(latestSentiment.negative_ratio * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex h-6 rounded-full overflow-hidden">
                <div
                  className="bg-green-500 transition-all"
                  style={{ width: `${latestSentiment.positive_ratio * 100}%` }}
                />
                <div
                  className="bg-gray-400 transition-all"
                  style={{ width: `${latestSentiment.neutral_ratio * 100}%` }}
                />
                <div
                  className="bg-red-500 transition-all"
                  style={{ width: `${latestSentiment.negative_ratio * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                분석 샘플: {latestSentiment.sample_size.toLocaleString('ko-KR')}건
              </p>
            </div>

            {/* 긍정 키워드 */}
            {latestSentiment.positive_keywords && latestSentiment.positive_keywords.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">긍정 키워드</h3>
                <div className="flex flex-wrap gap-2">
                  {latestSentiment.positive_keywords.map((kw, i) => (
                    <span
                      key={i}
                      className="bg-green-100 text-green-700 rounded-full px-3 py-1 text-sm"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 부정 키워드 */}
            {latestSentiment.negative_keywords && latestSentiment.negative_keywords.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">부정 키워드</h3>
                <div className="flex flex-wrap gap-2">
                  {latestSentiment.negative_keywords.map((kw, i) => (
                    <span
                      key={i}
                      className="bg-red-100 text-red-700 rounded-full px-3 py-1 text-sm"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
