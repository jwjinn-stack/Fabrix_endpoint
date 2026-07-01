# IMP-66 — 온톨로지 관계 그래프 traverse — 클라이언트 그래프 helper (zero-dep typed adjacency)

- Type: oss (sev=medium) · Cycle4 온톨로지 · consolidation(리팩터)
- Branch: `feature/evolve-cycle4-ontology`
- Sources: graphology standard-library docs(평가 후 **채택 안 함** — 아래 OSS 판정), docs/palantir-ontology-analysis.md §5.2(Link Types 그래프).

## 문제 (Why)

IMP-56 온톨로지(OntologyObject/OntologyLink)가 landing 된 뒤, **관계 그래프를 손으로 traverse 하는 코드가 3곳에 흩어졌다**:

- `api/investigate.ts` — `byId` Map, `nextLink()`(양방향 이웃 + visited 필터 + linkKind 우선순), `pickBlastRadius.tryFrom()`(양방향 이웃 + type/visited 필터). 사실상 BFS 척추 확장을 ad-hoc 인접 루프로 구현.
- `api/ontologySchema.ts` — `typeIndex()`(id→type), 링크를 돌며 `from`/`to` 의 타입을 되찾아 타입쌍으로 dedup.
- `components/ObjectView.tsx` — 이웃을 linkKind 로 그룹화(방향 유지).
- `api/agent.ts` `toolTraverseLinks()` — 양방향 이웃 + linkKind 필터 + dedup.

같은 "인접/BFS/dedup" 이 매번 다른 손코드로 재구현되고 있어, 방향·visited·linkKind 필터 규약이 파일마다 미묘하게 갈릴 위험이 있다. 관계 그래프는 이제 **REAL surface** 다 — traverse 를 한 번 타입 안전하게 만들고 재사용해야 한다.

### OSS 판정 — graphology 채택 저울질 후 **기각**

- graphology(MIT)는 성숙한 그래프 라이브러리지만 **저속도(low-velocity)** 이고, 우리 온톨로지 규모(수십 노드·엣지)에는 과하다.
- `web/` 는 현재 **런타임 의존성이 react/react-dom 뿐**(zero-dep ethos). 이 작은 그래프를 위해 런타임 dep 을 들이는 것은 정당화되지 않는다.
- 결론: **손으로 짠 타입 있는 인접 헬퍼(~40–80줄) + 단위 테스트** 가 이 규모에서 더 낮은 리스크의 zero-dep 선택. `package.json` 에 어떤 의존성도 추가하지 않는다.

## 해결 (What)

1. 새 순수 모듈 `web/src/api/ontologyGraph.ts` — `OntologyGraph` 클래스(팩토리 `buildGraph` 병행). `OntologyObject[]` + `OntologyLink[]` 로 1회 인덱싱 후:
   - `has(id)` · `object(id)` · `type(id)` — id→객체/타입 조회(투영).
   - `neighbors(id, kind?)` — 방향 무관 이웃 객체(kind 필터, dedup, id 정렬).
   - `outLinks(id, kind?)` / `inLinks(id, kind?)` — 방향별 링크(kind 필터).
   - `bfs(startId, opts?)` — 무가중 BFS. `direction`(out|in|any) · `linkKind`(단일 또는 배열) · `maxDepth` 필터, cycle-safe(visited), 시작 노드 depth=0. 방문 순서 보존.
   - `shortestPath(fromId, toId)` — 무가중 BFS 최단경로(node id 배열). 없으면 `null`, from===to 면 `[from]`.
   - `subgraph(ids)` — 주어진 id 집합으로 유도된 부분그래프(양끝이 모두 집합에 있는 링크만) → 새 `OntologyGraph`.
   - 전부 `LinkKind`/`ObjectType` 로 강타입. **의존성 0개**.
