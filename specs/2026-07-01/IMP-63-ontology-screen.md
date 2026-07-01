# IMP-63 — Ontology/분석 화면 — Object/Link/Action 타입을 라이브 카탈로그·스키마 그래프로

- Type: ux (sev=medium) · Cycle4 온톨로지 · doc deliverable #6 (Explore group)
- Branch: `feature/evolve-cycle4-ontology`
- Sources: docs/palantir-ontology-analysis.md §1(Semantic↔Kinetic), §5.1(Object Types), §5.2(Link Types 그래프), §5.3(Action Types), §8(카피하는 "느낌" 3가지). 재사용: TopologyView(IMP-47) + ontology endpoints(IMP-56) + ACTION_REGISTRY(IMP-59).

## 문제 (Why)

이 분석 문서의 개념(Object/Link/Action 정의, §5.1–5.3 타입 그래프, semantic↔kinetic 두 축)이 **문서 안에만** 있고 제품 화면에는 없다. 신규 사용자·데모가 "FABRIX 를 온톨로지 렌즈로 본다"는 서사를 **화면으로 볼 수 없다**. 화면들(Topology/ObjectView/COP/Agent)은 이미 온톨로지를 소비하지만, 그 위에 있는 **타입 계층(어떤 명사·관계·동사가 있는가)을 한눈에 보여주는 개요 화면**이 없다.

## 해결 (What)

새 페이지 `/ontology` (라우트·nav·App switch 를 **같은 패스**로 등록해 빌드가 깨지지 않게). 4구성:

1. **개념 헤더** — semantic↔kinetic 두 축(§1) + 카피하는 "느낌" 3가지(§8: 온톨로지 렌즈 · Kinetic 제어 · 접지된 AI)를 제품 카피(한국어)로. 정적 텍스트지만 문서 출처를 그대로 반영.
2. **Object Type 카탈로그 카드** — 타입당 1장(Model/Endpoint/Service/GpuDevice/Node/Trace/Incident). 각 카드: 글리프+라벨+한 줄 설명 + **라이브 인스턴스 수**(`fetchOntologyObjects(type)`) + 상태 분포(ok/warn/crit/unknown) + 대표 인스턴스 title 몇 개. 카드/인스턴스 클릭 → ObjectView(useObjectView) 오픈(해당 타입 첫 객체 또는 클릭한 인스턴스).
3. **Link Type 스키마 그래프** — `TopologyView` 렌더러/`layout.ts` 를 재사용해 **스키마 레벨** 명사→관계 다이어그램을 그린다. Object **타입**이 노드, link kind(serves/runsOn/hostedBy/routedTo/executedOn/consumes/affects)가 라벨 엣지. §5.2 타입 그래프를 **실제 온톨로지 데이터에서 파생**(정적 그림 아님) — 라이브 링크에 존재하는 (fromType→toType, kind) 쌍만 엣지로.
4. **Action Type 목록** — `ACTION_REGISTRY` 에서 파생. 각 행: verb 라벨/이름 · 대상 Object Type · 필요 capability(requiredCap, 없으면 "기본 허용") · side effects.

**LIVE, 정적 복사 아님**: 인스턴스 수·상태 분포·스키마 엣지는 IMP-56 온톨로지 mock 엔드포인트에서 온다.

## 설계 (How)

- **순수 파생 모듈** `web/src/api/ontologySchema.ts`:
  - `buildObjectTypeCatalog(objects)` → 타입별 `{ type, count, statusCounts, samples }` (OBJECT_TYPES 순서 고정, 카운트 0 타입도 포함).
  - `buildSchemaGraph(objects, links)` → `TopologyGraph`(TopologyView 입력 shape). 노드 = 등장한 Object **타입**(id=`type:<ObjectType>`, kind=서버/서비스/gpu 로 결정적 매핑해 layout tier 안정화), 엣지 = 존재하는 (fromType→toType) 쌍 dedup, `qps` 로 인스턴스 링크 수를 실어 두께 인코딩(정보밀도). edgeLabel(kind)은 페이지가 별도로 링크 kind 를 매핑해 표에도 병기.
  - 전부 순수 → 단위 테스트로 가드. **layout.ts 는 수정 금지** — 데이터를 그 입력(TopologyNode/TopologyEdge) 형태로 맞춘다.
- **페이지** `web/src/pages/Ontology.tsx`:
  - 마운트 시 `fetchOntologyObjects()`(전체) + 스키마 엣지용 링크는 대표 객체 몇 개에 대해 `fetchOntologyLinks()` 를 병렬 수집(또는 타입쌍 파생). 로딩/에러/빈 상태 처리(SkeletonCards + state.error + empty).
  - 카탈로그 카드 그리드 · TopologyView(스키마 그래프, `interactive={false}` — 스키마는 재배치 불필요) · Action 표 · 개념 헤더.
  - `useObjectView()` + `<ObjectView/>` 로 카드 클릭 → 실제 인스턴스 상세(속성·관계 traverse·inline Action) 재사용.
- **배선(같은 패스)**: `router.ts`(`ontology` → `/ontology`, PAGE_CAP=dashboard) · `Layout.tsx` nav(상단 근처 — "관제" 다음 신규 항목, §7 Explore 성격) · `App.tsx` render switch · `Page` union 에 `ontology` 추가.
- **재사용**: TopologyView/layout(IMP-47) · fetchOntologyObjects/Links(IMP-56) · ACTION_REGISTRY(IMP-59) · ObjectView/useObjectView(IMP-57) · Badge/InfoTip/SkeletonCards/DataFreshness.

## 데이터 계약

- 신규 API/타입 없음(OntologyObject/OntologyLink/ActionType/ACTION_REGISTRY 재사용). 페이지-로컬 파생 타입 `ObjectTypeCard`/`SchemaEdge` 는 ontologySchema.ts 에 둔다.
- 스키마 그래프 노드는 TopologyNode(kind: server|service|gpu) 로 캐스팅 — ObjectType→kind 는 결정적 표시용 매핑(Node→server, Service/Endpoint/Model→service, GpuDevice→gpu, Trace/Incident→service)일 뿐 의미 없음(layout tier 안정용).

## 테스트 케이스 (normal/retry/failure/bad-input/env-missing)

- **normal**: 페이지가 Object Type 카드를 타입당 1장 렌더 + 라이브 인스턴스 수 표시 / 스키마 그래프가 타입 노드 + 라벨 링크 엣지 렌더 / Action 목록이 대상 type·capability·side-effects 표시 / 개념 헤더(느낌 3가지) 렌더.
- **retry(결정성)**: 같은 objects/links 로 `buildObjectTypeCatalog`·`buildSchemaGraph` 재호출 시 동일 결과(노드·엣지·카운트 동일 순서).
- **failure**: `fetchOntologyObjects` reject → 에러 상태(페이지 죽지 않음, alert).
- **bad-input**: 빈 objects(=[]) → 카드는 카운트 0 으로 렌더(그리드 유지), 스키마 그래프 빈 상태 graceful(throw 없음).
- **env-missing**: 온톨로지 링크 fetch 일부 reject → 스키마 그래프는 얻은 것만 그리고 페이지는 계속 동작.
- 상호작용: 카드/인스턴스 클릭 → ObjectView 드로어 오픈(속성 섹션) · route/nav 등록(`/ontology` → `ontology`).

## Out of scope

- 타입 편집/스키마 저작(팔란티어 Ontology Manager) — 읽기 개요만.
- layout.ts/ObjectView/온톨로지 types 수정(additive 배선만).
- 실 백엔드(mock-first; VITE_MOCK=off 면 동일 client 함수가 실백엔드로 나감).
