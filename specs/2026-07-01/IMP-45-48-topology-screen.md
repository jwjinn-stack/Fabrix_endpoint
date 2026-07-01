# IMP-45 + IMP-48 — 운영 토폴로지/의존성 그래프 화면 + Datadog/Grafana 시각 완성도

- 브랜치: `feature/evolve-cycle3-topology`
- 날짜: 2026-07-01
- 성격: greenfield 화면(IMP-45, ux/high) + 시각 완성도(IMP-48, aesthetic) — 두 항목이 한 화면에 결합되므로 함께 빌드.
- 제약: ZERO new deps. light + steel-blue, 네온 금지. air-gapped(자체 SVG, CDN 금지). mock-first(fetchTopology). cap=dashboard.

## 목적
서버·서비스·GPU 의존성 그래프를 관제 화면으로 제공한다. 노드 자신에 health·micro-metric 을 인코딩하고
directional 엣지(트래픽 비례 두께·에러 색)를 그려 Datadog/Grafana 수준의 정보밀도를 낸다.
노드 클릭 시 상세 드릴다운(SlidePanel)과 subgraph isolate(선택 노드의 upstream/downstream 강조, 비인접 dim)을 제공하고,
접근성을 위해 표-보기 토글 + 상단 텍스트 요약(위험 노드 N · 병목 엣지 M)을 함께 둔다.

## 요구사항

### IMP-45 (화면/동선/접근성)
- 신규 `web/src/pages/Topology.tsx`.
- `web/src/router.ts`: 신규 page `topology`, path `/topology`, `PAGE_CAP.topology = "dashboard"`.
- `web/src/components/Layout.tsx`: `Page` 유니온에 `"topology"` 추가 + NAV flat 항목 1개(그룹핑은 IMP-53).
- `web/src/App.tsx`: `effPage === "topology"` → `<Topology />` 렌더.
- `fetchTopology()` → `TopologyView` 배치. `caps.readonly` 로 `interactive` 게이팅(readonly=관측 → interactive=false).
- 노드 클릭 `onSelect(nodeId)` → **SlidePanel 상세**(노드명·kind·status·연결수(in/out)·지표) — IMP-31 SlidePanel + DetailRow 재사용.
- **상태 처리**: 로딩=Skeleton, 빈=empty, 에러=humanizeError.
- **접근성(W3C complex-image 동등 대안)**:
  - 그래프 = roving-tabindex 단일 위젯(TopologyView 제공).
  - **'표로 보기' 토글** → 노드/엣지 데이터 테이블(색-only 금지, status 텍스트 병기).
  - 상단 텍스트 요약: `위험 노드 N · 병목 엣지 M`.
  - reduce-motion 은 TopologyView 가 CSS 로 처리.

### IMP-48 (시각 완성도 — TopologyView 확장, IMP-47 비회귀)
1. **NODE health → 노드 자신의 ring 색**(이미 IMP-47 구현, 유지). status→ring: ok=green/warn=amber/crit=red.
2. (옵션) **proportional multi-arc ring**: node.metrics 에서 success/error 비율을 arc 로. 대부분 green이면 healthy.
   AA: amber/red arc 는 색-only 금지 → 상태 글리프(text ✓/!/×)를 노드 중앙에 병기(WCAG 1.4.1).
3. **노드 body 안 micro-metric 1-2개 임베드**: qps·error%(service) 또는 util%(gpu/server). bare circle 과 프리미엄 가르는 정보밀도.
4. **엣지 directional**: 항상 화살표(기존 마커) + 트래픽(qps) 비례 stroke-width(clamp 1.2~5) + 에러율 색(err≥5%=red, ≥2%=amber, else 기본);
   **select(isolate) 시 흐름 애니메이션**(stroke-dashoffset, prefers-reduced-motion 뒤).
5. **click(select)로 subgraph isolate**: 선택 노드의 upstream/downstream 인접 노드·엣지 강조 + 비인접 dim. hover 아님(hover 는 기존 highlight).
   - Caveat: isolate=click. 과한 그림자 금지. amber/red 는 아이콘/텍스트 병기.
- TopologyView 신규 props(선택): `selectedId?: string` (isolate 앵커, controlled), `showMetrics?: boolean`(micro-metric on/off, 기본 true).
  기존 props(graph/interactive/onSelect/height) 시그니처·기본동작 불변 → IMP-47 테스트 비회귀.

## 함수 시그니처
- `Topology.tsx`: `export default function Topology(): JSX.Element`
- 내부 상태: `graph|null, error|null, loading, selectedId|null, showTable(bool)`.
- 요약 파생: `riskNodes = nodes.filter(status!=='ok').length`, `bottleneckEdges = edges.filter(err>=0.05 || qps 상위).length`.
- TopologyView 확장 props: `selectedId?: string | null; showMetrics?: boolean;`
- isolate 계산(TopologyView 내부): 선택 노드 기준 인접 집합(1-hop upstream/downstream) → 비인접 노드/엣지 opacity 낮춤.
- 엣지 시각 헬퍼(TopologyView 내부): `edgeStrokeWidth(qps?)`, `edgeColor(errorRate?)`.

## 테스트 케이스(RTL — `web/src/pages/Topology.test.tsx`)
1. 화면 렌더: 제목 + TopologyView(노드/엣지 SVG) 노출.
2. 로딩=Skeleton, 에러=humanizeError 메시지(role=alert), 빈=empty 안내.
3. 표토글: '표로 보기' 클릭 → 노드/엣지 테이블 노출(status 텍스트 병기).
4. 노드 클릭 onSelect → SlidePanel 상세(노드명·연결수) 노출.
5. click-isolate: 노드 클릭 시 selectedId 전파 → 비인접 노드 dim 적용(class/opacity 확인).
6. 요약 카운트: '위험 노드 N' 텍스트가 mock graph 기준 정확.
- TopologyView 확장 테스트(`web/src/components/topology/TopologyView.test.tsx` 보강): micro-metric 텍스트 렌더, directional 엣지 stroke-width 변주, selectedId 시 비인접 dim.
- jsdom PointerEvent quirk → 기존 firePointer 헬퍼 재사용.

## 출력 위치
- `web/src/pages/Topology.tsx` (신규)
- `web/src/pages/Topology.test.tsx` (신규)
- `web/src/components/topology/TopologyView.tsx` (확장)
- `web/src/components/topology/TopologyView.test.tsx` (보강)
- `web/src/router.ts` · `web/src/components/Layout.tsx` · `web/src/App.tsx` (등록)
- `web/src/index.css` (topo micro-metric/arc/dim/flow-anim 스타일)

## 의존성
- none(신규 패키지 0). 재사용: TopologyView(IMP-47), fetchTopology(IMP-55), SlidePanel(IMP-31), humanizeError(IMP-16/26), Skeleton, ChartTooltip/theme(IMP-25).

## 게이트
`cd web && npx tsc -p tsconfig.json --noEmit && npm run lint && npm test && npm run build`
