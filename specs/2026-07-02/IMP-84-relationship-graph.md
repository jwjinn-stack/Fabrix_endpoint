# IMP-84 — 객체 관계를 목록이 아닌 클릭형 토폴로지 그래프로 (TopologyView/layout.ts 재사용)

- Type: ux (sev=medium, effort=M)
- Branch: feature/evolve-cycle6-ontology-ux
- Date: 2026-07-02

## 배경 / 문제

`ObjectView.tsx` 의 Related 섹션은 이웃을 linkKind 그룹의 **텍스트 목록**으로만 보여준다.
`components/topology` 에는 이미 완성된 그래프 렌더러(`layoutTopology()` 순수·결정적 seam +
`TopologyView`)가 있는데 객체 이웃 시각화에 재사용되지 않는다. 관계가 3~4단
(Service→Endpoint→Model→GPU→Node)으로 뻗을 때 목록으로는 위상을 못 읽는다(direction 4).

레퍼런스: Palantir Foundry 는 관계에 BOTH 표현(Links 위젯 목록 + Vertex node-link 그래프,
노드 클릭 시 hop). WAI complex-image / Deque accessible charts 는 node-link 를 complex image 로
보고 동등 텍스트/구조(표·목록) 폴백을 MUST 로 요구한다.

## 목표 (수용 기준)

1. ObjectView Related 에 **"그래프 / 목록" 세그먼트 토글** 추가. DEFAULT=목록(a11y-safe).
   선택은 urlState(`ovrel`)에 기억(deep-link·back 재현).
2. GRAPH 모드: head + 1-hop(기본) OntologyLink 이웃을 {TopologyNode[], TopologyEdge[]} 로 매핑,
   `layoutTopology()` 실행, `TopologyView` 렌더. 2-hop 은 명시적 depth 토글(expand)에서만.
3. 노드 클릭은 **기존 `traverse(id)` 재사용** — 클릭 객체로 그래프 재중심 + breadcrumb 확장.
   새 순회 상태 발명 금지.
4. `layout.ts` kind 타이핑 확장(유일한 비자명 변경): 미지 ontology kind 가 전부 'service' 로
   붕괴해 tier tie-break 를 잃지 않게 한다.
5. 상태색·시각 언어: objectTypeVisual 단일 출처 + glyph 이중 인코딩(WCAG 색-only 금지),
   엣지/노드 3:1 대비(라이트 baseline), 방향 화살표(from→to) 로 in/out 의미 보존(IMP-64).
6. linkKind-그룹 목록은 **항상 도달·키보드 순회 가능한 접근성 폴백**으로 유지(WCAG complex-image).

## 설계

### (A) layout.ts kind 타이핑 확장 — 유일한 비자명 코드 변경

`TopologyNode["kind"]` 를 `server|service|gpu` 에서 온톨로지 kind 를 포함하도록 **넓힌다**:
`"server" | "service" | "gpu" | "model" | "endpoint" | "node" | "trace" | "incident" | "app"`.

- `layout.ts` `KIND_ORDER` 를 넓힌 union 전체에 순위 부여(tier tie-break 유지):
  server=0 → node=1 → service=2 → app=3 → endpoint=4 → model=5 → trace=6 → gpu=7 → incident=8.
  (상류 인프라 → 논리 서비스/소비자 → 모델 → 물리 자원 → 경계, 온톨로지 위계와 정합.)
- `layout.ts` `kindOf` fallback 및 정렬은 미지 kind 를 안전 순위(끝)로 두는 `kindRank()` 로 대체 —
  Record 인덱싱이 undefined 를 내지 않도록 방어(순수·결정적 유지).
- `TopologyView.tsx` `NODE_R`(반경)·`Topology.tsx` `KIND_LABEL` 은 exhaustive `Record` →
  **부분 맵 + fallback 조회**로 바꿔 넓힌 union 에서도 컴파일·동작 동일(회귀 0).

새 매핑 함수 `objectTypeToTopoKind(type: ObjectType): TopologyNode["kind"]` 를 ObjectView 에서 사용:
Model→"model", Endpoint→"endpoint", Service→"service", GpuDevice→"gpu", Node→"node",
Trace→"trace", Incident→"incident", App→"app". 붕괴 없음.

### (B) ObjectView Related — 그래프/목록 토글

