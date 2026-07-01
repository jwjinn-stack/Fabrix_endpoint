# IMP-73 — 온톨로지·메트릭 read tool 을 MCP tool/resource 로 노출, 프론트/백엔드 스키마 단일화(레지스트리 파생)

- **Type**: code (sev=high, effort=L)
- **Branch**: `feature/evolve-cycle5-active-ontology`
- **Date**: 2026-07-02
- **Backlog**: evolve/IMPROVEMENTS.md — IMP-73

## Why (문제)

focus 방향(7)은 "모든 기능이 MCP tool 로 노출·소비되어 분석이 쉬워야 함"을 요구한다. 현재:

1. **프론트 tool 정의가 mock 안에만 산다.** `web/src/api/agent.ts:20` 은 3개 read tool(`queryObjects`/`traverseLinks`/`getIncidents`)을 "실제 MCP tool 과 동일한 시그니처"라 주석하지만, 실제로는 백엔드와 공유되지 않는 **private 정의**다 → 스키마 드리프트 위험이 실재한다.
2. **백엔드 MCP 정의가 둘로 발산한다.** `mcp.go` 는 protocolVersion `2024-11-05` 하드코딩 + 수기 `tools/list`(4개 aggregate 대시보드 tool), `mcp_v2.go` 는 go-sdk 자동 협상 + typed `AddTool`(groupby_metric 1개만). 온톨로지 tool 은 **0개** — objects/links/actions·per-object 메트릭이 MCP 로 노출되지 않는다.
3. tool 스키마의 **단일 출처가 없다.** LLM 이 malformed/hallucinated args 를 낼 수 있는데, 프론트/백엔드가 각자 스키마를 손으로 미러하면 어긋난다.

이미 `web/src/actions/registry.ts`(ACTION_REGISTRY)가 **mutation 의 단일 출처**(params/requiredCap/allowedStatus/sideEffects; `<ActionForm>` + mock `applyAction` 이 함께 읽고 서버 등가 403 거부)로 검증된 in-repo 패턴이다. 이 패턴을 **read tool 계약**으로 확장한다.

## What (범위)

### 1. 단일 레지스트리 — `ONTOLOGY_TOOL_REGISTRY`

`web/src/actions/ontologyTools.ts` 신설. MCP-canonical tool 명 keyed + input JSON Schema:

| tool (MCP canonical) | input schema | agent 매핑 |
|---|---|---|
| `query_objects` | `{type?: enum(ObjectType), filter?: string}` | `queryObjects` |
| `traverse_links` | `{objectId: string(required), linkType?: enum(LinkKind)}` | `traverseLinks` |
| `get_object` | `{id: string(required)}` | (MCP 전용) |
| `get_object_metrics` | `{id: string(required), range?: enum(1h|6h|24h|7d)}` | (MCP 전용) |

- 각 엔트리: `name`, `description`, `inputSchema`(JSON Schema Draft, `type:object` + `properties` + `required` + `additionalProperties:false`). **enum 은 `ObjectType`/`LinkKind` union 에서 파생**(하드코딩 목록 아님).
- `emitOntologyToolSchemas()` 가 committed `.json` 아티팩트로 직렬화(결정적 key 정렬). Go 가 이 파일을 `go:embed` 로 로드해 그대로 `AddTool` 에 먹인다 → **수기 미러 금지**.
- read-only 불변식을 코드로 강제: 레지스트리에 mutating 동사(create/update/delete/set/write/patch/scale/restart/drain/cordon…)가 **구조적으로 들어올 수 없다**(테스트 가드 + 이름 검사).

### 2. TS→Go 계약 아티팩트

- `web/src/actions/ontology-tools.schema.json` (committed) — `emitOntologyToolSchemas()` 출력.
- `web/src/actions/ontologyTools.emit.test.ts` — 레지스트리에서 emit 한 값이 committed `.json` 과 **정확히 일치**(drift canary; 불일치 시 실패 + 재생성 안내).
- Go: `backend/internal/server/ontology_tools_schema.json`(같은 파일을 심볼릭 복사가 아니라 build 스크립트/커밋으로 동기) 을 `go:embed` — 그리고 `mcp_contract_test.go` 가 **Go 가 로드한 스키마 == web 아티팩트**임을 assert(양측 파일 바이트 동일).