2. `investigate.ts` · `ontologySchema.ts` 를 이 헬퍼로 리팩터 — 각자의 인접/BFS/dedup 손코드를 헬퍼 호출로 대체(**동작 보존**: 기존 `/investigate`·`/ontology` 테스트가 **수정 없이** 통과해야 함).
   - investigate.ts: `nextLink()` 의 후보 수집(양방향 미방문 이웃)을 `outLinks`/`inLinks` 로, `pickBlastRadius.tryFrom()` 의 이웃 수집을 `neighbors` 로. 결정적 선택(kind 우선순·id 정렬)은 그대로 유지.
   - ontologySchema.ts: `typeIndex()` 를 `graph.type()` 로. 타입쌍 집계 루프는 유지(그래프가 type 조회만 제공).
   - ObjectView 는 강제하지 않는다 — 컴포넌트 내부 그룹화가 헬퍼로 자명하게 표현되지 않으면 그대로 둔다(범위 밖).
3. **consolidation**: 순 효과 = 테스트된 그래프 primitive 하나 + 얇아진 caller. 화면/ mock 출력 **불변**.

## 설계 (How)

- `OntologyGraph` 는 생성자에서 3개 인덱스를 1회 구성: `byId: Map<string, OntologyObject>`, `out: Map<string, OntologyLink[]>`, `in: Map<string, OntologyLink[]>`. 조회는 전부 O(1)~O(deg).
- 결정성: `neighbors`/`bfs` 의 이웃 확장 순서는 **id 사전순 정렬**(mock/테스트 재현성). 링크 배열은 삽입 순 유지(caller 가 정렬).
- 방향 규약: 링크는 `from→to`. `out(id)`=id 가 from 인 링크, `in(id)`=id 가 to 인 링크, `neighbors`/`any`=둘 다.
- kind 필터: `LinkKind` 단일 또는 `LinkKind[]`. 알 수 없는/미존재 id → 빈 결과(throw 없음).
- `subgraph` 는 원본을 변형하지 않고 새 인스턴스 반환(순수).
- `mockFactory`/`layout.ts`/types.ts 는 **수정 금지**(traversal 데이터 모델만). 신규 API/타입 없음(그래프는 파생 유틸).

## 데이터 계약

- 신규 API/응답 타입 없음. `OntologyGraph`(+ `BfsOptions`/`Direction`)는 `ontologyGraph.ts` 로컬 export.
- 입력은 기존 `OntologyObject`/`OntologyLink`. 출력은 객체/링크/ id 배열.

## 테스트 케이스 (normal/retry/failure/bad-input/env-missing)

- **normal**:
  - `neighbors(id)` 양방향 이웃(dedup·id 정렬), `neighbors(id, kind)` 로 kind 필터.
  - `outLinks(id, kind)` / `inLinks(id, kind)` 방향·kind 필터가 정확.
  - `bfs(start, {maxDepth})` 가 depth 로 절단, `bfs(start, {linkKind})` 가 특정 관계만 따라감, `bfs(start, {direction})` 방향 제한.
  - `shortestPath(a, z)` 가 척추 최단경로 반환, `shortestPath(a,a)=[a]`.
  - `subgraph(ids)` 가 유도 부분그래프(양끝 모두 포함된 링크만).
- **retry(결정성)**: 같은 입력으로 두 번 만든 그래프의 `bfs`/`neighbors`/`shortestPath` 결과 동일 순서.
- **failure**: 존재하지 않는 시작 id → `bfs` 는 빈 배열(또는 시작만), `shortestPath(unknown, x)` → `null`.
- **bad-input**: `neighbors("없는id")` → `[]`, `shortestPath` 연결 없음 → `null`, 빈 objects/links → 빈 그래프(throw 없음).
- **cycle-safe**: 사이클(a→b→a) 있는 그래프에서 `bfs`/`shortestPath` 가 무한 루프 없이 종료(visited).
- **비회귀(consolidation 핵심)**: 기존 `investigate.test.ts`(buildRootCausePath 척추·blast·결정성) + `ontologySchema.test.ts`(카탈로그·스키마 그래프·dangling) + `ontology.test.ts`(라우터 응답) 가 **수정 없이 전부 통과**.

## Out of scope

- graphology(또는 어떤 런타임 dep) 추가 — 명시적으로 기각(zero-dep).
- 가중 그래프/다익스트라 — 온톨로지 링크는 무가중.
- ObjectView 그룹화 강제 리팩터 · agent.ts toolTraverseLinks 시그니처 변경(공개 tool 계약 보존).
- layout.ts(SVG 레이아웃) · types.ts · mockFactory.ts 수정.
