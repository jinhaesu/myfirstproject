// 차트 색: 강조(널담 블루) 하나 + 같은 잉크빛의 명암 단계.
// 값은 globals.css 의 --chart-1..10 이고, 밝은/어두운 화면에 따라 바뀐다.
// SVG fill/stroke 와 style 의 color/background 에 그대로 쓸 수 있다.
// (뒤에 투명도 두 자리를 이어 붙이는 `${색}20` 방식에는 쓸 수 없다.)
export const CHART_COLORS: string[] = Array.from({ length: 10 }, (_, i) => `var(--chart-${i + 1})`);