### 3. 백엔드 — SDK path canonical

- `mcp_v2.go`: 4개 read tool 을 typed `AddTool` 로 등록(enum + `additionalProperties:false`). inputSchema 는 embed 한 JSON 아티팩트에서 로드(수기 jsonschema 구조체 최소화; groupby_metric 은 기존 방식 유지 — aggregate 계열은 별도).
- 온톨로지 read 핸들러는 `s.dashboard`/온톨로지 소스에서 조회만(read-only). mock-first 프론트와 달리 Go 는 아직 온톨로지 provider 가 없으므로, **핸들러는 스키마·계약·게이팅을 노출하되 데이터는 "not implemented" 안전 응답**(isError=false, 빈 결과 + 안내) — 계약/스키마 단일화가 이 item 의 골자이고, 실 데이터 provider 는 IMP-79/후속(온톨로지 provider)로 분리. (프론트 mock 은 완전 동작.)
- `mcp.go`: 수기 `tools/list` 를 **레지스트리 파생**으로 교체 — aggregate tool(mcp.go 고유) + 온톨로지 read tool(공유 아티팩트)을 합쳐 노출. Diagnostics McpPanel 의 `tools/list` 가 자동 동기.
- `mcp.go` resources: `fabrix://ontology/schema`(Object/Link/Action 타입 카탈로그) 추가 + 기존 `fabrix://metric-catalog`·`fabrix://dimensions` 유지.

### 4. 프리미티브 구분(정정 반영)

- **Resource**(static, session-load, client 가 KNOW 해야 할 것): `fabrix://ontology/schema` + metric-catalog + dimensions.
- **Tool**(dynamic, model-driven, params 를 모델이 정함): `query_objects`/`traverse_links`/`get_object`/`get_object_metrics`.
- per-object read 를 `fabrix://object/{id}` **resource template 로 두지 않는다** — intent-driven fetch 는 TOOL.

### 5. 게이팅(two-tier)

- **mutation 은 절대 auto-callable agent tool 로 노출 안 함.** `ONTOLOGY_TOOL_REGISTRY` 는 read tool 만 담고, mutating 은 `ACTION_REGISTRY` + `evaluateSubmission`(capability+status) + `<ActionForm>` confirm 경로에만 존재(현행 유지). 두 레지스트리는 물리적으로 분리된 파일·타입.
- read tool 도 Dashboard cap 게이트 안에서만 등록(observe 정합 — 미등록이 실제 차단).
- 서버측 strict validation 유지: enum + `additionalProperties:false` 로 malformed/hallucinated args 를 핸들러 진입 전 거부.

### 6. VITE_MOCK=off

transport 만 스왑(`client.runAgent`/신규 `fetchObjectMetrics` → 실백엔드). tool 스키마 불변.

## 파일 변경

- **신규** `web/src/actions/ontologyTools.ts` — ONTOLOGY_TOOL_REGISTRY + emitOntologyToolSchemas + read-only 가드.
- **신규** `web/src/actions/ontology-tools.schema.json` — committed 계약 아티팩트.
- **신규** `web/src/actions/ontologyTools.test.ts` — 레지스트리 불변식(read-only·enum 파생·필수 필드).
- **신규** `web/src/actions/ontologyTools.emit.test.ts` — emit == committed json(drift canary).
- **수정** `web/src/api/agent.ts` — private tool 서명 주석 삭제, 레지스트리에서 tool 계약 참조(anti-dup). 구현 함수(toolQueryObjects 등)는 유지(순수 조회 로직)하되 "스키마 출처=레지스트리" 로 재문서화.
- **수정** `web/src/api/mock.ts` + `web/src/api/client.ts` — `GET /ontology/objects/:id/metrics` mock + `fetchObjectMetrics` 클라 함수(get_object_metrics tool 의 데이터 경로).
- **수정** `backend/internal/server/mcp_v2.go` — 온톨로지 read tool typed AddTool(embed schema), SDK path canonical.
- **수정** `backend/internal/server/mcp.go` — tools/list 레지스트리 파생, `fabrix://ontology/schema` resource.
- **신규** `backend/internal/server/ontology_tools_schema.json` + `go:embed` 로더.
- **신규** `backend/internal/server/mcp_contract_test.go` — Go 로드 스키마 == web 아티팩트(byte 동일) + read-only tool 이름 가드.
- **수정** `backend/internal/server/mcp_test.go` — tools/list 에 온톨로지 tool 포함 검증(회귀 확장).

