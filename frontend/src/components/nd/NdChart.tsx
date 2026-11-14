/* eslint-disable */
'use client';
// 널담 디자인 기준 2 — 그래프 부품. 정본: nuldam-design-system/cosmos/NdChart.tsx (각 저장소에 그대로 복사).
// Recharts 2.10 이상과 3.x, React 18·19 에서 같이 쓴다. Recharts 를 직접 불러오지 않고
// "속성 묶음"과 "내용 부품"만 내보내므로 버전에 묶이지 않는다. 색은 nd-chart.css 의 변수.
// Recharts 가 없는 시스템은 같은 폴더의 NdColumns.tsx(세로 막대)를 쓴다.
//
//   const top = Math.max(...rows.map((r) => Math.max(r.actual, r.target)));
//   <ResponsiveContainer width="100%" height={300}>
//     <ComposedChart data={rows} margin={ndMargin} {...ndA11y('11월 누적 매출과 목표')}>
//       <CartesianGrid {...ndGrid} />
//       <XAxis dataKey="day" {...ndAxis.x} />
//       <YAxis {...ndAxis.y} {...ndScale(top, ndFmt.axisWonBy)} />
//       <Tooltip {...ndTooltip({ kind: 'line', value: ndFmt.won, mark: { target: 'dash' } })} />   // 점선 계열은 mark 로 알려 준다(Recharts 3)
//       <Legend {...ndLegend()} />
//       <Line dataKey="actual" name="실적" {...ndLine(1)} />
//       <Line dataKey="target" name="목표" {...ndLine('context', { dashed: true })} />   // 계획·목표·비교선은 색을 입혀도 점선, 실적만 실선
//       <ReferenceLine y={avg} {...ndRefLine()} label={ndRefLabel('평균')} />           // 기준선은 계열(Bar·Line) 뒤에 적는다(Recharts 2 는 적은 순서대로 덮는다)
//     </ComposedChart>
//   </ResponsiveContainer>
// ndA11y(그래프 이름 + 키보드로 말풍선 옮기기)는 의무가 아니다: 화면의 주된 그래프 하나에만 붙인다.
import * as React from 'react';

/* ───────── 색 ───────── */

export type NdSlot = 1 | 2 | 3 | 4 | 5 | 6 | 'context' | 'context-soft' | 'good' | 'warn' | 'bad';
type Slot = NdSlot | number | string;

const SURFACE = 'var(--nd-chart-surface)';

/**
 * 계열 색. 1~6 은 순서가 고정된 여섯 색이고, 일곱 번째 색은 만들지 않는다 — 6을 넘는 번호는 중립색('기타')으로 돌려준다.
 * 색은 "누구인가"를 따라간다: 같은 대상은 걸러 보기를 바꿔도 같은 번호를 쓴다(순위에 따라 다시 칠하지 않는다).
 * 'context' 는 비교 대상(목표·이전 기간·기타), 'context-soft' 는 바탕 띠·트랙 전용이다(값을 나르는 표시에 쓰지 않는다).
 * 'good'·'warn'·'bad' 는 뜻이 있을 때만 쓰고, 계열 2·4·6번과 한 그래프에 함께 쓰지 않는다.
 */
export function ndColor(slot: Slot): string {
  if (typeof slot === 'string') {
    if (slot === 'context') return 'var(--nd-chart-context)';
    if (slot === 'context-soft') return 'var(--nd-chart-context-soft)';
    if (slot === 'good') return 'var(--nd-good)';
    if (slot === 'warn') return 'var(--nd-warn)';
    if (slot === 'bad') return 'var(--nd-bad)';
    return slot; // 이미 색 값(var(...), #hex)이면 그대로
  }
  const n = Math.round(slot);
  return n >= 1 && n <= 6 ? `var(--nd-chart-${n})` : 'var(--nd-chart-context)';
}
/**
 * 0부터 세는 배열 순서를 계열 색으로(0→1번). 순서가 고정된 목록에만 쓴다 — 값으로 줄 세우거나 걸러 낸 배열에 쓰면
 * 같은 대상의 색이 바뀐다(그럴 때는 ndSlots). 여섯을 넘으면 모두 같은 중립색이 된다(선 그래프는 ndLineAt).
 */
export const ndColorAt = (index: number): string => ndColor(index + 1);
const cycle = (index: number, size: number): number => ((Math.round(index) % size) + size) % size;
/**
 * 선 그래프의 순번(0부터)을 색 번호로: 색 여섯을 돌려 쓴다(일곱 번째는 다시 1번). 색 번호를 받는 부품에 넘긴다 —
 * dot={ndIsolatedDot(rows, id, ndSlotAt(i))}. 막대·조각처럼 면을 칠할 때는 돌려 쓰지 않는다(ndColorAt: 일곱 번째부터 중립색).
 */
export const ndSlotAt = (index: number): NdSlot => (cycle(index, 6) + 1) as NdSlot;
/** 선 그래프의 순번(0부터)에 맞는 표식: 여섯 번째까지 짧은 선, 일곱 번째부터 긴 점선(ndLineAt 과 같은 규칙) */
export const ndMarkAt = (index: number): NdMark => (cycle(index, 12) >= 6 ? 'long' : 'line');
/**
 * 이름(id)에 색 번호를 한 번 정해 묶어 둔다. 화면 밖 상수로 두고 쓴다.
 *   const colorOf = ndSlots(['위탁', '사입', '오프라인', '해외']);
 *   fill={colorOf(row.name)}                         // 면(막대·조각·칩 바탕): 목록에 없거나 일곱 번째부터는 중립색
 * 계열이 일곱 이상일 수 있는 선 그래프는 색 여섯을 돌려 쓰고 일곱 번째부터 긴 점선으로 구분한다. 그래프와 그래프 밖 단추·칩이 같은 구분을 쓴다:
 *   <Line dataKey={id} {...colorOf.line(id)} dot={ndIsolatedDot(rows, id, colorOf.slot(id))} />
 *   <button …><NdKey {...colorOf.key(id)} />{id}</button>     // 칩·단추 안의 표식(색 + 긴 점선)
 *   <Tooltip {...ndTooltip({ mark: colorOf.marks })} />       // 말풍선 표식
 */
export function ndSlots(ids: readonly string[]) {
  const at = new Map<string, number>();
  ids.forEach((id, i) => { if (!at.has(id)) at.set(id, i); });
  const index = (id: string): number => at.get(id) ?? -1;
  const color = (id: string): string => { const i = index(id); return i >= 0 && i < 6 ? ndColor(i + 1) : ndColor('context'); };
  /** 선 그래프에서의 색 번호(돌려 쓴다). 목록에 없으면 'context' */
  const slot = (id: string): NdSlot => { const i = index(id); return i < 0 ? 'context' : ndSlotAt(i); };
  /** 선 속성: <Line {...colorOf.line(id)} /> */
  const line = (id: string, opt: Omit<LineOpt, 'dashed'> = {}) => { const i = index(id); return i < 0 ? ndLine('context', opt) : ndLineAt(i, opt); };
  /** 그래프 밖 단추·칩의 표식: <NdKey {...colorOf.key(id)} /> */
  const key = (id: string): { color: string; mark: NdMark } => { const i = index(id); return { color: ndColor(slot(id)), mark: i < 0 ? 'line' : ndMarkAt(i) }; };
  /** 말풍선 표식: ndTooltip({ mark: colorOf.marks }) */
  const marks = (item: NdTipItem): NdMark | undefined => { const i = index(String(item.dataKey ?? item.name ?? '')); return i < 0 ? undefined : ndMarkAt(i); };
  return Object.assign(color, { index, slot, line, key, marks });
}
/** HTML 요소(div 막대·칩·배지)에서 계열 색을 옅게: ndAlpha(1, 20). SVG 는 fillOpacity·strokeOpacity 를 쓴다 */
export const ndAlpha = (slot: Slot, percent: number): string => `color-mix(in srgb, ${ndColor(slot)} ${percent}%, transparent)`;
/**
 * 계열 색 면 안에 놓는 글자색(번호마다 흰색·검정 중 더 잘 읽히는 쪽). 밝은 화면의 5·6번 면에는 작은 글자를 넣지 않는다.
 * 'context'(일곱 번째부터의 중립색 포함)와 'good'·'warn'·'bad' 면도 화면마다 맞는 글자색이 따로 있다.
 */
export const ndOnFill = (slot: Slot): string => {
  if (typeof slot === 'number') {
    const n = Math.round(slot);
    return n >= 1 && n <= 6 ? `var(--nd-chart-on-${n})` : 'var(--nd-chart-on-context)';
  }
  if (slot === 'context' || slot === 'context-soft') return 'var(--nd-chart-on-context)';
  if (slot === 'good' || slot === 'warn' || slot === 'bad') return 'var(--nd-chart-on-status)';
  return 'var(--nd-chart-on-fill)';
};

const seqStep = (step: number): number => Math.min(5, Math.max(1, Math.round(step)));
/** 한 색의 단계(1 옅음~5 진함): 순서가 있는 묶음(단계, 등급, 연령대)에 쓴다 */
export const ndSeq = (step: number): string => `var(--nd-seq-${seqStep(step)})`;
/** 단계 색 면 안의 글자색 */
export const ndSeqText = (step: number): string => `var(--nd-seq-on-${seqStep(step)})`;

const heatLevel = (ratio: number): number => (!(ratio > 0) ? 0 : Math.min(6, Math.max(1, Math.ceil(ratio * 6))));
/** 히트맵 칸(0 빈 칸~6 가장 큼). ratio 는 0~1 */
export const ndHeat = (ratio: number): string => `var(--nd-heat-${heatLevel(ratio)})`;
/** 히트맵 칸 안 글자색: 단계마다 정해 둔 색(모든 단계에서 명도 대비 4.5:1 이상) */
export const ndHeatText = (ratio: number): string => `var(--nd-heat-on-${heatLevel(ratio)})`;
/** 기준보다 아래(-2,-1) · 같음(0) · 위(1,2) */
export const ndDiv = (k: number): string =>
  k <= -2 ? 'var(--nd-div-neg-2)' : k === -1 ? 'var(--nd-div-neg-1)' : k === 1 ? 'var(--nd-div-pos-1)' : k >= 2 ? 'var(--nd-div-pos-2)' : 'var(--nd-div-mid)';

/**
 * 쌓은 막대·면의 계열이 일곱 이상일 때 화면에서 상위 다섯 + '기타'로 접는다(합계가 큰 순).
 *   const { rows, keys } = ndFold(data, allKeys);   // keys 의 마지막이 '기타'. 색은 1~5번과 'context'
 */
export function ndFold<T extends Record<string, any>>(rows: readonly T[], keys: readonly string[], keep = 5, other = '기타'): { rows: Record<string, any>[]; keys: string[] } {
  if (keys.length <= keep + 1) return { rows: rows.map((r) => ({ ...r })), keys: [...keys] };
  const total = (k: string): number => rows.reduce((a, r) => a + (typeof r[k] === 'number' && isFinite(r[k]) ? Math.abs(r[k]) : 0), 0);
  // 자료에 이미 '기타' 계열이 있으면 그것은 늘 접히는 쪽이다(남기면 접은 합이 그 값을 덮어쓰고 이름이 둘이 된다)
  const ranked = keys.map((k, i) => ({ k, i, t: total(k) })).filter((x) => x.k !== other).sort((a, b) => b.t - a.t || a.i - b.i);
  const kept = ranked.slice(0, keep).sort((a, b) => a.i - b.i).map((x) => x.k); // 남는 다섯은 원래 순서를 지킨다
  const rest = keys.filter((k) => !kept.includes(k));
  return {
    keys: [...kept, other],
    rows: rows.map((r) => {
      const out: Record<string, any> = { ...r };
      let sum = 0;
      for (const k of rest) { if (typeof r[k] === 'number' && isFinite(r[k])) sum += r[k]; delete out[k]; }
      out[other] = sum;
      return out;
    }),
  };
}

