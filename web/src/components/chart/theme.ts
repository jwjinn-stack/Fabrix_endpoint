// 공용 차트 테마 — 토큰화 상수 단일 출처(IMP-25).
// 의존성 0. 모든 색/폰트는 index.css 의 CSS 변수를 그대로 참조해
// 라이트/다크 테마와 고객사 액센트 변경에 자동 반영된다. 네온 금지.

// 차트 여백 1종(컴포넌트별 손수 PAD 분산 방지).
export const CHART_PAD = { top: 16, right: 48, bottom: 24, left: 40 } as const;
export type ChartPad = { top: number; right: number; bottom: number; left: number };

// 축/그리드 색·폰트 — WCAG 정렬:
//  · 축/범례 텍스트는 1.4.3 대비 4.5:1 → var(--text-dim)
//  · 그리드선(비텍스트 그래픽)은 1.4.11 대비 3:1 근방 → var(--grid-line)
export const AXIS_FILL = "var(--text-dim)";
export const GRID_STROKE = "var(--grid-line)";
// 축 폰트는 토큰(--fs-xs=11px). fontSize 하드코딩(9/10) 금지 → .chart-axis-text 클래스로 강제.
export const AXIS_FONT_VAR = "var(--fs-xs)";

// 일관 시리즈 팔레트 — 기존 토큰 재사용(스틸블루/청록/적색).
export const SERIES = {
  primary: "var(--primary)",
  teal: "var(--teal)",
  red: "var(--red)",
} as const;

// 정규화된 가로 그리드 비율(기본 5선). WCAG 권고: 최대 ~10선.
export const DEFAULT_GRID_RATIOS = [0, 0.25, 0.5, 0.75, 1];