## 테스트 케이스

### normal
- (web) `ONTOLOGY_TOOL_REGISTRY` 4개 tool, 각 inputSchema `type:object`+`additionalProperties:false`. enum 이 ObjectType/LinkKind union 과 정확히 일치.
- (web) agent.ts 가 private 스키마 정의를 갖지 않고 레지스트리를 참조(중복 제거) — 기존 agent.test.ts/mock.agent.test.ts 전부 통과(ReAct 순서·read-only 3종·grounding 불변).
- (web) `GET /ontology/objects/:id/metrics` → 결정적 메트릭 시리즈 + objectId 인용.
- (go) SDK path tools/list 에 4개 온톨로지 read tool + groupby_metric 노출. mcp.go tools/list 가 레지스트리 파생(aggregate + 온톨로지 합집합).
- (go) resources/list 에 `fabrix://ontology/schema` + 기존 2개.

### retry(결정성)
- (web) emitOntologyToolSchemas() 두 번 호출 → byte 동일(key 정렬 결정적).
- (web) 같은 intent → 동일 agent step/후보(기존 유지).

### failure
- (go) `get_object` 에 존재하지 않는 id → 핸들러가 안전 응답(빈/not-found, isError=false 또는 명시 에러), 서버 크래시 없음.
- (web) emit != committed json → emit.test.ts 실패(drift canary 동작 확인 — 의도적 불일치 주입 시 fail).

### bad-input(strict validation — LLM malformed/hallucinated args)
- (go) `traverse_links` 에 `objectId` 누락 → required 로 거부.
- (go) `query_objects{type:"Bogus"}` → enum 스키마가 거부(핸들러 진입 전).
- (go) `get_object_metrics{id:"x", extra:"y"}` → additionalProperties:false 로 여분 필드 거부.

### env-missing / gating
- (go) Dashboard cap off → /api/v1/mcp·/v2 미등록(404) — read tool 도 새어나가지 않음(기존 IMP-2 가드 확장).
- (go/web) **SPECIAL**: tools/list 어디에도 mutating 동사(create/update/delete/set/write/patch/scale/restart/drain/cordon) 이름의 tool 이 없다(read-only 가드). mutation 은 `ACTION_REGISTRY`(별도 파일)에만.
- (contract) Go 가 embed 한 schema json == web 아티팩트(byte 동일). 어긋나면 CI 실패.

## Out of scope

- Go 측 실 온톨로지 데이터 provider(objects/links/metrics 실 수집) — 계약/스키마 단일화가 골자. 실 데이터는 IMP-79/온톨로지 provider 후속. (프론트 mock 은 완전 동작.)
- mutating MCP tool 신설(명시적으로 하지 않음 — two-tier 안전).
- streamable-HTTP/SSE 실클라이언트 전송(IMP-9 후속).

## 보안 노트(SPECIAL)

- mutating tool 이 auto-callable agent/MCP tool 로 **단 하나도** 노출되지 않음을 테스트로 못박음(이름 가드 + 레지스트리 물리 분리).
- read tool 은 Dashboard cap 게이트 안에서만 등록(미등록=차단).
- 서버측 strict validation(enum + additionalProperties:false + required)로 LLM 의 malformed/hallucinated args 를 핸들러 진입 전 거부.
- schema 아티팩트는 순수 계약(시크릿·자격증명 없음). resource `fabrix://ontology/schema` 는 타입 카탈로그(메타데이터)만.
