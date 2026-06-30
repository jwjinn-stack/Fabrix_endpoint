# 기능: 공용 차트 프리미티브 + 호버 크로스헤어/readout + 토큰 축 (IMP-25)

## 목적
차트가 컴포넌트마다 독립 SVG 로 손수 그려져 축 폰트(9~10px 하드코딩, 토큰 미사용)·색·여백·그리드가 제각각이다. 핵심 `TimeseriesChart` 조차 마우스 호버 시 해당 시점 QPS/TTFT/차단 값을 읽어주는 Grafana 식 크로스헤어 readout 이 없다(드래그 줌만 있음).

의존성 0 을 유지한 채 자체 공용 SVG 프리미티브(`web/src/components/chart/`)로 시각언어를 통일한다.
- 축 텍스트(축·범례)는 WCAG **1.4.3 대비 4.5:1** (`var(--text-dim)`), 그래픽 객체(그리드선)는 **1.4.11 비텍스트 대비 3:1** 의 두 별개 임계로 정렬.
- 축 폰트 `fontSize={9|10}` 하드코딩 → 토큰 기반 `var(--fs-xs)`(11px).
- `TimeseriesChart` 에 수직 크로스헤어 + 시리즈 마커 + 시점 값 박스(readout)를 추가. 드래그줌과 공존(드래그 중 selection 우선, idle hover 만 readout). 포커스 시 좌우 화살표로 크로스헤어 이동.
- 라이트 + 스틸블루(엔터프라이즈) 팔레트만. 네온 금지.

## 요구사항
1. `web/src/components/chart/theme.ts` — 토큰화 상수 단일 출처.
   - `CHART_PAD` 1종(top/right/bottom/left) 기본값 + 변형 헬퍼.
   - 축/그리드 색·폰트는 CSS 변수 문자열 상수(`AXIS_FILL='var(--text-dim)'`, `GRID_STROKE='var(--grid-line)'`, `AXIS_FONT_VAR='var(--fs-xs)'`).
   - 일관 시리즈 팔레트 배열(스틸블루/청록/적색 — 기존 `--primary`/`--teal`/`--red` 토큰 재사용).
2. `web/src/components/chart/Axis.tsx` — `<AxisText>` 헬퍼: 토큰 폰트/색을 강제하는 `<text>` 래퍼(`className="chart-axis-text"` 부여, `fontSize` 하드코딩 금지). y/x 라벨 공용.
3. `web/src/components/chart/Grid.tsx` — `<HGrid>`: 정규화 비율 배열(기본 5선, 최대 ~10선) → 가로 그리드선 + (옵션) y라벨. 토큰 색 사용.
4. `web/src/components/chart/Legend.tsx` — `<Legend>`: `{label,color}` 항목 배열을 `.chart-legend`/`.dot` 클래스로 렌더(기존 CSS 재사용).
5. `web/src/components/chart/useChartHover.ts` — 호버 훅.
   - 입력: svg ref, `count`(데이터 개수), 좌표 변환 파라미터(`viewW`, `padLeft`, `innerW`).
   - 마우스 clientX → 최근접 데이터 인덱스 산출(`indexFromClientX`), `hoverIndex` 상태, `focusIndex`(키보드용), `onMouseMove/onMouseLeave`, `moveBy(delta)` 노출.
   - 활성 인덱스(`activeIndex`) = hover 우선, 없으면 focus.
6. `web/src/components/chart/Crosshair.tsx` — `<Crosshair>`: 수직선 + 데이터 포인트 마커(원) 렌더. 토큰 색.
7. `web/src/components/chart/ChartTooltip.tsx` — `<ChartTooltip>`: foreignObject 기반 오버레이 div. 라벨/값 행을 **이스케이프된 텍스트**로만 렌더(절대 dangerouslySetInnerHTML 금지). 토큰 적용.
8. `TimeseriesChart` 리팩터:
   - 축 텍스트를 `<AxisText>` 로 교체(토큰 폰트/색), 그리드를 `<HGrid>`(또는 동일 토큰)로.
   - `useChartHover` 로 idle hover → 수직 크로스헤어 + QPS/TTFT 마커 + readout 박스(`<ChartTooltip>`).
   - 드래그 중에는 readout 숨김(selection 우선). 기존 드래그줌·키보드 +/-/0 줌 동작 보존.
   - 포커스 상태에서 ArrowLeft/ArrowRight 로 크로스헤어 인덱스 이동(이벤트는 기존 onKeyDown 과 공존, 줌 키와 충돌 없음).
