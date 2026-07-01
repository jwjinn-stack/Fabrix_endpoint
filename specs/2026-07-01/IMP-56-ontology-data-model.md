# 온톨로지 데이터 모델 계층 신설 (IMP-56)

Palantir Foundry 온톨로지의 Object/Link/Action 3원 모델을 FABRIX Endpoint 도메인(GPU inference 관측·제어)에
1급(first-class) 타입으로 신설한다. 이 계층은 cycle4(IMP-57/58/59/60/63)의 **기초(FOUNDATION)** 이다.

## 목적

- 기존 `types.ts` 는 화면별 응답 타입(ModelMetric·TopologyNode·Trace·Incident)만 나열 — 명사(Object)/관계(Link)/
  동사(Action)를 표현하는 **공용 계약(common contract)** 이 없다. Model·Endpoint·Service·GpuDevice·Node·Trace·Incident
  가 각 화면에 갇혀 있고, `Endpoint→Model→GPU→Node` 를 traverse 하는 공유 그래프 API 가 없다.
- 온톨로지 계층을 신설해 (1) 명사를 `OntologyObject<T>` 로 통일, (2) 관계를 `OntologyLink` 엣지로 노출,
  (3) 동사를 `ActionType` 로 선언(writeback 은 IMP-59 후속)한다.
- **단일 출처(single source of truth)**: 온톨로지는 기존 mock(Model/Gpu/Node/Endpoint/Trace/Incident)을 승격해
  생성 — 기존 화면·테스트는 그대로 유지. docs/palantir-ontology-analysis.md 5.1–5.3 표를 그대로 반영.

## 요구사항

1. **types.ts 온톨로지 계약**
   - `ObjectType` 유니온: `"Model" | "Endpoint" | "Service" | "GpuDevice" | "Node" | "Trace" | "Incident"` (5.1 표).
   - `LinkKind` 유니온: `"serves" | "runsOn" | "hostedBy" | "routedTo" | "executedOn" | "consumes" | "affects"` (5.2 표).
   - `ObjectStatus` 유니온: `"ok" | "warn" | "crit" | "unknown"` (온톨로지 공통 상태 렌즈).
   - `OntologyObject<T = Record<string, unknown>>`: `{ id; type: ObjectType; title; props: T; status: ObjectStatus; revision: number }`.
     - `revision`: 미래 Action writeback 의 stale-write(409) 경로를 **지금** 열어두기 위한 낙관적 동시성 필드.
   - `OntologyLink`: `{ from: string; to: string; linkKind: LinkKind }` (방향 엣지, from→to).
   - `ActionType`: `{ name; target: ObjectType; params: ActionParam[]; requiredCap?: string; sideEffects: string[] }` (5.3 표).
   - `ActionParam`: `{ name; kind: "text"|"number"|"enum"|"object"; required: boolean; options?: string[] }`.
   - 응답 래퍼: `OntologyObjectList { generated_at; objects: OntologyObject[]; source }`,
     `OntologyLinkList { generated_at; object_id; links: OntologyLink[]; source }`.

2. **mock.ts `buildOntology()` 팩토리** (mockFactory.ts 의 hash/statusFromThresholds/worstStatus 재사용)
   - 기존 `MODELS`/`ENDPOINTS`/`INCIDENTS` 정적 데이터 + `buildTopology`(GPU/Node/Service) + `genTraceList` 시드 로직을
     승격해 OntologyObject 배열과 OntologyLink 배열을 결정적으로 생성.
   - Object 매핑: Model(MODELS), Endpoint(ENDPOINTS), Service·Node·GpuDevice(TOPO 그래프), Trace(대표 몇 건), Incident(INCIDENTS).
   - Link 생성(5.2 척추): `Service--consumes-->Endpoint--serves-->Model--runsOn-->GpuDevice--hostedBy-->Node`,
     `Trace--routedTo-->Endpoint`, `Trace--executedOn-->GpuDevice`, `Incident--affects-->{object}`.
   - `status` 는 소스의 ready/severity/topology status 에서 파생(단일 출처). `revision` 은 초기 1.