/* ───────── 움직임 ───────── */

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** 그래프가 처음 그려질 때 한 번, 짧게. 움직임 줄이기 설정이면 끈다 */
export function ndAnim(): { isAnimationActive: boolean; animationDuration: number; animationEasing: 'ease-out' } {
  return { isAnimationActive: !reducedMotion(), animationDuration: 500, animationEasing: 'ease-out' };
}

/* ───────── 글자 폭 어림 ───────── */

// Pretendard 를 11px·자릿수 맞춤으로 그려 잰 폭을 글자 크기로 나눈 값(2026-11-14 실측)
const emOf = (c: string): number => {
  if (c >= '0' && c <= '9') return 0.615;
  if (c === ',' || c === '.' || c === ':' || c === '·' || c === "'") return 0.254;
  if (c === ' ') return 0.26;
  if (c === '-') return 0.433;
  if (c === '/' || c === '(' || c === ')') return 0.341;
  if (c === '%') return 0.863;
  if (c === '+') return 0.701;
  if (c === '…') return 0.762;
  if (c >= 'a' && c <= 'z') return 0.52;
  if (c >= 'A' && c <= 'Z') return 0.66;
  return c.charCodeAt(0) < 0x2e80 ? 0.6 : 0.875; // 한글·한자는 거의 정사각
};
/** 글자열을 그렸을 때의 폭(px) 어림값. 눈금 자리 계산용 */
export const ndTextWidth = (text: string, fontSize = 11): number => {
  let w = 0;
  for (const c of text) w += emOf(c);
  return w * fontSize;
};
/** 주어진 폭(px)에 한 줄로 들어가게 자르고 끝에 … 를 붙인다 */
export const ndFit = (text: string, px: number, fontSize = 11): string => {
  if (ndTextWidth(text, fontSize) <= px) return text;
  const room = px - emOf('…') * fontSize;
  let out = '';
  let w = 0;
  for (const c of text) {
    w += emOf(c) * fontSize;
    if (w > room) break;
    out += c;
  }
  return `${out.replace(/\s+$/, '')}…`;
};
/** 줄이지 않은 긴 숫자를 세로축 눈금에 쓸 때의 축 너비: <YAxis {...ndAxis.y} width={ndAxisWidth('1,000,000,000')} /> */
export const ndAxisWidth = (longest: string, fontSize = 11): number => Math.ceil(ndTextWidth(longest, fontSize)) + 10;

/* ───────── 축 · 격자 · 여백 ───────── */

// 눈금 글자의 크기와 자릿수 맞춤은 여기서 준다(nd-chart.css 는 글꼴과 색만 맞춘다 — 아직 옮기지 않은 그래프의 글자를
// 키우거나 넓히지 않으려고. 자릿수 맞춤만으로도 숫자 폭이 4~7% 늘어, 빠듯하게 맞춰 둔 세로축의 첫 글자가 잘린다)
const TABULAR = { fontVariantNumeric: 'tabular-nums' as const };
const TICK = { fontSize: 11, fill: 'var(--nd-chart-tick)', style: TABULAR };
// 가로 막대의 항목 이름은 12px 보조색. nd-chart.css 의 눈금 색 규칙을 이기려고 style 로도 준다.
// style 의 크기는 반드시 단위를 붙인 글자열이다: Recharts 는 줄바꿈 폭을 잴 때 이 style 을 쓰는데, 숫자 12 는 무시되어 본문 크기로 재고 이름을 두 줄로 꺾는다
const CATEGORY_TICK = { fontSize: 12, fill: 'var(--nd-fg-2)', style: { fontSize: '12px', fill: 'var(--nd-fg-2)', ...TABULAR } };
const AXIS_LINE = { stroke: 'var(--nd-chart-axis)' };

/**
 * 기본 여백. 끝점 값 이름표(ndEndLabel)를 달면 right 를 56 으로, 가로 막대에 값 글자(ndValueLabel)를 달면 right 를 48 로,
 * 세로 막대에 값 글자를 달면 top 을 24 로 넓힌다(가장 큰 막대가 맨 위 눈금에 닿으면 그 값 글자가 위에서 잘린다)
 */
export const ndMargin = { top: 8, right: 12, bottom: 0, left: 0 };
/**
 * 가로 막대(layout="vertical")의 여백. 값 축의 끝 눈금 글자는 그림 오른쪽 끝에 가운데를 맞춰 놓여 절반이 밖으로 나가므로
 * right 가 24 다(기본 12 에서는 「600만」이 잘린다). 값 글자(ndValueLabel)를 달면 { ...ndMarginH, right: 48 }
 */
export const ndMarginH = { top: 8, right: 24, bottom: 0, left: 0 };
/** 가로 막대 그래프의 높이: 항목 하나에 28px(막대 16 + 틈 12) + 값 축 40px. <ResponsiveContainer height={ndBarsHeight(rows.length)}> */
export const ndBarsHeight = (count: number, row = 28): number => Math.max(1, Math.round(count)) * row + 40;

/* 기간 축(ndAxis.x)의 눈금 글자 고르기.
   Recharts 의 'equidistantPreserveStart' 는 첫 글자에서부터 건너뛰어, 끝 글자가 오른쪽 여백(12px)에 들어가지 않으면 간격을 늘리고
   가장 최근 글자를 빼 버린다(월 여덟 개에서 「2026-11」이 빠진다). 끝에서부터 같은 간격으로 고르는 값은 Recharts 3 에만 있다.
   그래서 글자를 모두 그린 다음(interval 0) 실제 폭을 재서 직접 고른다: 마지막(가장 최근) 글자는 늘 남기고, 거기서부터 같은 간격. */
