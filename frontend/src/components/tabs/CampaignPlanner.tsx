'use client';

import { useState, useEffect, useCallback } from 'react';
import { campaignPlannerApi } from '@/lib/api';

interface CampaignPlanData {
  id: string;
  user_id: string;
  product_name: string;
  product_url: string | null;
  product_description: string | null;
  campaign_goal: string;
  reference_urls: string[] | null;
  product_image_urls: string[] | null;
  additional_notes: string | null;
  ai_plan: any | null;
  creative_brief: any | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

const GOAL_OPTIONS = [
  { value: 'awareness', label: '인지도 향상' },
  { value: 'traffic', label: '트래픽 유도' },
  { value: 'conversions', label: '전환/구매' },
  { value: 'app_installs', label: '앱 설치' },
  { value: 'leads', label: '리드 수집' },
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: '초안', color: 'bg-gray-100 text-gray-700' },
  planned: { label: '기획 완료', color: 'bg-blue-100 text-blue-700' },
  submitted: { label: '제출됨', color: 'bg-amber-100 text-amber-700' },
  active: { label: '활성', color: 'bg-green-100 text-green-700' },
};

function formatKRW(value: number | undefined | null): string {
  if (value == null) return '-';
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(value);
}

export default function CampaignPlanner() {
  // ─── State ───
  const [plans, setPlans] = useState<CampaignPlanData[]>([]);
  const [currentPlan, setCurrentPlan] = useState<CampaignPlanData | null>(null);
  const [activeSection, setActiveSection] = useState<'form' | 'plan' | 'creative' | 'draft'>('form');

  // Form state
  const [productName, setProductName] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [campaignGoal, setCampaignGoal] = useState('traffic');
  const [referenceUrls, setReferenceUrls] = useState<string[]>(['']);
  const [productImageUrls, setProductImageUrls] = useState<string[]>(['']);
  const [additionalNotes, setAdditionalNotes] = useState('');

  // Loading states
  const [generating, setGenerating] = useState(false);
  const [creatingCreative, setCreatingCreative] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);

  // Draft result
  const [draftResult, setDraftResult] = useState<any>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  // ─── Load plans ───
  const loadPlans = useCallback(async () => {
    setLoadingPlans(true);
    try {
      const data = await campaignPlannerApi.getPlans();
      setPlans(data as CampaignPlanData[]);
    } catch (e) {
      console.error('기획서 목록 로드 실패:', e);
    } finally {
      setLoadingPlans(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  // ─── Handlers ───
  const handleGeneratePlan = async () => {
    if (!productName.trim()) return;
    setGenerating(true);
    setDraftResult(null);
    setDraftError(null);
    try {
      const result = await campaignPlannerApi.generatePlan({
        product_name: productName,
        product_url: productUrl || null,
        product_description: productDescription || null,
        campaign_goal: campaignGoal,
        reference_urls: referenceUrls.filter((u) => u.trim()),
        product_image_urls: productImageUrls.filter((u) => u.trim()),
        additional_notes: additionalNotes || null,
      });
      setCurrentPlan(result);
      setActiveSection('plan');
      await loadPlans();
    } catch (e: any) {
      alert(e.message || 'AI 기획 생성에 실패했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateCreative = async () => {
    if (!currentPlan) return;
    setCreatingCreative(true);
    try {
      const result = await campaignPlannerApi.generateCreative(currentPlan.id);
      setCurrentPlan(result);
      setActiveSection('creative');
    } catch (e: any) {
      alert(e.message || '소재 브리프 생성에 실패했습니다.');
    } finally {
      setCreatingCreative(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!currentPlan) return;
    setCreatingDraft(true);
    setDraftResult(null);
    setDraftError(null);
    try {
      const result = await campaignPlannerApi.createDraft(currentPlan.id);
      setDraftResult(result);
      setActiveSection('draft');
      await loadPlans();
      // Reload current plan to get updated status
      const updated = await campaignPlannerApi.getPlan(currentPlan.id);
      setCurrentPlan(updated);
    } catch (e: any) {
      setDraftError(e.message || 'Meta 캠페인 생성에 실패했습니다.');
    } finally {
      setCreatingDraft(false);
    }
  };

  const handleViewPlan = async (planId: string) => {
    try {
      const plan = await campaignPlannerApi.getPlan(planId);
      setCurrentPlan(plan);
      setActiveSection('plan');
      setDraftResult(null);
      setDraftError(null);
    } catch (e: any) {
      alert(e.message || '기획서 조회에 실패했습니다.');
    }
  };

  const handleDeletePlan = async (planId: string) => {
    if (!confirm('이 기획서를 삭제하시겠습니까?')) return;
    try {
      await campaignPlannerApi.deletePlan(planId);
      if (currentPlan?.id === planId) {
        setCurrentPlan(null);
        setActiveSection('form');
      }
      await loadPlans();
    } catch (e: any) {
      alert(e.message || '삭제에 실패했습니다.');
    }
  };

  // ─── Dynamic URL list helpers ───
  const addReferenceUrl = () => setReferenceUrls([...referenceUrls, '']);
  const removeReferenceUrl = (idx: number) => setReferenceUrls(referenceUrls.filter((_, i) => i !== idx));
  const updateReferenceUrl = (idx: number, val: string) => {
    const updated = [...referenceUrls];
    updated[idx] = val;
    setReferenceUrls(updated);
  };

  const addProductImageUrl = () => setProductImageUrls([...productImageUrls, '']);
  const removeProductImageUrl = (idx: number) => setProductImageUrls(productImageUrls.filter((_, i) => i !== idx));
  const updateProductImageUrl = (idx: number, val: string) => {
    const updated = [...productImageUrls];
    updated[idx] = val;
    setProductImageUrls(updated);
  };

  const aiPlan = currentPlan?.ai_plan;
  const creativeBrief = currentPlan?.creative_brief;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* ═══ 캠페인 입력 폼 ═══ */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-2xl font-bold text-slate-800 mb-6">AI 캠페인 기획</h2>

        <div className="space-y-5">
          {/* 제품/서비스명 */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              제품/서비스명 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="예: 프리미엄 비타민 C 세럼"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>

          {/* 제품 URL */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">제품 URL</label>
            <input
              type="url"
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              placeholder="https://example.com/product"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>

          {/* 제품 설명 */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">제품 설명</label>
            <textarea
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              placeholder="제품의 특징, USP, 타겟 고객 등"
              rows={3}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition resize-none"
            />
          </div>

          {/* 캠페인 목표 */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              캠페인 목표 <span className="text-red-500">*</span>
            </label>
            <select
              value={campaignGoal}
              onChange={(e) => setCampaignGoal(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition bg-white"
            >
              {GOAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 참고 콘텐츠 URL */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">참고 콘텐츠 URL</label>
            {referenceUrls.map((url, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => updateReferenceUrl(idx, e.target.value)}
                  placeholder="참고할 광고/콘텐츠 URL"
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                />
                {referenceUrls.length > 1 && (
                  <button
                    onClick={() => removeReferenceUrl(idx)}
                    className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-xl transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addReferenceUrl}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium mt-1"
            >
              + URL 추가
            </button>
          </div>

          {/* 제품 이미지 URL */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">제품 이미지 URL</label>
            {productImageUrls.map((url, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => updateProductImageUrl(idx, e.target.value)}
                  placeholder="제품 이미지 URL"
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                />
                {productImageUrls.length > 1 && (
                  <button
                    onClick={() => removeProductImageUrl(idx)}
                    className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-xl transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addProductImageUrl}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium mt-1"
            >
              + 이미지 URL 추가
            </button>
          </div>

          {/* 추가 설명 */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">추가 설명</label>
            <textarea
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              placeholder="브랜드 톤앤매너, 예산 제약, 특별 요청사항 등"
              rows={2}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition resize-none"
            />
          </div>

          {/* 생성 버튼 */}
          <button
            onClick={handleGeneratePlan}
            disabled={generating || !productName.trim()}
            className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl
                       hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all shadow-lg shadow-blue-500/25 text-lg"
          >
            {generating ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                AI 기획 생성 중...
              </span>
            ) : (
              'AI 기획 생성'
            )}
          </button>
        </div>
      </div>

      {/* ═══ AI Plan Display ═══ */}
      {currentPlan && aiPlan && (
        <div className="space-y-6">
          {/* 캠페인 개요 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">1</span>
              캠페인 개요
            </h3>
            <div className="space-y-3">
              <div>
                <span className="text-sm text-slate-500">캠페인명</span>
                <p className="text-lg font-semibold text-slate-800">{aiPlan.campaign_name}</p>
              </div>
              <div>
                <span className="text-sm text-slate-500">목표 (Objective)</span>
                <p className="text-slate-700">{aiPlan.objective}</p>
              </div>
              <div>
                <span className="text-sm text-slate-500">전략 요약</span>
                <p className="text-slate-700 leading-relaxed">{aiPlan.strategy_summary}</p>
              </div>
            </div>
          </div>

          {/* 타겟 오디언스 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center text-sm font-bold">2</span>
              타겟 오디언스
            </h3>
            {aiPlan.target_audience && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-slate-500">연령대</span>
                  <p className="font-medium">{aiPlan.target_audience.age_min}세 ~ {aiPlan.target_audience.age_max}세</p>
                </div>
                <div>
                  <span className="text-sm text-slate-500">성별</span>
                  <p className="font-medium">
                    {aiPlan.target_audience.genders?.map((g: string) => (g === 'male' ? '남성' : g === 'female' ? '여성' : g)).join(', ')}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <span className="text-sm text-slate-500">관심사</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {aiPlan.target_audience.interests?.map((interest: string, i: number) => (
                      <span key={i} className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm font-medium">
                        {interest}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-sm text-slate-500">지역</span>
                  <p className="font-medium">{aiPlan.target_audience.locations?.join(', ')}</p>
                </div>
                {aiPlan.target_audience.custom_audiences && (
                  <div className="md:col-span-2">
                    <span className="text-sm text-slate-500">커스텀 오디언스 전략</span>
                    <p className="text-slate-700 text-sm mt-1">{aiPlan.target_audience.custom_audiences}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 예산 & 일정 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center text-sm font-bold">3</span>
              예산 &amp; 일정
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-emerald-50 rounded-xl p-4 text-center">
                <span className="text-sm text-emerald-600">일일 예산</span>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{formatKRW(aiPlan.budget?.daily_budget)}</p>
              </div>
              <div className="bg-emerald-50 rounded-xl p-4 text-center">
                <span className="text-sm text-emerald-600">총 예산</span>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{formatKRW(aiPlan.budget?.total_budget)}</p>
              </div>
              <div className="bg-emerald-50 rounded-xl p-4 text-center">
                <span className="text-sm text-emerald-600">캠페인 기간</span>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{aiPlan.budget?.duration_days}일</p>
              </div>
            </div>
            {aiPlan.budget?.budget_rationale && (
              <p className="text-sm text-slate-600 mt-3">{aiPlan.budget.budget_rationale}</p>
            )}
            {aiPlan.scheduling && (
              <div className="mt-4 space-y-2">
                <div>
                  <span className="text-sm text-slate-500">추천 시작 시점</span>
                  <p className="text-slate-700">{aiPlan.scheduling.start_suggestion}</p>
                </div>
                <div>
                  <span className="text-sm text-slate-500">최적 노출 시간대</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {aiPlan.scheduling.best_times?.map((t: string, i: number) => (
                      <span key={i} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">{t}</span>
                    ))}
                  </div>
                </div>
                {aiPlan.scheduling.scheduling_rationale && (
                  <p className="text-sm text-slate-600 mt-1">{aiPlan.scheduling.scheduling_rationale}</p>
                )}
              </div>
            )}
          </div>

          {/* 소재 형식 추천 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center text-sm font-bold">4</span>
              소재 형식 추천
            </h3>
            {aiPlan.creative_format && (
              <div>
                {aiPlan.creative_format.format === 'short_form_video' ? (
                  <div>
                    <span className="inline-block px-4 py-1.5 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-full font-bold text-sm mb-3">
                      숏폼 영상 추천
                    </span>
                    <p className="text-slate-700 mb-4">{aiPlan.creative_format.format_reason}</p>

                    {/* Video Script Timeline */}
                    {aiPlan.video_script && aiPlan.video_script.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="font-semibold text-slate-700">영상 스크립트</h4>
                        {aiPlan.video_script.map((scene: any, i: number) => (
                          <div key={i} className="flex gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                            <div className="flex-shrink-0 w-16 text-center">
                              <div className="w-10 h-10 mx-auto bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                                {scene.scene_number}
                              </div>
                              <span className="text-xs text-slate-500 mt-1 block">{scene.duration_seconds}초</span>
                            </div>
                            <div className="flex-1 space-y-1.5">
                              <p className="text-sm text-slate-700"><span className="font-medium text-slate-500">화면:</span> {scene.visual_description}</p>
                              {scene.text_overlay && (
                                <p className="text-sm text-blue-700 font-medium">텍스트: &quot;{scene.text_overlay}&quot;</p>
                              )}
                              {scene.narration && (
                                <p className="text-sm text-slate-600"><span className="font-medium text-slate-500">내레이션:</span> {scene.narration}</p>
                              )}
                              {scene.music_mood && (
                                <p className="text-xs text-slate-500">BGM: {scene.music_mood}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <span className="inline-block px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-full font-bold text-sm mb-3">
                      이미지 광고 추천
                    </span>
                    <p className="text-slate-700 mb-4">{aiPlan.creative_format.format_reason}</p>

                    {aiPlan.image_concept && (
                      <div className="space-y-3">
                        <div>
                          <span className="text-sm text-slate-500">구도</span>
                          <p className="text-slate-700">{aiPlan.image_concept.composition}</p>
                        </div>
                        {aiPlan.image_concept.color_scheme && (
                          <div>
                            <span className="text-sm text-slate-500">컬러 스킴</span>
                            <div className="flex gap-2 mt-1">
                              {aiPlan.image_concept.color_scheme.map((color: string, i: number) => (
                                <div key={i} className="flex items-center gap-1.5">
                                  <div className="w-6 h-6 rounded-md border border-slate-200" style={{ backgroundColor: color }} />
                                  <span className="text-xs text-slate-600">{color}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {aiPlan.image_concept.key_elements && (
                          <div>
                            <span className="text-sm text-slate-500">핵심 요소</span>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {aiPlan.image_concept.key_elements.map((el: string, i: number) => (
                                <span key={i} className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm">{el}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <span className="text-sm text-slate-500">무드</span>
                          <p className="text-slate-700">{aiPlan.image_concept.mood}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 광고 카피 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-rose-100 text-rose-600 rounded-lg flex items-center justify-center text-sm font-bold">5</span>
              광고 카피
            </h3>
            {aiPlan.ad_copies && (
              <div className="space-y-4">
                {aiPlan.ad_copies.map((copy: any, i: number) => (
                  <div key={i} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded text-xs font-bold">{copy.variant || `변형 ${i + 1}`}</span>
                      {copy.cta && (
                        <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-xs">{copy.cta}</span>
                      )}
                    </div>
                    <p className="text-lg font-bold text-slate-800 mb-1">{copy.headline}</p>
                    <p className="text-slate-700 text-sm mb-1">{copy.primary_text}</p>
                    {copy.description && (
                      <p className="text-xs text-slate-500">{copy.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ═══ Creative Brief Section ═══ */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-4">소재 제작 브리프</h3>

            {!creativeBrief ? (
              <button
                onClick={handleGenerateCreative}
                disabled={creatingCreative}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-xl
                           hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all shadow-lg shadow-purple-500/25"
              >
                {creatingCreative ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    소재 브리프 생성 중...
                  </span>
                ) : (
                  '소재 제작 브리프 생성'
                )}
              </button>
            ) : (
              <div className="space-y-4">
                <p className="text-slate-700">{creativeBrief.overall_direction}</p>

                {/* Video Brief */}
                {creativeBrief.brief_type === 'short_form_video' && creativeBrief.scenes && (
                  <div className="space-y-4">
                    <h4 className="font-semibold text-slate-700">상세 씬 브리프</h4>
                    {creativeBrief.scenes.map((scene: any, i: number) => (
                      <div key={i} className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                            {scene.scene_number}
                          </span>
                          <span className="font-semibold text-purple-800">{scene.scene_name || `장면 ${scene.scene_number}`}</span>
                          <span className="text-sm text-purple-600">{scene.duration_seconds}초</span>
                        </div>
                        <div className="ml-11 space-y-1.5 text-sm">
                          {scene.camera_angle && <p><span className="font-medium text-slate-500">카메라:</span> {scene.camera_angle}</p>}
                          <p><span className="font-medium text-slate-500">화면:</span> {scene.visual_description}</p>
                          {scene.text_overlay && (
                            <p className="text-purple-700 font-medium">
                              텍스트: &quot;{typeof scene.text_overlay === 'object' ? scene.text_overlay.text : scene.text_overlay}&quot;
                              {typeof scene.text_overlay === 'object' && scene.text_overlay.position && (
                                <span className="text-xs text-purple-500 ml-2">({scene.text_overlay.position}, {scene.text_overlay.animation})</span>
                              )}
                            </p>
                          )}
                          {scene.narration && <p><span className="font-medium text-slate-500">내레이션:</span> {scene.narration}</p>}
                          {scene.transition && <p className="text-xs text-slate-500">전환: {scene.transition}</p>}
                          {scene.sound_effects && <p className="text-xs text-slate-500">효과음: {scene.sound_effects}</p>}
                        </div>
                      </div>
                    ))}

                    {/* Music Direction */}
                    {creativeBrief.music_direction && (
                      <div className="p-4 bg-indigo-50 rounded-xl">
                        <h4 className="font-semibold text-indigo-800 mb-2">음악 디렉션</h4>
                        <div className="text-sm space-y-1">
                          <p><span className="font-medium">장르:</span> {creativeBrief.music_direction.genre}</p>
                          <p><span className="font-medium">BPM:</span> {creativeBrief.music_direction.bpm_range}</p>
                          <p><span className="font-medium">분위기:</span> {creativeBrief.music_direction.mood_progression}</p>
                        </div>
                      </div>
                    )}

                    {/* Thumbnail */}
                    {creativeBrief.thumbnail_concept && (
                      <div className="p-4 bg-slate-50 rounded-xl">
                        <h4 className="font-semibold text-slate-700 mb-2">썸네일 콘셉트</h4>
                        <p className="text-sm text-slate-700">{creativeBrief.thumbnail_concept.description}</p>
                        {creativeBrief.thumbnail_concept.color_scheme && (
                          <div className="flex gap-2 mt-2">
                            {creativeBrief.thumbnail_concept.color_scheme.map((c: string, i: number) => (
                              <div key={i} className="w-8 h-8 rounded-lg border border-slate-200" style={{ backgroundColor: c }} title={c} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Image Brief */}
                {creativeBrief.brief_type === 'image' && creativeBrief.variants && (
                  <div className="space-y-4">
                    <h4 className="font-semibold text-slate-700">이미지 변형 콘셉트</h4>
                    {creativeBrief.variants.map((variant: any, i: number) => (
                      <div key={i} className="p-4 bg-green-50 rounded-xl border border-green-100">
                        <h5 className="font-bold text-green-800 mb-2">{variant.variant_name}</h5>
                        <p className="text-sm text-slate-700 mb-3">{variant.concept}</p>

                        {/* Color Palette */}
                        {variant.color_palette && variant.color_palette.length > 0 && (
                          <div className="mb-3">
                            <span className="text-xs text-slate-500 font-medium">컬러 팔레트</span>
                            <div className="flex gap-2 mt-1">
                              {variant.color_palette.map((c: any, ci: number) => (
                                <div key={ci} className="flex items-center gap-1.5">
                                  <div
                                    className="w-8 h-8 rounded-lg border border-slate-200"
                                    style={{ backgroundColor: typeof c === 'string' ? c : c.hex }}
                                    title={typeof c === 'string' ? c : `${c.name}: ${c.usage}`}
                                  />
                                  <div className="text-xs">
                                    <p className="text-slate-600">{typeof c === 'string' ? c : c.hex}</p>
                                    {typeof c === 'object' && c.name && (
                                      <p className="text-slate-400">{c.name}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {variant.image_prompt && (
                          <div className="p-3 bg-white rounded-lg border border-green-200">
                            <span className="text-xs text-slate-500 font-medium">AI 이미지 프롬프트</span>
                            <p className="text-sm text-slate-700 mt-1">{variant.image_prompt}</p>
                          </div>
                        )}

                        {variant.key_elements && variant.key_elements.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {variant.key_elements.map((el: string, ei: number) => (
                              <span key={ei} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">{el}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Production Notes */}
                {creativeBrief.production_notes && (
                  <div className="p-4 bg-yellow-50 rounded-xl">
                    <h4 className="font-semibold text-yellow-800 mb-2">제작 시 주의사항</h4>
                    <ul className="space-y-1">
                      {creativeBrief.production_notes.map((note: string, i: number) => (
                        <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                          <span className="text-yellow-500 mt-0.5">&#8226;</span>
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ═══ Draft Campaign Creation ═══ */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-4">Meta 광고 캠페인 생성</h3>

            <p className="text-sm text-slate-500 mb-4">
              Meta 광고 관리자에서 PAUSED 상태로 생성됩니다. 소재 업로드 후 활성화하세요.
            </p>

            {!draftResult && !draftError && (
              <button
                onClick={handleCreateDraft}
                disabled={creatingDraft}
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl
                           hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all shadow-lg shadow-amber-500/25 text-lg"
              >
                {creatingDraft ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    DRAFT 캠페인 생성 중...
                  </span>
                ) : (
                  '광고 집행으로 넘어가기 (DRAFT 캠페인 생성)'
                )}
              </button>
            )}

            {/* Draft Success */}
            {draftResult && (
              <div className="p-5 bg-green-50 border border-green-200 rounded-xl">
                <h4 className="text-lg font-bold text-green-800 mb-2">캠페인이 생성되었습니다!</h4>
                <div className="space-y-1.5 text-sm">
                  <p className="text-green-700"><span className="font-medium">캠페인 ID:</span> {draftResult.campaign_id}</p>
                  {draftResult.adset_id && (
                    <p className="text-green-700"><span className="font-medium">광고 세트 ID:</span> {draftResult.adset_id}</p>
                  )}
                  {draftResult.campaign_url && (
                    <a
                      href={draftResult.campaign_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
                    >
                      Meta 광고 관리자에서 보기
                    </a>
                  )}
                </div>
                <p className="text-xs text-green-600 mt-3">{draftResult.message}</p>
              </div>
            )}

            {/* Draft Error */}
            {draftError && (
              <div className="p-5 bg-red-50 border border-red-200 rounded-xl">
                <h4 className="text-lg font-bold text-red-800 mb-2">캠페인 생성 실패</h4>
                <p className="text-sm text-red-700 mb-3">{draftError}</p>
                <button
                  onClick={() => {
                    setDraftError(null);
                    handleCreateDraft();
                  }}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium text-sm"
                >
                  다시 시도
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ 기획 히스토리 ═══ */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-xl font-bold text-slate-800 mb-4">기획 히스토리</h3>

        {loadingPlans ? (
          <div className="flex justify-center py-8">
            <svg className="animate-spin h-6 w-6 text-blue-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : plans.length === 0 ? (
          <p className="text-center text-slate-500 py-8">아직 생성된 기획서가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-2 font-semibold text-slate-600">날짜</th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-600">제품명</th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-600">목표</th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-600">상태</th>
                  <th className="text-right py-3 px-2 font-semibold text-slate-600">액션</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => {
                  const statusInfo = STATUS_LABELS[plan.status] || STATUS_LABELS.draft;
                  const goalLabel = GOAL_OPTIONS.find((g) => g.value === plan.campaign_goal)?.label || plan.campaign_goal;
                  return (
                    <tr key={plan.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                      <td className="py-3 px-2 text-slate-600">
                        {plan.created_at ? new Date(plan.created_at).toLocaleDateString('ko-KR') : '-'}
                      </td>
                      <td className="py-3 px-2 font-medium text-slate-800">{plan.product_name}</td>
                      <td className="py-3 px-2 text-slate-600">{goalLabel}</td>
                      <td className="py-3 px-2">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right space-x-2">
                        <button
                          onClick={() => handleViewPlan(plan.id)}
                          className="px-3 py-1 text-blue-600 hover:bg-blue-50 rounded-lg transition text-xs font-medium"
                        >
                          보기
                        </button>
                        <button
                          onClick={() => handleDeletePlan(plan.id)}
                          className="px-3 py-1 text-red-500 hover:bg-red-50 rounded-lg transition text-xs font-medium"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