3. **mock 라우터 엔드포인트 2종 + client.ts 메서드**
   - `GET /ontology/objects?type=&filter=` → `OntologyObjectList` (type 필터: ObjectType, filter: title/id 부분일치).
   - `GET /ontology/objects/:id/links?kind=` → `OntologyLinkList` (kind 필터: LinkKind. 미존재 id → 404).
   - client.ts: `fetchOntologyObjects(type?, filter?, signal?)`, `fetchOntologyLinks(id, kind?, signal?)`.

4. 기존 화면/테스트 불변 — 순수 추가(additive)만. 온톨로지는 기존 데이터에서 파생.

## 함수 시그니처

```ts
// types.ts
export type ObjectType = "Model" | "Endpoint" | "Service" | "GpuDevice" | "Node" | "Trace" | "Incident";
export type LinkKind = "serves" | "runsOn" | "hostedBy" | "routedTo" | "executedOn" | "consumes" | "affects";
export type ObjectStatus = "ok" | "warn" | "crit" | "unknown";
export interface OntologyObject<T = Record<string, unknown>> {
  id: string; type: ObjectType; title: string; props: T; status: ObjectStatus; revision: number;
}
export interface OntologyLink { from: string; to: string; linkKind: LinkKind; }
export interface ActionParam { name: string; kind: "text" | "number" | "enum" | "object"; required: boolean; options?: string[]; }
export interface ActionType { name: string; target: ObjectType; params: ActionParam[]; requiredCap?: string; sideEffects: string[]; }
export interface OntologyObjectList { generated_at: string; objects: OntologyObject[]; source: string; }
export interface OntologyLinkList { generated_at: string; object_id: string; links: OntologyLink[]; source: string; }

// mock.ts
function buildOntology(): { objects: OntologyObject[]; links: OntologyLink[] };

// client.ts
export function fetchOntologyObjects(type?: ObjectType, filter?: string, signal?: AbortSignal): Promise<OntologyObjectList>;
export function fetchOntologyLinks(id: string, kind?: LinkKind, signal?: AbortSignal): Promise<OntologyLinkList>;
```

## 테스트 케이스

- **normal**: `buildOntology()` 가 7개 ObjectType 을 모두 포함하는 objects + serves/runsOn/hostedBy/routedTo/
  executedOn/consumes/affects 링크를 생성. 모든 링크의 from/to 가 실재 object id 를 가리킴(dangling 없음).
  모든 object 에 revision>=1.
- **normal(라우터)**: `GET /ontology/objects` → 전체 목록. `GET /ontology/objects/:id/links` → 해당 object 의 링크.
- **filter by type**: `GET /ontology/objects?type=Model` → type==="Model" 만.
- **filter by text**: `?filter=<부분문자열>` → title/id 부분일치만.
- **links by kind**: `?kind=serves` → linkKind==="serves" 만.
- **retry**: 온톨로지는 결정적 — 두 번 호출해도 동일 id 집합(재현성).
- **failure/bad-input**: 알 수 없는 type/kind → 빈 배열(스키마 유지, 200). 알 수 없는 object id links → 404.
- **env-missing**: 백엔드 0개(mock)에서 client + 라우터가 정상 응답(프로젝트 ethos).

## 출력 위치

- web/src/api/types.ts (온톨로지 타입 추가)
- web/src/api/mock.ts (buildOntology + 라우터 2종)
- web/src/api/client.ts (fetch 메서드 2종)
- web/src/api/ontology.test.ts (신규 테스트)

## 의존성

- web/src/api/mockFactory.ts (hash·statusFromThresholds·worstStatus·buildTopology 재사용)
- 프로덕션 의존성 추가 없음(mock-first, 의존성 0개 ethos 유지)