9. `UsageTrendChart` 리팩터: 축 텍스트/그리드를 프리미티브로 교체(토큰 폰트/색). 동작(회귀·밴드) 보존.
10. `Sparkline` 리팩터: theme 팔레트 상수 사용으로 색 기본값 정렬(SVG 구조 보존, 미니 위젯이라 축/크로스헤어 없음).
11. CSS: `.chart-axis-text { font-size: var(--fs-xs); fill: var(--text-dim); }` + 크로스헤어/readout 토큰 클래스 `index.css` 에 추가.

### 마이그레이션 범위
- 마이그레이션: `TimeseriesChart`(크로스헤어+readout+토큰축), `UsageTrendChart`(토큰축/그리드), `Sparkline`(팔레트 상수).
- 후속(deferred, 이번 미포함): `StackedShareBar`·`EventHistogram`·`PipelineWaterfall` — 동일 프리미티브로 정렬은 후속 작업. 본 변경의 프리미티브는 이들도 채택 가능하도록 설계.

## 함수 시그니처
```ts
// theme.ts
export const CHART_PAD = { top: 16, right: 48, bottom: 24, left: 40 } as const;
export const AXIS_FILL = "var(--text-dim)";
export const GRID_STROKE = "var(--grid-line)";
export const SERIES = { primary: "var(--primary)", teal: "var(--teal)", red: "var(--red)" } as const;

// Axis.tsx
export function AxisText(props: {
  x: number; y: number; children: React.ReactNode;
  anchor?: "start" | "middle" | "end"; dim?: boolean;
}): JSX.Element;

// Grid.tsx
export function HGrid(props: {
  ratios?: number[]; padLeft: number; right: number; top: number; innerH: number;
  label?: (ratio: number) => React.ReactNode; // 우측 보조라벨 등
}): JSX.Element;

// Legend.tsx
export function Legend(props: { items: { label: React.ReactNode; color: string }[] }): JSX.Element;

// useChartHover.ts
export function useChartHover(opts: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  count: number; viewW: number; padLeft: number; innerW: number;
}): {
  hoverIndex: number | null;
  focusIndex: number | null;
  activeIndex: number | null;
  indexFromClientX: (clientX: number) => number;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  setFocusIndex: (i: number | null) => void;
  moveBy: (delta: number) => void;
};

// Crosshair.tsx
export function Crosshair(props: {
  x: number; top: number; innerH: number;
  markers?: { y: number; color: string }[];
}): JSX.Element;

// ChartTooltip.tsx
export function ChartTooltip(props: {
  x: number; viewW: number; top: number; innerH: number;
  title: string; rows: { label: string; value: string; color?: string }[];
}): JSX.Element;
```

## 테스트 케이스
- `useChartHover`: `indexFromClientX` 가 getBoundingClientRect(mock)+viewW/pad 로 최근접 인덱스를 정확히 산출(좌/중/우 경계).
- `onMouseMove` 가 `hoverIndex` 를 갱신, `onMouseLeave` 가 null 로.
- `moveBy(+1)/moveBy(-1)` 가 focusIndex 를 [0,count-1] 클램프하며 이동.
- TimeseriesChart: 마우스 move(mock rect) 시 크로스헤어 `<line class=chart-crosshair-line>` 와 readout 텍스트(QPS 값)가 렌더된다.
- TimeseriesChart: 포커스 후 ArrowRight 로 크로스헤어 인덱스가 증가(readout 값 변화).
- TimeseriesChart: 드래그줌(mousedown→move→up) 후 view 가 좁혀진다(기존 동작 보존).
- 축 텍스트가 토큰 클래스(`chart-axis-text`)를 쓰며 `fontSize="9"` 하드코딩이 없다.

## 출력 위치
- `web/src/components/chart/{theme.ts,Axis.tsx,Grid.tsx,Legend.tsx,Crosshair.tsx,ChartTooltip.tsx,useChartHover.ts,index.ts}`
- `web/src/components/TimeseriesChart.tsx`(리팩터), `UsageTrendChart.tsx`(리팩터), `Sparkline.tsx`(팔레트)
- `web/src/components/chart/useChartHover.test.tsx`, `web/src/components/chart/TimeseriesChart.test.tsx`
- `web/src/index.css`(`.chart-axis-text`/크로스헤어/readout 클래스)

## 의존성
없음 (자체 SVG 프리미티브만; 신규 런타임 의존성 0).
```
```