- urlState 스키마 `objectViewSchema` 에 `ovrel: enumField(["list","graph"], "list")` 추가(기본=목록).
- Related 섹션 헤더에 세그먼트 토글(role=tablist 아님 — 단순 2-버튼 segment, aria-pressed).
- GRAPH: `neighbors` 를 head + 1-hop 노드로 매핑. depth 토글(1-hop/2-hop)은 로컬 state
  (그래프 모드에서만 노출). 2-hop 은 index+links 로 BFS 없이 이미 로드된 head 링크의 이웃의 이웃을
  얻을 수 없으므로(links 는 head 것만 로드됨) — **2-hop 은 index 전체에서 1-hop 이웃들의 링크를
  재구성**한다. 즉 links(head 것) + 각 1-hop 이웃에 대해 index 로부터 유도된 링크가 필요.
  → 단순화: 2-hop 은 `fetchOntologyLinks` 를 이웃별로 재조회하지 않고, head 로드시 함께 온
  전체 그래프(index)로부터 **양끝이 표시 노드 집합에 있는 links 만** 그린다. 1-hop=head+직접이웃,
  2-hop=거기에 이웃의 이웃까지. links 는 head 것만 있으므로 2-hop 엣지는 표시 노드쌍으로 제한.
  (mock-first: 이웃 링크는 index 에 있는 객체 간 관계를 head-links 로만 알 수 있어 1-hop 이 실효
  기본. 2-hop 은 노드 집합 확장 + head-links 로 유도된 엣지 — hairball 방지 위해 노드만 확장.)
- TopologyView 에 `onSelect={(nodeId)=>traverse(nodeId)}` 배선. `selectedId={head}` 로 head 강조.
  `edgeStatusColor` 로 끝점 status 기반 색(IMP-64). `interactive={false}`(재배치 불필요, pan/zoom 유지).
- 그래프 컨테이너에 head 노드 자신 포함(자기 노드 = 그래프 중심 앵커).

### (C) 접근성 폴백

- 목록 모드가 DEFAULT 이며 항상 토글로 도달 가능.
- 그래프 모드일 때도 TopologyView 자체가 키보드 roving focus(←/→ Enter) + aria-label(노드·링크 수)
  를 이미 제공(IMP-48). 추가로 그래프 아래 "목록으로 보기" 안내는 토글로 흡수.
- glyph(상태 ✓/!/✕) + 색 이중 인코딩은 TopologyView 기존 구현 재사용.

## 데이터 매핑 (head 로드 결과 재사용 — 신규 fetch 없음)

- `poll.data.links`(head 링크) + `poll.data.index`(전체 객체) 를 이미 로드함.
- 1-hop 노드 = head + (head 링크의 반대편 중 index 에 실재하는 객체).
- 엣지 = head 링크 그대로(from/to, 방향 유지). error_rate/qps 없음 → edgeStatusColor 로 상태색.
- 2-hop 노드 = 1-hop + (이웃들의 index 기반 확장). 엣지는 표시 노드쌍에 양끝이 있는 head-links.
- 결정성: neighbors 정렬(id 사전순)·layoutTopology 순수 → 동일 입력 동일 그래프.

## 테스트 케이스 (ObjectView.test.tsx 확장 + layout.test.ts 보강)

1. **default=목록**: 마운트 시 Related 는 linkKind 그룹 목록 렌더(그래프 SVG 없음). 토글 존재.
2. **그래프 토글**: "그래프" 클릭 → TopologyView SVG(.topo-svg) 렌더, head + 1-hop 노드 수 일치.
3. **그래프 head+1-hop 렌더**: 노드 개수 = 1(head) + 직접이웃 수. 엣지 = head 링크 수.
4. **노드 클릭 → traverse + breadcrumb**: 그래프 노드 클릭 → head 재중심(제목 갱신) + breadcrumb push.
   (기존 traverse 재사용 — 새 상태 없음.)
5. **kind 매핑(no collapse-to-service)**: objectTypeToTopoKind 가 8개 타입을 각기 다른 kind 로.
   layout KIND_ORDER 가 모든 kind 에 순위 → tier tie-break 유지(미지→끝 순위, undefined 없음).
6. **목록 폴백 항상 도달·키보드**: 그래프 모드에서 "목록" 토글 클릭 → 목록 복귀, 이웃 버튼 포커스 가능.
7. **WCAG 이중 인코딩**: 그래프 노드에 상태 glyph(.topo-node-glyph) 병기(색-only 아님).
8. **2-hop expand**: depth 토글 노출(그래프 모드에서만), 2-hop 선택 시 노드 집합 확장(≥1-hop).
9. **layout 회귀**: 넓힌 union·부분 Record fallback 후에도 기존 layout.test/TopologyView.test green.

## 범위 밖

- 이웃별 2-hop 링크 재조회(신규 fetch) — 현 mock 계약에서 head-links 로만 유도. 후속.
- 그래프 저장/공유 이미지 export.

## 보안

SVG 렌더는 mock/계약 데이터만. dangerouslySetInnerHTML 미사용(라벨은 escape 텍스트).
crafted urlState(ovrel) 는 enumField 화이트리스트 → 미허용값은 default("list") 폴백.