const X_GAP = 12; // 이웃한 눈금 글자 사이에 남기는 틈(px)
const useLayout = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;
function arrangeTicks(group: Element): void {
  const texts = Array.from(group.querySelectorAll<SVGTextElement>('text.nd-x-tick'));
  const n = texts.length;
  if (!n) return;
  for (const t of texts) if (t.style.display) t.style.display = ''; // 숨겨 둔 글자는 폭을 잴 수 없다
  const svg = group.closest('svg');
  const full = svg ? Number(svg.getAttribute('width')) || svg.getBoundingClientRect().width : 0;
  const box = texts.map((t) => {
    const x = Number(t.getAttribute('x')) || 0;
    let w = 0;
    try { w = typeof t.getComputedTextLength === 'function' ? t.getComputedTextLength() : 0; } catch (e) { w = 0; }
    if (!(w > 0)) w = ndTextWidth(t.textContent ?? ''); // 화면에 없는 그래프(시험 환경 포함)는 어림값으로
    // 그림 밖으로 나가는 첫·끝 글자는 안쪽으로 민다(끝에서 1px 띄운다)
    const shift = full > 0 && x + w / 2 > full - 1 ? full - 1 - (x + w / 2) : x - w / 2 < 1 ? 1 + w / 2 - x : 0;
    return { left: x - w / 2 + shift, right: x + w / 2 + shift, shift };
  });
  let every = 1;
  for (; every < n; every++) {
    let ok = true;
    let edge = -Infinity;
    for (let i = (n - 1) % every; i < n && ok; i += every) {
      const b = box[i];
      if (!b) continue;
      if (b.left < edge + X_GAP) ok = false;
      edge = b.right;
    }
    if (ok) break;
  }
  texts.forEach((t, i) => {
    const show = (n - 1 - i) % every === 0;
    const shift = show ? box[i]?.shift ?? 0 : 0;
    const move = shift ? `translateX(${Math.round(shift * 10) / 10}px)` : '';
    if (t.style.transform !== move) t.style.transform = move;
    if (!show) t.style.display = 'none';
  });
}
// 한 축의 눈금 글자를 모두 담은 묶음: Recharts 2 는 …-axis-ticks, 3 은 글자만 따로 모은 …-axis-tick-labels. 이름이 또 바뀌어도 두 단계 위가 그 묶음이다
const tickGroup = (el: Element): Element | null => el.closest('.recharts-cartesian-axis-tick-labels, .recharts-cartesian-axis-ticks') ?? el.parentElement?.parentElement ?? null;
// 글꼴이 늦게 도착하면 글자 폭이 달라진다(대체 글꼴로 잰 폭으로 고르면 끝 글자가 2px 쯤 잘린다): 글꼴이 다 오면 화면의 기간 축을 모두 다시 고른다
let fontsWatched = false;
function watchFonts(): void {
  if (fontsWatched || typeof document === 'undefined') return;
  fontsWatched = true;
  const fonts = document.fonts;
  if (!fonts) return;
  const again = () => {
    const seen: Element[] = [];
    document.querySelectorAll('text.nd-x-tick').forEach((t) => {
      const g = tickGroup(t);
      if (g && seen.indexOf(g) < 0) { seen.push(g); arrangeTicks(g); }
    });
  };
  if (fonts.ready && typeof fonts.ready.then === 'function') fonts.ready.then(again, () => undefined);
  if (typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', again);
}
// 눈금 글자마다 부르지만 축 하나에 한 번만 돈다(그리기 직전에)
const arranging = typeof WeakSet !== 'undefined' ? new WeakSet<Element>() : null;
function scheduleTicks(el: Element | null): void {
  const group = el ? tickGroup(el) : null;
  if (!group) return;
  watchFonts();
  if (!arranging || typeof Promise === 'undefined') { arrangeTicks(group); return; }
  if (arranging.has(group)) return;
  arranging.add(group);
  Promise.resolve().then(() => { arranging.delete(group); arrangeTicks(group); });
}
function NdXTick({ p }: { p: any }) {
  const ref = React.useRef<SVGTextElement | null>(null);
  useLayout(() => { scheduleTicks(ref.current); });
  const raw = p?.payload?.value;
  const text = String((typeof p?.tickFormatter === 'function' ? p.tickFormatter(raw, p?.index) : raw) ?? '');
  return (
    <text ref={ref} className="recharts-text recharts-cartesian-axis-tick-value nd-x-tick" x={p?.x} y={p?.y} dy="0.71em" textAnchor="middle" fontSize={11} fill="var(--nd-chart-tick)" style={TABULAR}>
      {text}
    </text>
  );
}
// Recharts 는 tick 함수를 부품이 아니라 함수로 부른다(그 안에서는 React 훅을 쓸 수 없다). 부품을 돌려준다
const xTick = (p: any) => <NdXTick p={p} />;

const X_AXIS = { axisLine: AXIS_LINE, tickLine: false, tickSize: 0, tickMargin: 12, tick: xTick, interval: 0 as const };
const categoryOf = (width = 96) => ({
  axisLine: false, tickLine: false, tickSize: 0, tickMargin: 8, width, tick: CATEGORY_TICK,
  // 항목 이름은 하나도 빼지 않는다(없으면 Recharts 3 이 이름을 하나 걸러 하나씩 건너뛴다). 항목이 많으면 높이를 ndBarsHeight 로 늘린다
  interval: 0 as const,
  // Recharts 는 폭을 넘는 이름을 낱말 단위로 두세 줄로 꺾어 이웃 줄에 붙인다. 한 줄로 자른다(전체 이름은 말풍선에 나온다)
  tickFormatter: (v: any): string => ndFit(String(v ?? ''), width - 12, 12),
});
/**
 * 세로 막대의 항목 이름 한 칸. 이름은 하나도 빼지 않고, 폭(labelWidth)과 "그 칸의 폭" 중 좁은 쪽에 맞춰 … 로 자른다.
 * 칸 폭을 보지 않으면 좁은 화면(400px 에 항목 일곱 개)에서 이웃 이름끼리 겹친다. 잘린 이름은 올리면 전체가 나온다.
 */
function bandTick(labelWidth: number) {
  return function NdBandTick(p: any) {
    const raw = p?.payload?.value;
    const full = String((typeof p?.tickFormatter === 'function' ? p.tickFormatter(raw, p?.index) : raw) ?? '');
    const count = Number(p?.visibleTicksCount);
    const slot = count > 0 && Number(p?.width) > 0 ? Number(p.width) / count : labelWidth;
    // 칸에 들어가는 이름은 손대지 않는다. 넘칠 때만 이웃과 4px 떨어지게 자른다
    let text = ndTextWidth(full) <= Math.min(labelWidth, slot - 1) ? full : ndFit(full, Math.min(labelWidth, slot - 4));
    // 두 글자도 남지 않으면 자른 것이 더 나쁘다(「12월」→「1…」): 짧은 이름은 그대로, 긴 이름은 앞 두 글자까지만 줄인다
    const chars = Array.from(full);
    if (text !== full && Array.from(text).length < 3) text = chars.length <= 3 ? full : `${chars.slice(0, 2).join('')}…`;
    return (
      <text className="recharts-text recharts-cartesian-axis-tick-value" x={p?.x} y={p?.y} dy="0.71em" textAnchor="middle" fontSize={11} fill="var(--nd-chart-tick)" style={TABULAR}>
        {text}
        {text !== full ? <title>{full}</title> : null}
      </text>
    );
  };
}
const bandOf = (labelWidth = 58) => ({
  axisLine: AXIS_LINE, tickLine: false, tickSize: 0, tickMargin: 12, tick: bandTick(labelWidth), interval: 0 as const,
});

export const ndAxis = {
  /**
   * 기간 축(날짜·주·월·시간이 가로축인 그래프 — 선이든 막대든): 바닥선만 남기고, 눈금 글자는 자리가 모자라면 같은 간격으로 건너뛴다.
   * 마지막(가장 최근) 글자는 늘 남는다. 그림 밖으로 나가는 첫·끝 글자는 안쪽으로 밀어 그린다
   */
  x: X_AXIS,
  /** 세로축이 없는 그래프의 가로축: 첫·끝 눈금 글자가 잘리지 않게 안쪽 여백을 둔다 */
  xBare: { ...X_AXIS, padding: { left: 16, right: 16 } },
  /**
   * 세로 막대의 항목 축(가로축 전용, 기간이 아닌 항목: 채널·부서·상품): 항목 이름을 하나도 빼지 않고, 긴 이름은 칸 폭에 맞춰 … 로 자른다.
   * 항목이 일곱을 넘거나 이름이 여섯 자를 넘으면 가로 막대로. 날짜·주·월이 가로축이면 막대여도 ndAxis.x 를 쓴다
   */
  band: bandOf(),
  /** 항목 이름 폭의 상한(px)을 정해 쓰는 항목 축: ndAxis.bandOf(72) */
  bandOf,
  /** 세로축(값): 선 없이 눈금 글자만, 눈금은 다섯 개 안팎. 글자가 들어갈 폭은 44px(줄이지 않은 긴 숫자는 width={ndAxisWidth(…)}) */
  y: { axisLine: false, tickLine: false, tickSize: 0, tickMargin: 8, width: 52, tickCount: 5, tick: TICK },
  /** 가로 막대의 항목 축(왼쪽에 이름, 폭 96). 이름을 하나도 빼지 않고, 긴 이름은 한 줄로 자른다 */
  category: categoryOf(),
  /** 이름 폭을 정해 쓰는 가로 막대의 항목 축: ndAxis.categoryOf(128) */
  categoryOf,
  /** 가로 막대의 값 축(아래). 그래프 여백은 ndMarginH(끝 눈금 글자가 오른쪽으로 반쯤 나간다) */
  value: { axisLine: false, tickLine: false, tickSize: 0, tickMargin: 12, tickCount: 5, tick: TICK },
  /** 방사형 그래프의 항목 축: <PolarAngleAxis dataKey="k" {...ndAxis.angle} /> — 높이 200px 미만이면 <RadarChart outerRadius="70%"> (항목 이름이 위아래에서 잘린다) */
  angle: { axisLine: false, tickLine: false, tick: TICK },
  /**
   * 방사형 그래프의 값 축: <PolarRadiusAxis {...ndAxis.radius} />
   * 눈금 글자는 동심선 바로 아래·축 오른쪽에 놓는다(선 위에 두면 맨 바깥 눈금이 위쪽 항목 이름과 겹친다)
   */
  radius: { axisLine: false, tick: { ...TICK, dx: 4, dy: 12 }, tickCount: 5, angle: 90 },
};
/** 격자: 가로 실선만(점선 금지) */
export const ndGrid = { vertical: false, stroke: 'var(--nd-chart-grid)' };
/** 가로 막대용 격자: 세로 실선만 */
export const ndGridVertical = { horizontal: false, stroke: 'var(--nd-chart-grid)' };

/**
 * 0 을 지나는 반듯한 눈금(1·2·2.5·5 단위). count 는 칸 수의 어림값.
 * 가장 큰 값과 작은 값이 정수면 눈금도 정수로 맞춘다(건수 1건에 0.25건 눈금이 생기지 않게). 0~1 비율처럼 소수 눈금이 맞는 자료는 fraction 을 true 로
 */
export function ndNiceTicks(max: number, count = 4, min = 0, fraction = false): number[] {
  const hi = Math.max(0, isFinite(max) ? max : 0);
  const lo = Math.min(0, isFinite(min) ? min : 0);
  if (!(hi > lo)) return [0, 1];
  const raw = (hi - lo) / Math.max(1, count);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = [1, 2, 2.5, 5, 10].find((u) => u * pow >= raw * (1 - 1e-9)) ?? 10;
  let step = unit * pow;
  if (!fraction && Number.isInteger(hi) && Number.isInteger(lo) && !Number.isInteger(step)) step = step < 1 ? 1 : Math.ceil(step / 5) * 5; // 정수 자료는 눈금도 정수
  const from = Math.floor(lo / step + 1e-9);
  const to = Math.ceil(hi / step - 1e-9);
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(Number((i * step).toPrecision(12)));
  return out;
}
/**
 * 값 축을 반듯한 눈금과 한 가지 단위로: <YAxis {...ndAxis.y} {...ndScale(top, ndFmt.axisWonBy)} />
 * top 은 그 축에 그려지는 가장 큰 값(쌓은 막대면 쌓은 합). 음수가 있으면 가장 작은 값을 셋째 인자로 넘긴다.
 * 0~1 비율 자료는 넷째 인자로 소수 눈금을 허락한다(없으면 최댓값이 정확히 1 일 때 눈금이 0%·100% 둘뿐이 된다):
 *   <YAxis {...ndAxis.y} {...ndScale(top, () => ndFmt.pctOf('auto', true), 0, { fraction: true })} />
 * 눈금을 스스로 계산하는 그래프(로그 눈금, 0 에서 시작하지 않는 좁은 범위)는 ndScale 을 쓰지 않고 {...ndAxis.y} 뒤에
 * ticks·domain·tickFormatter 를 그대로 넘긴다(한 축에 단위 하나는 지킨다).
 */
export function ndScale(max: number, by: (max: number) => (v: any) => string = ndFmt.axisNumBy, min = 0, opt: { fraction?: boolean } = {}) {
  const ticks = ndNiceTicks(max, 4, min, !!opt.fraction);
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;
  return { ticks, domain: [lo, hi] as [number, number], tickFormatter: by(Math.max(Math.abs(lo), Math.abs(hi))) };
}

/* ───────── 선 · 면 ───────── */

/** 비교선(목표·계획·이전 기간)의 짧은 점선. 2~6번 색을 입힌 계획·목표·비교선도 점선이다 — 실선은 실적만 */
export const ND_DASH = '4 4';
/** 일곱 번째 계열부터 쓰는 긴 점선(색 여섯을 한 바퀴 돈 뒤) */
export const ND_DASH_LONG = '12 6';

type LineOpt = {
  /** true 는 비교선의 짧은 점선, 'long' 은 일곱 번째 계열부터의 긴 점선 */
  dashed?: boolean | 'long';
  thin?: boolean;
  /** 계단선 */
  step?: boolean;
  /** 곡선으로 잇지 않고 곧게(월별·분기별처럼 점 사이가 뜻이 없는 값) */
  straight?: boolean;
};

const activeDot = (color: string) => ({ r: 4, fill: color, stroke: SURFACE, strokeWidth: 2 });

/**
 * 선: 2px, 둥근 끝, 점은 올렸을 때만. 비교용(목표·계획·이전 기간)은 ndLine('context', { dashed: true }).
 * 계획·목표 선이 여럿이라 색을 입혀야 하면 색을 입혀도 점선이다: ndLine(2, { dashed: true }). 실선은 실적만
 */
export function ndLine(slot: Slot, opt: LineOpt = {}) {
  const color = ndColor(slot);
  const dash = opt.dashed === 'long' ? ND_DASH_LONG : opt.dashed ? ND_DASH : '';
  return {
    type: (opt.step ? 'stepAfter' : opt.straight ? 'linear' : 'monotone') as 'stepAfter' | 'linear' | 'monotone',
    stroke: color,
    strokeWidth: opt.thin ? 1.5 : 2,
    // 실선일 때는 속성을 아예 내지 않는다(undefined 를 넘기면 exactOptionalPropertyTypes 를 켠 저장소의 Recharts 3 타입 검사에 걸린다)
    ...(dash ? { strokeDasharray: dash } : {}),
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    dot: false as const,
    activeDot: activeDot(color),
    ...ndAnim(),
  };
}
/**
 * 계열 수를 데이터가 정하는 선 그래프(0부터 세는 순번). 색 여섯을 돌려 쓰고 일곱 번째부터는 긴 점선으로 구분한다
 * (색 + 선 모양). 열둘까지 구분되고, 그보다 많으면 고르게 하거나 나눠 그린다.
 *   {ids.map((id, i) => <Line key={id} dataKey={id} {...ndLineAt(i)} />)}
 * 여섯 색은 이웃한 번호끼리만 구분이 검증돼 있다. 선이 서로 엇갈리는 그래프는 계열이 다섯 이상이면 켜고 끄기(useNdSeries)나
 * 끝점 이름표를 붙인다(어두운 화면의 1번·5번 선은 엇갈리면 가깝게 보인다).
 * 그래프 밖 단추·칩도 같은 구분을 쓴다: <NdKey slot={ndSlotAt(i)} mark={ndMarkAt(i)} /> (이름으로 묶었으면 ndSlots 의 line·key)
 */
export const ndLineAt = (index: number, opt: Omit<LineOpt, 'dashed'> = {}) =>
  ndLine(ndSlotAt(index), { ...opt, dashed: ndMarkAt(index) === 'long' ? 'long' : false });

// 면으로 읽히는 계열(쌓은 면·방사형)은 말풍선 표식도 범례처럼 네모여야 한다. Recharts 3 은 말풍선에 계열의 fill·stroke 만 넘기므로
// 면의 fill 을 "같은 색의 다른 표기"로 적어 알린다: var(--nd-chart-1) → var(--nd-chart-1, var(--nd-chart-context)). 그려지는 색은 같다.
const FACE = ', var(--nd-chart-context))';
const faceFill = (color: string): string => (/^var\([^,()]+\)$/.test(color) ? `${color.slice(0, -1)}${FACE}` : color);
const isFace = (fill: unknown): boolean => typeof fill === 'string' && fill.slice(-FACE.length) === FACE;

/** 면: 같은 색을 10%로 옅게 깐다(색에서 색으로 가는 그라디언트 금지). 쌓은 면은 범례·말풍선 표식이 네모, 혼자 쓰는 면은 선 */
export function ndArea(slot: Slot, opt: { stacked?: boolean; straight?: boolean } = {}) {
  const color = ndColor(slot);
  return {
    type: (opt.straight ? 'linear' : 'monotone') as 'linear' | 'monotone',
    stroke: color,
    strokeWidth: 2,
    fill: opt.stacked ? faceFill(color) : color,
    fillOpacity: opt.stacked ? 0.22 : 0.1,
    legendType: (opt.stacked ? 'rect' : 'line') as 'rect' | 'line',
    dot: false as const,
    activeDot: activeDot(color),
    ...ndAnim(),
  };
}

/**
 * 방사형 그래프의 한 계열: <Radar dataKey="a" name="올해" {...ndRadar(1)} /> — 비교 대상은 ndRadar('context'). 격자는 <PolarGrid /> 그대로(nd-chart.css 가 맞춘다).
 * 범례·말풍선 표식은 네모(면). 높이 200px 미만으로 그리면 <RadarChart outerRadius="70%"> (기본 80% 에서는 위아래 항목 이름이 잘린다)
 */
export function ndRadar(slot: Slot) {
  const color = ndColor(slot);
  return { stroke: color, strokeWidth: 2, fill: faceFill(color), fillOpacity: 0.1, legendType: 'rect' as const, dot: false as const, ...ndAnim() };
}

/**
 * 선의 마지막 점만 그린다: <Line dot={ndEndDot(rows.length, 1)} />
 * 뒤쪽 값이 비어 있으면 length 자리에 "값이 있는 마지막 순번 + 1"을 넘긴다. label 을 주면 점 오른쪽에 값을 적는다.
 */
export function ndEndDot(length: number, slot: Slot, opt: { label?: (value: any) => React.ReactNode; dot?: boolean } = {}) {
  const color = ndColor(slot);
  return function NdEndDot(p: any) {
    const key = p?.key ?? `nd-dot-${p?.index}`;
    if (!p || p.index !== length - 1 || p.cx == null || p.cy == null) return <g key={key} />;
    const value = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value;
    return (
      <g key={key}>
        {opt.dot === false ? null : <circle cx={p.cx} cy={p.cy} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />}
        {opt.label ? (
          <text className="nd-end-label" x={p.cx + 8} y={p.cy} dominantBaseline="central" fontSize={12} fontWeight={500} fill="var(--nd-fg)" stroke={SURFACE} strokeWidth={3} paintOrder="stroke">
            {opt.label(value)}
          </text>
        ) : null}
      </g>
    );
  };
}
/** 끝점과 그 값: <Line dot={ndEndLabel(rows.length, 1, ndFmt.won)} /> — 그래프 margin 의 right 를 56 으로 넓힌다. 주인공 계열 하나에만 */
export const ndEndLabel = (length: number, slot: Slot, format: (value: any) => React.ReactNode) => ndEndDot(length, slot, { label: format });

/**
 * 앞뒤 값이 비어 혼자 떨어진 점만 그린다(선이 이어지지 않아 보이지 않는 값): <Line {...ndLine(1)} dot={ndIsolatedDot(rows, 'a', 1)} />
 * 빈 값은 null·undefined·빈 글자열·NaN 어느 것이어도 된다(Number(없는 값) 으로 만든 NaN 도 Recharts 는 선을 끊는다)
 */
export function ndIsolatedDot(rows: readonly any[], key: string, slot: Slot) {
  const color = ndColor(slot);
  const has = (i: number): boolean => {
    const v = rows[i] != null ? rows[i][key] : null;
    return typeof v === 'number' ? isFinite(v) : v != null && v !== '';
  };
  return function NdIsolatedDot(p: any) {
    const k = p?.key ?? `nd-iso-${p?.index}`;
    if (!p || p.cx == null || p.cy == null || !has(p.index) || has(p.index - 1) || has(p.index + 1)) return <g key={k} />;
    return <circle key={k} cx={p.cx} cy={p.cy} r={3} fill={color} />;
  };
}

/* ───────── 막대 ───────── */

type BarOpt = {
  /** 가로 막대(layout="vertical") */
  horizontal?: boolean;
  /** 쌓은 막대에서의 자리: 'end' 는 값 쪽 끝 조각(둥글게), 'middle' 은 그 아래 조각. 끝 조각의 값이 0 일 수 있으면 ndStack 을 쓴다 */
  stack?: 'end' | 'middle';
  /** 굵기 상한(px). 기본은 세로 24, 가로 16 */
  max?: number;
  /** 면을 채우지 않고 테두리만: 비교 대상이 둘일 때 둘째(첫째는 'context' 면) */
  outline?: boolean;
};

const GAP = 2; // 쌓은 조각 사이의 틈(px). 선을 긋지 않고 조각을 그만큼 줄여서 비운다
const corner = (r: number, x: number, y: number): string => (r > 0 ? `A${r},${r} 0 0 1 ${x},${y}` : `L${x},${y}`);
/** 모서리마다 둥글림을 달리한 네모 길(왼위, 오른위, 오른아래, 왼아래) */
function rectPath(x: number, y: number, w: number, h: number, r: [number, number, number, number]): string {
  const [tl, tr, br, bl] = r;
  return `M${x + tl},${y} L${x + w - tr},${y} ${corner(tr, x + w, y + tr)} L${x + w},${y + h - br} ${corner(br, x + w - br, y + h)} L${x + bl},${y + h} ${corner(bl, x, y + h - bl)} L${x},${y + tl} ${corner(tl, x + tl, y)} Z`;
}
/** 쌓은 조각의 자리: 'end' 는 값 쪽 끝(둥글게), 'mid' 는 그 아래, 'skip' 은 그리지 않는다 */
type Piece = 'end' | 'mid' | 'skip';
/** 쌓은 막대의 조각: 값 쪽 끝 조각만 4px 둥글게, 나머지는 끝 쪽을 2px 비워 틈을 만든다 */
function stackShape(pieceOf: (p: any, length: number) => Piece, horizontal: boolean) {
  return function NdStackShape(p: any) {
    let x = Number(p?.x);
    let y = Number(p?.y);
    let w = Number(p?.width);
    let h = Number(p?.height);
    if (![x, y, w, h].every((n) => isFinite(n))) return <g />;
    // Recharts 는 음수 값의 막대를 음수 길이로 준다: 값 쪽 끝이 반대편(아래·왼쪽)이 된다
    let flipped = false;
    if (w < 0) { x += w; w = -w; if (horizontal) flipped = true; }
    if (h < 0) { y += h; h = -h; if (!horizontal) flipped = true; }
    if (!(w > 0) || !(h > 0)) return <g />;
    const piece = pieceOf(p, horizontal ? w : h);
    if (piece === 'skip') return <g />;
    const end = piece === 'end';
    const len = horizontal ? w : h;
    const cut = end ? 0 : Math.min(GAP, Math.max(0, len - 1));
    if (horizontal) { w -= cut; if (flipped) x += cut; } else { h -= cut; if (!flipped) y += cut; }
    const r = end ? Math.max(0, Math.min(4, (horizontal ? h : w) / 2, horizontal ? w : h)) : 0;
    const radius: [number, number, number, number] = horizontal ? (flipped ? [r, 0, 0, r] : [0, r, r, 0]) : flipped ? [0, 0, r, r] : [r, r, 0, 0];
    return <path className="recharts-rectangle nd-stack-piece" d={rectPath(x, y, w, h, radius)} fill={p.fill} />;
  };
}

/**
 * 막대: 굵기 24px 이하(가로 막대 16px), 값 쪽 끝만 4px 둥글게, 바닥은 반듯하게.
 * 항목이 가로축에 놓인 막대는 색을 나누지 않고 1번 한 색. 강조할 하나만 1번, 나머지는 'context'.
 */
export function ndBar(slot: Slot, opt: BarOpt = {}) {
  const color = ndColor(slot);
  const maxBarSize = opt.max ?? (opt.horizontal ? 16 : 24);
  if (opt.stack) return { fill: color, maxBarSize, shape: stackShape(() => (opt.stack === 'end' ? 'end' : 'mid'), !!opt.horizontal), ...ndAnim() };
  const radius: [number, number, number, number] = opt.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
  if (opt.outline) return { fill: SURFACE, stroke: color, strokeWidth: 1.5, radius, maxBarSize, ...ndAnim() };
  return { fill: color, radius, maxBarSize, ...ndAnim() };
}

/**
 * 쌓은 막대 한 묶음. 줄마다 "값이 있는 맨 끝 조각"을 찾아 둥글리고, 조각 사이에 2px 틈을 둔다
 * (맨 위 계열이 0 인 줄도 윗모서리가 둥글다. 맨 위 조각이 1px 도 안 되면 그 조각은 그리지 않고 아래 조각을 둥글린다).
 *   const stack = ndStack(['위탁', '사입', '오프라인', '해외']);      // 쌓는 순서(아래부터)
 *   <Bar dataKey="위탁" stackId="a" {...stack('위탁')} />             // 색은 순서대로 1번부터. 둘째 인자로 바꿀 수 있다
 * 같은 그래프에 쌓은 묶음 말고 다른 계열(따로 선 막대·선)이 있으면 색이 겹치지 않게 시작 번호를 준다:
 *   <Bar dataKey="광고비" {...ndBar(1)} />  +  ndStack(channels, { from: 2 })   // 쌓은 묶음은 2번부터
 * 계열을 끄고 켜는 그래프는 꺼진 계열을 알려 준다: ndStack(keys, { off: series.isOff })
 * (켜진 키만 걸러서 넘기면 남은 계열의 색 번호가 앞으로 밀려, 끌 때마다 색이 바뀐다.)
 * 음수가 섞인 자료는 그래프에 stackOffset="sign" 을 준다(양수는 위로, 음수는 아래로 따로 쌓인다. 없으면 Recharts 가 조각을 겹쳐 그린다).
 */
export function ndStack(keys: readonly string[], opt: { horizontal?: boolean; max?: number; off?: (key: string) => boolean; /** 첫 계열의 색 번호(기본 1) */ from?: number } = {}) {
  const from = Math.max(1, Math.round(opt.from ?? 1));
  const pieceOf = (key: string) => (p: any, length: number): Piece => {
    const row = p?.payload;
    const own = Number(row?.[key]);
    const negative = own < 0;
    const perValue = isFinite(own) && own !== 0 ? length / Math.abs(own) : 0; // 이 줄에서 값 1 이 몇 px 인가
    // 값 쪽 끝에서부터 본다. 1px 이 안 되는 조각은 끝 조각으로 치지 않는다(둥글릴 수 없어 각진 실선 한 줄로 보인다)
    let last = -1;
    let end = -1;
    for (let i = keys.length - 1; i >= 0 && end < 0; i--) {
      const k = keys[i];
      if (k === undefined || (opt.off && opt.off(k))) continue;
      const v = Number(row?.[k]);
      if (!(negative ? v < 0 : v > 0)) continue;
      if (last < 0) last = i;
      if (Math.abs(v) * perValue >= 1) end = i;
    }
    const at = keys.indexOf(key);
    if (end < 0) return at === last ? 'end' : 'mid'; // 모든 조각이 1px 미만이면 맨 끝 조각을 끝으로 친다
    return at === end ? 'end' : at > end ? 'skip' : 'mid';
  };
  return (key: string, slot?: Slot) => {
    const i = keys.indexOf(key);
    return {
      fill: ndColor(slot ?? (i >= 0 && from + i <= 6 ? from + i : 'context')),
      maxBarSize: opt.max ?? (opt.horizontal ? 16 : 24),
      shape: stackShape(pieceOf(key), !!opt.horizontal),
      ...ndAnim(),
    };
  };
}

/**
 * 막대 끝의 값 글자: <Bar …><LabelList dataKey="sales" {...ndValueLabel(ndFmt.won)} /></Bar> — 막대가 여덟 개 이하일 때만.
 * 세로 막대는 margin={{ ...ndMargin, top: 24 }}, 가로 막대는 { horizontal: true } 와 margin={{ ...ndMarginH, right: 48 }} (값 글자가 그림 밖으로 잘리지 않게)
 */
export function ndValueLabel(format?: (value: any) => string | number, opt: { horizontal?: boolean } = {}) {
  return {
    position: (opt.horizontal ? 'right' : 'top') as 'right' | 'top',
    offset: 6,
    fontSize: 11,
    fontWeight: 500,
    fill: 'var(--nd-fg)',
    ...(format ? { formatter: format } : {}),
  };
}

/* ───────── 원 · 도넛 ───────── */

const PIE_MIN = 2; // 이 비중(%) 미만인 조각은 2px 틈에 묻혀 보이지 않는다: 글자를 달지 않고, 둘 이상이면 '기타'로 묶는다

/**
 * 원·도넛: 얇은 도넛, 조각 사이 2px 틈, 위에서 시계 방향. 조각은 다섯 개 이하로 하고 나머지는 '기타'. 값은 옆에 NdDonutList 로.
 * 조각 색은 자료 행의 fill 에서 온다(없으면 모든 조각이 회색이다): 행은 ndPieRows 로 만든다.
 *   const pie = ndPieRows(rows, { colorOf });      // rows: { name, value }[]
 *   <Pie data={pie} dataKey="value" nameKey="name" {...ndPie()} />  +  <NdDonutList rows={pie} />
 * 조각 밖 글자는 { labels: true } 하나로 단다(비중 %. label 속성을 따로 적지 않는다). 값으로 적으려면 { labels: (pct, p) => ndFmt.won(p.value) }.
 * 조각 밖 글자는 높이 180px 이상에서만 쓴다(그보다 낮으면 위아래 글자가 잘린다). 2% 미만 조각에는 글자를 달지 않는다
 * (이웃한 작은 조각의 글자끼리 겹친다 — 그 값은 옆 목록에서 읽는다).
 */
export function ndPie(opt: { donut?: boolean; /** 조각 밖에 글자를 단다: 글자 자리만큼 원을 줄인다 */ labels?: boolean | ((percent: number, piece: any) => string) } = {}) {
  const donut = opt.donut !== false;
  const outer = opt.labels ? 68 : 86;
  const labels = opt.labels;
  const text = typeof labels === 'function' ? labels : (percent: number): string => ndFmt.pct(percent);
  const worth = (p: any): boolean => Number(p?.percent) * 100 >= PIE_MIN; // 글자를 달 만한 조각인가(0 인 조각 포함해 작은 것은 뺀다)
  return {
    innerRadius: donut ? `${Math.round(outer * 0.79)}%` : 0,
    outerRadius: `${outer}%`,
    paddingAngle: 0,
    cornerRadius: donut ? 1 : 0,
    startAngle: 90,
    endAngle: -270,
    stroke: SURFACE,
    strokeWidth: 2,
    // Recharts 의 label 을 true 로만 주면 값이 표기 없이 나온다(9070). 작은 조각에는 글자도 이음선도 달지 않는다
    ...(labels
      ? {
          label: (p: any): string => (worth(p) ? text(Number(p.percent) * 100, p) : ''),
          labelLine: (p: any) => {
            const a = p?.points?.[0];
            const b = p?.points?.[1];
            if (!worth(p) || !a || !b) return <g />;
            return <path className="recharts-curve recharts-pie-label-line" d={`M${a.x},${a.y}L${b.x},${b.y}`} fill="none" stroke="var(--nd-chart-axis)" />;
          },
        }
      : {}),
    ...ndAnim(),
  };
}

type PieOpt = {
  /** 이름으로 색을 정한다: ndSlots 가 돌려준 함수. 없으면 넘긴 순서대로 1번부터 */
  colorOf?: (name: string) => string;
  /** 남기는 조각 수(기본 5). 그보다 많으면 값이 작은 것부터 '기타'로 묶는다 */
  keep?: number;
  /** 이 비중(%, 기본 2) 미만인 조각이 둘 이상이면 '기타'로 묶는다(2px 틈에 묻혀 보이지 않는다) */
  min?: number;
  /** 묶은 조각의 이름 */
  other?: string;
};
/**
 * 도넛·원 그래프의 자료 행을 만든다: 행에 색(fill)을 넣고, 여섯째부터와 아주 작은 조각은 '기타'로 묶는다.
 * 돌려준 행을 <Pie data> 와 <NdDonutList rows> 에 함께 넘기면 조각과 목록의 색·순서가 같다. 순서는 넘긴 그대로(큰 것부터 넘긴다).
 *   const pie = ndPieRows(rows.map((r) => ({ name: r.dept, value: r.count })), { colorOf });
 */
export function ndPieRows<T extends { name: string; value: number }>(rows: readonly T[], opt: PieOpt = {}): Array<{ name: string; value: number; fill: string } & Partial<T>> {
  const keep = Math.max(1, Math.round(opt.keep ?? 5));
  const min = opt.min ?? PIE_MIN;
  const other = opt.other ?? '기타';
  const val = (r: T): number => (typeof r.value === 'number' && isFinite(r.value) && r.value > 0 ? r.value : 0);
  const total = rows.reduce((a, r) => a + val(r), 0);
  const named = rows.filter((r) => r.name !== other);
  const hasOther = named.length < rows.length;
  // 값이 큰 순으로 keep 개까지 남긴다(0 인 행은 조각이 아니므로 세지 않는다)
  const ranked = named.map((r, i) => ({ r, i, v: val(r) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v || a.i - b.i);
  const folded = new Set<T>(ranked.slice(keep).map((x) => x.r));
  const small = ranked.filter((x) => !folded.has(x.r) && total > 0 && (x.v / total) * 100 < min).map((x) => x.r);
  // 작은 조각 하나만 '기타'로 바꾸면 이름만 잃는다: 묶을 것이 둘 이상이거나 '기타'가 이미 있을 때만 묶는다
  if (small.length > 0 && (small.length + folded.size >= 2 || hasOther)) small.forEach((r) => folded.add(r));
  const kept = named.filter((r) => !folded.has(r));
  const rest = rows.filter((r) => r.name === other || folded.has(r)).reduce((a, r) => a + val(r), 0);
  const fill = (name: string, i: number): string => (opt.colorOf ? opt.colorOf(name) : ndColorAt(i));
  const out: Array<{ name: string; value: number; fill: string } & Partial<T>> = kept.map((r, i) => ({ ...r, name: r.name, value: val(r), fill: fill(r.name, i) }));
  if (hasOther || folded.size) out.push({ name: other, value: rest, fill: ndColor('context') } as { name: string; value: number; fill: string } & Partial<T>);
  return out;
}

type DonutRow = { name: string; value: number; color?: string; fill?: string };
/**
 * 도넛 옆의 이름·값 목록(올리지 않아도 값이 보이게). 표식 색은 행의 color, 없으면 fill(ndPieRows 가 넣은 조각 색).
 *   <NdDonutList rows={pie} />                                                       // 기본은 비중(%)
 *   <NdDonutList rows={pie} value={(pct, row) => `${ndFmt.num(row.value)}명`} />
 */
export function NdDonutList({ rows, value }: { rows: readonly DonutRow[]; value?: (percent: number, row: DonutRow) => React.ReactNode }) {
  const sum = rows.reduce((a, r) => a + (r.value > 0 ? r.value : 0), 0) || 1;
  const format: (percent: number, row: DonutRow) => React.ReactNode = value ?? ndFmt.pct;
  return (
    <ul className="nd-donut-list">
      {rows.map((r, i) => (
        <li key={`${r.name}-${i}`}>
          <span className="nd-legend-key" data-kind="rect" style={{ color: r.color ?? r.fill ?? 'var(--nd-chart-context)' }} />
          <span className="nd-donut-name">{r.name}</span>
          <span className="nd-donut-value">{format((r.value / sum) * 100, r)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ───────── 기준선 ───────── */

const refLine = (slot: Slot = 'context') => ({ stroke: ndColor(slot), strokeWidth: 1 });
/**
 * 기준선: <ReferenceLine y={300} {...ndRefLine()} label={ndRefLabel('목표')} />
 * 목표·평균은 중립 회색 실선, 뜻이 있는 한도선만 ndRefLine('bad').
 * (괄호 없이 {...ndRefLine} 으로 펼쳐도 회색 실선이 된다 — 먼저 옮긴 코드가 조용히 깨지지 않게 남겨 둔 것)
 */
export const ndRefLine = Object.assign(refLine, refLine());
type RefLabelOpt = {
  /** 글자색을 선과 같은 뜻의 색으로: 한도선은 'bad' */
  slot?: Slot;
  /** 선 아래에 놓는다(선이 그래프 맨 위에 붙어 있을 때) */
  below?: boolean;
  /** 왼쪽 끝에 놓는다(오른쪽 끝에 선·끝점 값이 몰려 있을 때). 세로 기준선에서는 선의 왼쪽에 놓는다(선이 오른쪽 끝에 가까울 때) */
  left?: boolean;
  /** 세로 기준선(x=…)의 이름표: 선 오른쪽 맨 위에 놓는다 */
  vertical?: boolean;
};
/**
 * 기준선의 이름표: 그림 영역 안쪽, 선 바로 위 오른쪽 끝에 놓여 그래프 여백에 잘리지 않는다.
 * 글자 둘레에 바탕색 테두리를 둘러(nd-chart.css 의 .nd-ref-label) 막대·선 위에서도 읽힌다. 다만 Recharts 2 는 적은 순서대로 그리므로
 * <ReferenceLine> 은 계열(Bar·Line·Area) 뒤에 적는다 — 앞에 적으면 막대가 이름표를 덮는다(Recharts 3 은 순서와 상관없이 위에 그린다)
 */
export const ndRefLabel = (text: string, opt: RefLabelOpt = {}) => ({
  value: text,
  className: 'nd-ref-label',
  // Recharts 의 자리 이름은 "선을 감싼 상자의 어느 구석인가"다. 세로선은 폭이 0 인 상자라 TopLeft 가 선의 오른쪽, TopRight 가 선의 왼쪽이 된다
  position: (opt.vertical
    ? `insideTop${opt.left ? 'Right' : 'Left'}`
    : `inside${opt.below ? 'Top' : 'Bottom'}${opt.left ? 'Left' : 'Right'}`) as 'insideTopRight' | 'insideTopLeft' | 'insideBottomRight' | 'insideBottomLeft',
  offset: 6,
  fontSize: 11,
  fill: opt.slot == null ? 'var(--nd-chart-tick)' : ndColor(opt.slot),
});

/* ───────── 표시(범례·말풍선의 계열 표식) ───────── */

/** 선은 짧은 선, 비교선은 점선, 일곱 번째부터는 긴 점선, 막대·쌓은 면은 네모, 테두리 막대는 빈 네모, 점은 동그라미 */
export type NdMark = 'line' | 'dash' | 'long' | 'rect' | 'outline' | 'dot';
const MARKS: readonly string[] = ['line', 'dash', 'long', 'rect', 'outline', 'dot'];
const dashMark = (dash: any): NdMark => (parseFloat(String(dash)) >= 8 ? 'long' : 'dash');

/** 계열 순번(ndLineAt 과 같은 순번)으로 말풍선 표식을 정한다. Recharts 3 은 말풍선에 점선 정보를 넘기지 않는다 */
export const ndMarksAt = (ids: readonly string[]) => (item: NdTipItem): NdMark | undefined => {
  const i = ids.indexOf(String(item.dataKey ?? item.name ?? ''));
  return i < 0 ? undefined : ndMarkAt(i);
};

/**
 * 계열 표식 하나(범례·말풍선과 같은 모양). 그래프 밖의 단추·칩·표 머리에 넣어 그래프와 같은 구분(색 + 선 모양)을 쓴다.
 * 계열이 일곱 이상인 선 그래프는 색만으로는 1번과 7번이 같다 — 칩에도 긴 점선 표식이 있어야 한다.
 *   <button …><NdKey slot={ndSlotAt(i)} mark={ndMarkAt(i)} />{name}</button>     // 순번으로
 *   <button …><NdKey {...colorOf.key(id)} />{id}</button>                        // ndSlots 로 묶은 이름으로
 *   <NdKey slot={2} mark="rect" />                                               // 막대·면
 */
export function NdKey({ slot, color, mark = 'line', off }: { slot?: Slot; color?: string; mark?: NdMark; /** 꺼진 계열: 옅게 */ off?: boolean }) {
  return <span className="nd-legend-key" data-kind={mark} data-off={off ? 'true' : undefined} aria-hidden="true" style={{ color: color ?? ndColor(slot ?? 'context') }} />;
}

/** order 에 적힌 순서대로, 적히지 않은 것은 원래 순서대로 뒤에 */
function ndSort<T>(list: readonly T[], order: readonly string[] | undefined, keys: (it: T) => string[]): T[] {
  if (!order || !order.length) return [...list];
  const rank = (it: T): number => {
    for (const k of keys(it)) {
      const i = order.indexOf(k);
      if (i >= 0) return i;
    }
    return order.length;
  };
  return list.map((it, i) => ({ it, i, r: rank(it) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.it);
}

/* ───────── 말풍선 ───────── */

type Fmt = (value: any, name?: string, item?: any) => React.ReactNode;

/** 말풍선 한 줄. Recharts 가 넘기는 값과 같은 모양이라, Recharts 없이 손으로 넘길 때도 이 타입을 쓴다 */
export type NdTipItem = {
  name?: string | number;
  dataKey?: unknown;
  value?: unknown;
  color?: string;
  /** 표식 모양(손으로 넘길 때) */
  mark?: NdMark;
  type?: string;
  fill?: string;
  stroke?: string;
  strokeDasharray?: string | number;
  payload?: any;
};

export type NdTooltipOpt = {
  /** 'line' 은 세로 안내선, 'bar' 는 올린 자리의 옅은 띠(ComposedChart 에서는 세로선으로 나온다), 'none' 은 표시 없음(원·점) */
  kind?: 'line' | 'bar' | 'none';
  /** 값 표기. 예: ndFmt.won */
  value?: Fmt;
  /** 머리글(날짜·항목) 표기 */
  label?: (label: any, payload?: any[]) => React.ReactNode;
  /** 값 뒤에 붙일 단위 */
  unit?: string;
  /** 합계 줄을 보일지(쌓은 계열에만) */
  total?: boolean | string;
  /** 합계에 넣을 dataKey(손으로 넘긴 줄은 이름). 목표선·비교선이 섞인 그래프에서는 반드시 적는다 */
  totalKeys?: readonly string[];
  /** 0·빈 값 줄을 숨길지 */
  hideEmpty?: boolean;
  /** 계열 이름 바꾸기 */
  names?: Record<string, string>;
  /** 줄 앞 표식의 색을 직접 정한다. 막대를 Cell 로 칠한 그래프는 말풍선이 그 색을 모른다(계열 색만 온다) */
  color?: (item: NdTipItem) => string | undefined;
  /**
   * 줄 앞 표식의 모양을 직접 정한다: dataKey(또는 이름)별 맵이나 함수. Recharts 3 은 말풍선에 점선 정보를 넘기지 않으므로
   * 점선 계열이 있으면 적는다 — mark: { target: 'dash' }. 일곱 이상 선 그래프는 mark: ndMarksAt(ids)
   */
  mark?: Record<string, NdMark> | ((item: NdTipItem) => NdMark | undefined);
  /** 줄 순서를 고정한다(dataKey 나 이름). Recharts 3 은 계열을 그리지 않았다가 다시 그리면 맨 뒤로 보낸다 */
  order?: readonly string[];
  /** 줄 순서를 뒤집는다: 쌓은 그래프는 눈에 보이는 위→아래 순서로 */
  reverse?: boolean;
};

export type NdTooltipProps = {
  active?: boolean;
  label?: any;
  payload?: readonly NdTipItem[];
  opt?: NdTooltipOpt;
  /** Recharts 가 넘긴다: 키보드로 말풍선을 옮길 수 있는 그래프에서만 화면 읽기 프로그램에 알린다 */
  accessibilityLayer?: boolean;
};

function tipColor(it: any, opt: NdTooltipOpt): string {
  const own = opt.color ? opt.color(it) : undefined;
  if (own) return own;
  const rowFill = it.payload && typeof it.payload === 'object' && typeof it.payload.fill === 'string' ? (it.payload.fill as string) : undefined;
  let color: string | undefined = it.color;
  // 데이터 행에 색이 있으면(행마다 칠한 막대, 원 조각) 그 색. 선은 color 가 선 색이라 그대로 둔다
  if (rowFill && (color == null || color === it.fill)) color = rowFill;
  if (color == null) color = it.fill;
  // 테두리만 그린 막대는 면이 바탕색이다. 조각 사이 틈 색(stroke)은 계열 색이 아니다
  if (color == null || color === SURFACE) color = it.stroke && it.stroke !== SURFACE ? it.stroke : undefined;
  return color || 'var(--nd-chart-context)';
}
function tipMark(it: any, opt: NdTooltipOpt): NdMark {
  const own = typeof opt.mark === 'function' ? opt.mark(it) : opt.mark ? opt.mark[String(it.dataKey ?? '')] ?? opt.mark[String(it.name ?? '')] : undefined;
  if (own) return own;
  if (it.mark && MARKS.includes(it.mark)) return it.mark as NdMark;
  if (it.strokeDasharray) return dashMark(it.strokeDasharray);
  if (isFace(it.fill)) return 'rect'; // 쌓은 면·방사형: 범례와 같은 네모
  const fill = it.fill;
  const stroke = it.stroke;
  if (fill === SURFACE && stroke && stroke !== SURFACE) return 'outline';
  if (fill && fill !== '#fff' && fill !== 'none' && (!stroke || stroke === SURFACE || stroke === 'none')) return 'rect';
  return 'line';
}

const TIP_ROWS = 8; // 이보다 줄이 많으면 두 단으로 나눈다(한 단으로는 말풍선이 그림보다 길어져 카드 밖으로 나간다)

/**
 * 키보드로 띄운 말풍선은 초점이 그래프를 떠나면 닫는다. Recharts 2.x 전부와 3.7 이하는 Tab 으로 다음 그래프에 가도 말풍선을 남겨 둔다
 * (3.8 부터는 Recharts 가 닫는다). 초점이 나갈 때 그 자리의 말풍선을 감추고, Recharts 2 에는 "마우스가 나갔다"고 알려 안내선까지 지운다.
 * 그래프에 다시 손이 닿거나(초점·키·마우스·터치) 가리키는 자리가 바뀌면(함께 움직이는 그래프) 다시 보인다.
 * 마우스가 그래프 위에 있을 때 초점만 나간 경우는 건드리지 않는다(마우스로 띄운 말풍선이다).
 */
function useTipLeft(active: boolean, label: unknown) {
  const box = React.useRef<HTMLDivElement | null>(null);
  const host = React.useRef<Element | null>(null);
  const now = React.useRef({ active, label });
  now.current = { active, label };
  const hold = React.useRef(false);
  const [left, setLeft] = React.useState<{ label: unknown } | null>(null);
  React.useEffect(() => {
    // 키보드 접근을 켰는지는 묻지 않는다(Recharts 2.10 은 그 값을 말풍선에 넘기지 않는다). 초점을 받지 않는 그래프에서는 아무 일도 일어나지 않는다
    const chart = box.current ? box.current.closest('.recharts-wrapper') : null;
    host.current = chart;
    if (!chart) return undefined;
    let byKey = false; // 마지막으로 그래프를 움직인 것이 키보드인가
    const out = (e: Event) => {
      const to = (e as FocusEvent).relatedTarget as Node | null;
      if (to && chart.contains(to)) return;
      // 마우스로 띄운 말풍선은 건드리지 않는다. 마우스가 그래프 위에 멈춰 있어도 키보드로 옮긴 말풍선이면 닫는다
      if (!byKey && chart.matches(':hover')) return;
      // "마우스가 나갔다"는 알림을 받은 Recharts 3.7 은 마우스 자리 대신 키보드 자리의 말풍선을 내놓는다(가리키는 자리가 바뀐다).
      // 그 직후의 바뀜은 다시 보일 까닭으로 치지 않는다
      hold.current = true;
      setTimeout(() => { hold.current = false; }, 80);
      if (now.current.active) setLeft({ label: now.current.label }); // 떠 있는 말풍선이 없으면 감출 것도 없다
      // React 는 mouseout 으로 onMouseLeave 를 만든다. 나간 곳을 바로 위 요소로 적어 그래프 틀 하나에만 알린다
      if (typeof MouseEvent === 'function') chart.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: chart.parentElement }));
    };
    const back = (e: Event) => { hold.current = false; byKey = e.type === 'focusin' || e.type === 'keydown'; setLeft(null); };
    // 터치는 pointerdown 으로 받는다. touchstart 를 따로 걸지 않는다(막는 터치 처리기가 붙은 화면으로 취급돼 브라우저의 그리기 순서가 달라진다 —
    // 화면 전체 촬영 중에 그래프 틀이 다시 만들어지는 것을 쟀다)
    const wake = ['focusin', 'keydown', 'mousemove', 'pointerdown'];
    chart.addEventListener('focusout', out);
    wake.forEach((n) => chart.addEventListener(n, back));
    return () => {
      chart.removeEventListener('focusout', out);
      wake.forEach((n) => chart.removeEventListener(n, back));
      chart.removeAttribute('data-nd-left');
    };
  }, []);
  // 가리키는 자리가 바뀌었거나 말풍선이 닫혔으면 감출 까닭이 없어졌다(떠난 직후의 바뀜은 따라가며 계속 감춘다)
  React.useEffect(() => {
    if (left == null) return;
    if (!active) setLeft(null);
    else if (left.label !== label) setLeft(hold.current ? { label } : null);
  }, [left, active, label]);
  const gone = active && left != null && (left.label === label || hold.current);
  // Recharts 3.7 이하는 안내선과 올린 자리의 점도 남겨 둔다: 그래프 틀에 표시를 달아 nd-chart.css 가 감추게 한다
  React.useEffect(() => {
    const chart = host.current;
    if (!chart) return;
    if (gone) chart.setAttribute('data-nd-left', '');
    else chart.removeAttribute('data-nd-left');
  }, [gone]);
  return { box, gone };
}

/**
 * 말풍선이 그래프 상자 아래로 넘치지 않게 한다. Recharts 는 말풍선을 그림 영역 안에 두지만, 그림보다 긴 말풍선(계열이 많고 범례가
 * 여러 줄인 좁은 그래프)은 그림 맨 위에 붙인 채 아래로 내보내, 카드 밖으로 나가거나 잘린다. 넘친 만큼 위로 올린다(범례 위를 덮는다).
 */
function useTipFit(box: React.RefObject<HTMLDivElement | null>) {
  useLayout(() => {
    const tip = box.current;
    const outer = tip ? tip.closest('.recharts-tooltip-wrapper') : null;
    const chart = outer ? outer.closest('.recharts-wrapper') : null;
    if (!tip || !outer || !chart) return undefined;
    let lifted = 0;
    const fit = () => {
      const t = tip.getBoundingClientRect();
      const c = chart.getBoundingClientRect();
      if (!(t.height > 0)) return;
      // 지금 올려 둔 만큼을 되돌려 놓고 본다. 그래프 맨 위보다 더 올리지는 않는다
      const over = Math.max(0, Math.round(Math.min(t.bottom + lifted - c.bottom, t.top + lifted - c.top)));
      if (over === lifted) return;
      lifted = over;
      tip.style.transform = over ? `translateY(${-over}px)` : '';
    };
    fit();
    // Recharts 가 말풍선을 옮기거나(바깥 상자의 style) 줄 수가 바뀌어 크기가 달라질 때마다 다시 잰다
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(fit) : null;
    if (mo) mo.observe(outer, { attributes: true, attributeFilter: ['style'] });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(tip);
    return () => { if (mo) mo.disconnect(); if (ro) ro.disconnect(); };
  }, [box]);
}

/** 말풍선 내용: 그 자리의 모든 계열을 한 번에. 이름은 흐리게, 값은 또렷하게. 계열이 하나면 표식을 숨긴다. 아홉 줄부터는 두 단 */
export function NdTooltipContent(props: NdTooltipProps) {
  const opt: NdTooltipOpt = props.opt ?? {};
  const payload = (props.payload ?? []) as readonly any[];
  const { box, gone } = useTipLeft(!!props.active, props.label);
  useTipFit(box);
  // 꺼져 있을 때도 크기가 있는 빈 상자를 남긴다. Recharts 2.12.5 이하는 말풍선 크기를 미리 재 두지 못하면
  // 처음 한 번을 그래프 왼쪽 위 구석에 그린다(원 그래프는 다른 조각으로 옮길 때까지 그대로다).
  const blank = <div ref={box} className="nd-tip" aria-hidden="true" style={{ visibility: 'hidden' }} />;
  if (!props.active || !payload.length || gone) return blank;
  const empty = (v: any): boolean => v == null || v === '' || (typeof v === 'number' && isNaN(v)); // Number(없는 값) 으로 만든 NaN 도 빈 값이다
  const shown = payload.filter((it) => it && it.type !== 'none' && !it.hide && !(opt.hideEmpty && (empty(it.value) || it.value === 0)));
  if (!shown.length) return blank;
  const sorted = ndSort(shown, opt.order, (it) => [String(it.dataKey ?? ''), String(it.name ?? '')]);
  const rows = opt.reverse ? sorted.reverse() : sorted;
  const fmt = (v: any, name?: string, it?: any): React.ReactNode => {
    if (empty(v)) return '–';
    const n = toNum(v); // 숫자로 된 글자열("1234567")도 숫자로 읽어 쉼표를 넣는다
    const out = opt.value ? opt.value(v, name, it) : n !== undefined ? n.toLocaleString('ko-KR') : String(v);
    return opt.unit ? <>{out}{opt.unit}</> : out;
  };
  const head = opt.label ? opt.label(props.label, payload as any[]) : props.label;
  // dataKey 가 없는 줄(Recharts 없이 손으로 넘긴 것)은 이름으로 맞춘다. dataKey 만 보면 그런 줄은 합계가 늘 0 이 된다
  const inTotal = (it: any): boolean => !opt.totalKeys || opt.totalKeys.includes(String(it.dataKey ?? it.name ?? ''));
  const sum = opt.total ? rows.filter(inTotal).reduce((a, it) => a + (toNum(it.value) ?? 0), 0) : 0;
  // 두 단은 그래프 폭이 440px 이상일 때만(두 단 말풍선의 폭 360px + 세로축). 그보다 좁으면 한 단으로 두고 위로 올려 그래프 상자 안에 넣는다
  const room = box.current ? box.current.closest('.recharts-wrapper')?.clientWidth ?? 0 : 0;
  const two = rows.length > TIP_ROWS && (room === 0 || room >= 440);
  return (
    <div ref={box} className="nd-tip" data-cols={two ? 2 : undefined} role={props.accessibilityLayer ? 'status' : undefined}>
      {head != null && head !== '' ? <div className="nd-tip-label">{head}</div> : null}
      <div className="nd-tip-rows" data-cols={two ? 2 : undefined} style={two ? { gridTemplateRows: `repeat(${Math.ceil(rows.length / 2)}, auto)` } : undefined}>
        {rows.map((it, i) => {
          const raw = String(it.name ?? it.dataKey ?? '');
          const name = opt.names?.[raw] ?? raw;
          return (
            <div className="nd-tip-row" key={`${raw}-${i}`}>
              <span className="nd-tip-key" data-kind={tipMark(it, opt)} style={{ color: tipColor(it, opt) }} />
              <span className="nd-tip-name">{name}</span>
              <span className="nd-tip-value">{fmt(it.value, raw, it)}</span>
            </div>
          );
        })}
      </div>
      {opt.total ? (
        <div className="nd-tip-total">
          <span>{typeof opt.total === 'string' ? opt.total : '합계'}</span>
          <span>{fmt(sum)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** <Tooltip {...ndTooltip({ kind: 'bar', value: ndFmt.won })} /> */
export function ndTooltip(opt: NdTooltipOpt = {}) {
  const kind = opt.kind ?? 'line';
  return {
    content: <NdTooltipContent opt={opt} />,
    cursor: kind === 'none' ? false : kind === 'bar' ? { fill: 'var(--nd-chart-band)' } : { stroke: 'var(--nd-chart-cursor)', strokeWidth: 1 },
    isAnimationActive: false,
    offset: 12,
    wrapperStyle: { outline: 'none', zIndex: 30 },
  };
}

/* ───────── 범례 ───────── */

/** 범례 한 항목. Recharts 가 넘기는 값과 같은 모양이라, Recharts 없이 손으로 넘길 때도 이 타입을 쓴다 */
export type NdLegendItem = {
  /** 보이는 이름 */
  value?: unknown;
  color?: string;
  /** 표식 모양. Recharts 의 'line'·'rect'·'circle' 이나 NdMark */
  type?: NdMark | 'circle' | 'plainline' | 'square' | 'none' | (string & {});
  dataKey?: unknown;
  inactive?: boolean;
  payload?: any;
};

export type NdLegendOpt = {
  align?: 'left' | 'right' | 'center';
  names?: Record<string, string>;
  /** 누르면 계열을 켜고 끄게 하려면 useNdSeries() 의 값을 넘긴다 */
  series?: { isOff: (key: string) => boolean; toggle: (key: string) => void };
  /** 항목 순서를 고정한다(dataKey 나 이름). 말풍선의 order 와 같은 값을 넘긴다 */
  order?: readonly string[];
};

export type NdLegendProps = { payload?: readonly NdLegendItem[]; opt?: NdLegendOpt };

function legendMark(it: any): NdMark {
  const t = String(it.type ?? '');
  const p = it.payload && typeof it.payload === 'object' ? it.payload : null;
  // Recharts 가 넘긴 항목은 계열의 속성(payload)을 먼저 본다: 점선과 테두리 막대는 type 만으로는 알 수 없다
  if (p && p.strokeDasharray) return dashMark(p.strokeDasharray);
  if (p && p.fill === SURFACE && p.stroke && p.stroke !== SURFACE) return 'outline';
  if (MARKS.includes(t)) return t as NdMark;
  if (t === 'plainline') return 'line';
  if (t === 'circle') return 'dot';
  return 'rect';
}

/** 범례 내용: 표식은 그래프의 표시를 닮는다(NdMark). 글자는 계열 색을 입지 않는다. 순서는 계열을 적은 순서 */
export function NdLegendContent(props: NdLegendProps) {
  const opt: NdLegendOpt = props.opt ?? {};
  const all = ((props.payload ?? []) as readonly any[]).filter((it) => it && it.type !== 'none');
  const payload = ndSort(all, opt.order, (it) => [String(it.dataKey ?? ''), String(it.value ?? '')]);
  if (!payload.length) return null;
  // Recharts 3 은 그래프 틀 안에서 생긴 초점·키 입력·누름을 그래프의 것으로 받는다: 범례 단추를 누르면 첫 점의 말풍선이 뜨고
  // 그래프의 onClick 도 함께 불린다. 범례 단추에서 생긴 것은 그래프로 올려 보내지 않는다.
  const stop = opt.series ? (e: React.SyntheticEvent) => e.stopPropagation() : undefined;
  return (
    <ul className="nd-legend" data-align={opt.align ?? 'left'} data-toggle={opt.series ? 'true' : undefined} onFocus={stop} onKeyDown={stop} onClick={stop}>
      {payload.map((it, i) => {
        const key = String(it.dataKey ?? it.value ?? i);
        const raw = String(it.value ?? it.dataKey ?? '');
        const name = opt.names?.[raw] ?? raw;
        const mark = legendMark(it);
        const p = it.payload && typeof it.payload === 'object' ? it.payload : {};
        const color = (mark === 'outline' && (!it.color || it.color === SURFACE) ? p.stroke : it.color) || 'var(--nd-chart-context)';
        const off = opt.series ? opt.series.isOff(key) : !!it.inactive;
        const keyEl = <span className="nd-legend-key" data-kind={mark} style={{ color }} />;
        return (
          <li key={`${key}-${i}`}>
            {opt.series ? (
              <button type="button" className="nd-legend-item" data-off={off} aria-pressed={!off} aria-label={`${name} 계열 보이기`} onClick={() => opt.series!.toggle(key)}>
                {keyEl}
                {name}
              </button>
            ) : (
              <span className="nd-legend-item" data-off={off}>
                {keyEl}
                {name}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * <Legend {...ndLegend()} /> — 계열이 둘 이상이면 항상 넣는다. 하나뿐이면 넣지 않는다(제목이 말해 준다).
 * 화면에 이미 계열을 켜고 끄는 단추가 있으면 그것이 범례다(또 넣지 않는다).
 */
export function ndLegend(opt: NdLegendOpt = {}) {
  return {
    content: <NdLegendContent opt={opt} />,
    verticalAlign: 'top' as const,
    align: (opt.align ?? 'left') as 'left' | 'right' | 'center',
    // 높이를 고정하지 않는다: 여러 줄로 넘어가면 Recharts 가 잰 높이만큼 그림을 내린다(아래 간격은 .nd-legend 의 padding 이 준다)
    // Recharts 3 은 범례를 이름순으로 다시 줄 세운다(기본값 'value'). null 이면 계열을 적은 순서 그대로. 2.x 는 이 속성을 모르고 무시한다
    itemSorter: null,
  };
}

/**
 * 범례를 눌러 계열을 켜고 끄기.
 *   const series = useNdSeries();
 *   <Legend {...ndLegend({ series })} />
 *   <Line dataKey="a" hide={series.isOff('a')} {...ndLine(1)} />
 * 끌 때는 그리지 않는 대신 hide 를 쓴다(그리지 않으면 Recharts 3 에서 순서가 바뀐다).
 */
export function useNdSeries(initialOff: string[] = []) {
  const [off, setOff] = React.useState<string[]>(initialOff);
  return React.useMemo(
    () => ({
      isOff: (key: string) => off.includes(key),
      toggle: (key: string) => setOff((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key])),
    }),
    [off],
  );
}

/* ───────── 이름과 키보드 ───────── */

/**
 * 그래프에 이름을 주고 키보드로 말풍선을 옮길 수 있게 한다(좌우 화살표): <LineChart data={rows} {...ndA11y('11월 누적 매출과 목표')}>
 * 의무가 아니다 — 화면의 주된 그래프 하나에만 붙인다(그래프마다 붙이면 Tab 으로 지나갈 자리만 늘어난다).
 * 핵심 값은 그래프 밖(카드 숫자·표)에도 있어야 한다. 초점이 그래프를 떠나면 말풍선은 닫힌다(ndTooltip 을 쓴 그래프).
 * Tab 순서는 Recharts 가 정한다: 2.x 는 그림 → 범례 단추, 3.x 는 범례 단추 → 그림.
 */
export const ndA11y = (label: string) => ({ accessibilityLayer: true, 'aria-label': label });

/* ───────── 숫자 표기 ───────── */
// 모든 표기 함수는 인자 하나만 받는다(축의 tickFormatter, 말풍선의 value, LabelList 의 formatter 어디에 넘겨도 같은 결과).
// 자릿수를 바꾸려면 "만드는 함수"(pctOf, numOf, deltaOf, ppOf, wonOf)를 쓴다.

// 숫자로 된 글자열도 숫자로 읽는다(금액을 글자열로 주는 API: "1234567", "1234567.50", "1,234,567"). 앞에 0 이 붙은 것("00123")은
// 코드·번호일 수 있어 읽지 않는다. 숫자로 읽을 수 없는 값은 표기 함수가 받은 그대로 내보낸다.
const NUM_TEXT = /^[-+]?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/;
const toNum = (v: any): number | undefined => {
  if (typeof v === 'number') return isFinite(v) ? v : undefined;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s || s.length > 24 || !NUM_TEXT.test(s)) return undefined;
  const n = Number(s.replace(/,/g, ''));
  return isFinite(n) ? n : undefined;
};
const blank = (v: any): string => (v == null || typeof v === 'number' ? '–' : String(v)); // 빈 값·NaN·무한대는 줄표
/** 반올림해서 0 이 된 음수(-0, -0.0%)는 부호를 뗀다 */
const unsign = (s: string): string => (/^-[0.,]*$/.test(s) ? s.slice(1) : s);
const comma = (n: number): string => unsign(Math.round(n).toLocaleString('ko-KR'));
const fixed = (n: number, digits: number): string => unsign(n.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
/** 깎지 않고 그대로(소수는 끝의 0 만 뗀다). 눈금 자리와 다른 숫자가 찍히지 않게 */
const exact = (n: number, digits: number): string => unsign(n.toLocaleString('ko-KR', { maximumFractionDigits: digits }));

const won = (given: any): string => {
  const v = toNum(given);
  if (v === undefined) return blank(given);
  const a = Math.abs(v);
  if (a >= 9999.95e8) return `${fixed(v / 1e12, 2)}조`; // 억으로 적으면 10,000.0억이 되는 값부터 조
  if (Math.round(a / 1e4) >= 1e4) return `${fixed(v / 1e8, a >= 99.995e8 ? 1 : 2)}억`; // 자릿수 고정: 4.30억 (한 말풍선 안에서 자리가 맞는다). 100억부터는 한 자리
  if (a >= 1e6) return `${comma(v / 1e4)}만`; // 100만 이상만 만 단위로(오차 0.5% 이하)
  return comma(v); // 100만 미만은 원 단위 그대로
};
/**
 * 축 하나에 단위 하나. max = 그 축에 그려지는 가장 큰 값, unit = 자료가 이미 나뉜 단위(만원 자료면 10000),
 * suffix = 눈금 뒤에 붙일 단위 글자(세로축이 둘인 그래프에서 '건'·'명'처럼 두 축을 가를 때).
 * 만 단위는 축이 2만 5천 이상일 때부터 쓴다. 그 아래는 숫자 그대로다(2,500 / 5,000 / 7,500 / 10,000 — 「0.25만 / 0.5만」이 되지 않게.
 * ndScale 의 반듯한 눈금으로는 3만부터 만 단위가 되고, 그때 눈금 간격은 1만 이상이다).
 * 억·조는 1억·1조부터다(만 단위로 적으면 「10,000만」이 축 너비를 넘는다. 그래서 1억 축은 0.25억 / 0.5억 / 0.75억 / 1억).
 */
const axisBy = (max: number, unit = 1, suffix = '') => {
  const a = Math.abs(max) * unit;
  const u = a >= 1e12 ? 1e12 : a >= 1e8 ? 1e8 : a >= 2.5e4 ? 1e4 : 1;
  const s = u === 1e12 ? '조' : u === 1e8 ? '억' : u === 1e4 ? '만' : '';
  return (given: any): string => {
    const v = toNum(given);
    return v === undefined ? '' : v === 0 ? '0' : `${exact((v * unit) / u, 4)}${s}${suffix}`;
  };
};
const pctOf = (digits: number | 'auto' = 1, ratio = false) => (given: any): string => {
  const v = toNum(given);
  if (v === undefined) return blank(given);
  const n = ratio ? v * 100 : v;
  return `${digits === 'auto' ? exact(n, 4) : fixed(n, digits)}%`; // 눈금용은 넷째 자리까지: 0.025% 가 0.03% 로 찍히지 않게
};
const signedOf = (unit: string, digits = 1) => (given: any): string => {
  const v = toNum(given);
  if (v === undefined) return '–';
  const s = fixed(v, digits); // 다른 표기와 같은 반올림. 반올림해 0 이 되면 부호 없이 0.0
  return `${v > 0 && /[1-9]/.test(s) ? '+' : ''}${s}${unit}`;
};
const numBy = (text: (n: number) => string) => (given: any): string => {
  const v = toNum(given);
  return v === undefined ? blank(given) : text(v);
};

/**
 * 숫자 표기. 숫자로 된 글자열("1234567")도 숫자로 읽어 표기한다. 숫자로 읽을 수 없는 값(이름, "00123" 같은 번호)은 받은 그대로 내보낸다.
 * 한 화면의 숫자 표기는 한 가지다: 같은 화면의 표·카드가 이미 쓰는 표기 함수가 있으면 그 함수를 말풍선·축에도 넘긴다
 * (ndTooltip({ value: 그 함수 })). ndFmt 는 그런 함수가 없는 화면의 기본이다.
 */
export const ndFmt = {
  /** 1,234,567 · 3.42 (소수는 둘째 자리까지, 끝의 0 은 뗀다) */
  num: numBy((n) => exact(n, 2)),
  /** 소수 자릿수를 고정한 수: ndFmt.numOf(2) → 3.40 */
  numOf: (digits: number) => numBy((n) => fixed(n, digits)),
  /** 금액을 읽기 쉽게(말풍선·카드용): 5.07억 · 3,467만 · 15,000. 100만 미만은 원 단위 그대로, 그 위는 오차 0.5% 이하로 줄인다 */
  won,
  /**
   * 이미 만원·천원·백만 원 단위로 나눈 자료의 금액: ndFmt.wonOf(10000) — 194,800(만원) → 19.48억.
   * 이렇게 옮기면 축과 말풍선이 억 단위가 된다: 카드 제목·축 이름에 적힌 옛 단위(「단위: 만원」)를 함께 고친다
   */
  wonOf: (unit: number) => (v: any): string => { const n = toNum(v); return won(n === undefined ? v : n * unit); },
  /** 축 눈금용 금액. 그 축의 최댓값으로 단위를 하나 정하고 값은 깎지 않는다: ndFmt.axisWonBy(top) → 0 / 0.35억 / 0.7억 / 1.05억 / 1.4억. 나뉜 자료는 둘째 인자에 단위 */
  axisWonBy: axisBy,
  /** 축 눈금용 수량(2만 5천 이상인 축은 만 단위): ndFmt.axisNumBy(top) → 0 / 2.5만 / 5만. 단위 글자를 붙이려면 ndFmt.axisNumBy(top, 1, '건') → 0 / 50건 / 100건 */
  axisNumBy: axisBy,
  /** 93.0% (말풍선·카드용) */
  pct: pctOf(1),
  /** 축 눈금용 비율: 깎지 않는다(0% / 12.5% / 25%) */
  axisPct: pctOf('auto'),
  /** 자릿수·비율 여부를 정한 비율 표기: ndFmt.pctOf(0) → 93%, ndFmt.pctOf(1, true) 는 0~1 값을 받는다, ndFmt.pctOf('auto', true) 는 그 축 눈금용 */
  pctOf,
  /** +7.0%p / -7.0%p */
  pp: signedOf('%p'),
  ppOf: (digits = 1) => signedOf('%p', digits),
  /** +12.3% / -4.5% (증감) */
  delta: signedOf('%'),
  deltaOf: (digits = 1) => signedOf('%', digits),
};

/* ───────── 빈 그래프 ───────── */

/** 데이터가 없을 때: 바닥선과 한 줄 안내 */
export function NdChartEmpty({ children, height }: { children?: React.ReactNode; height?: number }) {
  return (
    <div className="nd-chart-empty" style={height ? { minHeight: height } : undefined}>
      {children ?? '표시할 데이터가 없습니다'}
    </div>
  );
}
