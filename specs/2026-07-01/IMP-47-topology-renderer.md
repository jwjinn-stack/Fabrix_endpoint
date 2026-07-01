# IMP-47 — 운영 토폴로지 그래프 렌더러 (hand-rolled 계층 SVG, zero-dep)

## 목적
운영 토폴로지(server → service → gpu)를 **신규 런타임 의존성 0**으로 렌더하는 재사용 프리미티브를 만든다.
`oss-evaluate` 확정: React Flow / elkjs / dagre 모두 채택하지 않는다(정책 예외·번들·라이선스 회피).
레이아웃을 순수 함수로 격리(seam)해 후일 dagre 스왑 시 콜사이트 변경이 0이 되게 한다.

이 아이템은 **렌더러 컴포넌트 + 레이아웃 엔진**만 다룬다. 실제 Topology 페이지(라우트·상태·SlidePanel
드릴다운)는 IMP-45, 고급 시각(arc·micro-metric·애니)은 IMP-48에서 진행한다.

## 요구사항
- ZERO new deps. hand-rolled SVG(`web/package.json` deps 추가 금지).
- 기존 chart 프리미티브 재사용: `theme.ts` 토큰(신규 색 금지), `ChartTooltip`, `useChartHover` 좌표 변환 관례.
- 상태 색은 GpuLedGrid 관례와 통일: ok=`--green`, warn=`--amber`, crit=`--red`.
- responsive viewBox SVG, pan/zoom = viewBox transform state(d3-zoom 불필요).
- observe read-only: drag/edit 비활성, pan/zoom/hover는 유지(cap 게이팅은 IMP-45 화면에서 prop 으로 주입).
- 접근성: SVG `role`/`aria-label`, roving focus(useChartHover focusIndex 패턴), reduce-motion 정적.
- `dangerouslySetInnerHTML` 금지 — 모든 라벨은 React 텍스트 노드로 이스케이프 렌더.

## 함수 시그니처 (seam)

### `web/src/components/topology/layout.ts`
```ts
export interface LayoutOptions {
  colGap?: number;    // tier(레이어) 간 x 간격
  rowGap?: number;    // tier 내 노드 y 간격
  marginX?: number;
  marginY?: number;
  sweeps?: number;    // barycenter 정렬 sweep 횟수(기본 4)
}
export interface NodePosition { x: number; y: number; tier: number }
export interface EdgePath { from: string; to: string; d: string; reversed: boolean }
export interface TopologyLayout {
  positions: Map<string, NodePosition>;
  edgePaths: EdgePath[];
  width: number;
  height: number;
}
// 결정적·순수. 같은 (nodes, edges, options) → 같은 결과. 이 시그니처가 dagre 스왑 seam.
export function layoutTopology(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  options?: LayoutOptions,
): TopologyLayout;
```

레이아웃 파이프라인(결정적):
1. **tier 배치** — DAG longest-path 레이어링. cycle 은 DFS back-edge 역전으로 제거(reversed 플래그 보존).
   kind(server/service/gpu)는 동률 시 정렬 tie-break 에만 사용(강제 컬럼 아님 — longest-path 우선).
2. **tier 내 정렬** — barycenter/median sweep 1~N회(기본 4, down/up 교대)로 엣지 교차 감소.
3. **좌표** — tier=column(x), tier 내 순서=row(y). x/y spacing 은 options.
4. **엣지 경로** — 가로 방향 3차 Bézier(`M … C …`) `d` 문자열. reversed 엣지는 논리 방향(from→to) 기준으로 그대로 그린다.

### `web/src/components/topology/TopologyView.tsx`
```ts
export interface TopologyViewProps {
  graph: TopologyGraph;
  interactive?: boolean;   // false(observe read-only) → 노드 drag 비활성. pan/zoom/hover 는 유지.
  onSelect?: (nodeId: string) => void; // 노드 클릭(IMP-45 드릴다운)
  height?: number;
}
```
- responsive `viewBox` SVG. 노드 = `<g>`(status 링 + 이스케이프 라벨), 엣지 = `<path>` + 공유 `<marker>` 화살촉.
- pan = 드래그(빈 배경), zoom = wheel → viewBox transform state.
- 노드 drag = pointer 로 positions override(interactive only).
- hover/focus = nearest-node 히트테스트(client-coord → viewBox → nearest). `ChartTooltip` 재사용.
- keyboard roving focus(useChartHover focusIndex 패턴), Enter/Space → onSelect.

## 테스트 케이스
### layout.test.ts (Vitest, 순수)
- **결정성**: 같은 입력 두 번 → 동일 positions/edgePaths.
- **cycle break**: 사이클 포함 그래프 → 무한루프 없이 완료, 최소 1개 엣지 reversed=true.
- **barycenter 교차 감소**: sweep 후 교차수 ≤ 초기(naive) 교차수(회귀 가드).
- **tier 배치**: server→service→gpu 체인의 tier 단조 증가.

### TopologyView.test.tsx (RTL)
- 노드 수/엣지 path 수만큼 SVG 요소 렌더.
- 마우스 hover(client → viewBox nearest) → ChartTooltip 라벨 노출.
- `interactive={false}` → 노드 pointerDown drag 로 위치가 바뀌지 않음(read-only).
- 노드 클릭 → onSelect(nodeId) 호출.

## 출력 위치
- `web/src/components/topology/layout.ts`
- `web/src/components/topology/layout.test.ts`
- `web/src/components/topology/TopologyView.tsx`
- `web/src/components/topology/TopologyView.test.tsx`
- `web/src/components/topology/index.ts` (배럴)
- (필요 시) `web/src/index.css` topology 클래스 추가

## 의존성
없음(hand-rolled). 기존 chart 프리미티브·theme 토큰만 재사용. `web/package.json` 변경 없음.
