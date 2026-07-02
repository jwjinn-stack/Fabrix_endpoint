# IMP-91 — AI Agent 에서 Kubernetes 클러스터 상태 질의 (read-only K8s MCP tool)

- **Type**: compete (sev=medium, effort=L) · Direction 2(kagent 대체) + Direction 8(기술적 정직성) + Direction 9(격리)
- **Branch**: `feature/evolve-cycle6-ontology-ux`
- **Date**: 2026-07-02

## Why

AI Agent(IMP-60/78)는 온톨로지 스냅샷만 조회할 뿐, 실 클러스터 상태(파드 재시작·노드 NotReady·OOMKilled 이벤트·배포 rollout)를 물어볼 수 없다. kagent·k8sgpt·Datadog K8s 인텔리전스는 자연어로 클러스터를 진단한다 — 여기가 약점. Dynamo/vLLM 워크로드가 K8s 위에 돌기에 GPU 이상 ↔ 파드/노드 이벤트 상관이 차별화 축(direction 2)이 된다.

## What (구현 범위)

read-only Kubernetes MCP tool 4종을 tool 계약 단일 출처에 추가하고, mock-first 로 결정적 K8s 스냅샷을 파생한다. 온톨로지 GPU/Node 객체와 상관(gpu-node-02 crit → NotReady 노드 / OOMKilled 파드)시켜 k8s 답이 온톨로지와 정합하게 한다.

### 1) tool 계약 (read-only ONLY)

`web/src/actions/ontologyTools.ts` 에 **`K8S_TOOL_REGISTRY`**(병렬 레지스트리, 온톨로지와 동일하게 소비)를 추가:

| tool | args | 반환(요지) |
|---|---|---|
| `list_pods` | `namespace?`, `phase?`(enum), `objectId?` | 파드 목록(재시작 카운트·OOMKilled·phase). objectId 로 온톨로지 객체와 상관 |
| `list_nodes` | `condition?`(enum: Ready/NotReady/…) | 노드 목록(condition·NotReady 사유) |
| `get_events` | `objectId?`, `reason?`(enum: OOMKilling/BackOff/…) | 최근 K8s 이벤트(reason·message·involvedObject) |
| `describe_deployment` | `name?`, `objectId?` | 배포 rollout 상태(desired/updated/available/unavailable·조건) |

- **read-only 불변식**: `assertReadOnly()` 가 온톨로지+K8s 두 레지스트리를 모두 검사(list/get/describe 는 read 동사; scale/restart/drain/cordon/delete 등 mutating 은 물리적으로 없음). mutating k8s verb 는 tool 로 노출되지 않는다.
- **계약 아티팩트**: `buildOntologyToolsArtifact()` 가 온톨로지+K8s tool 을 합쳐(name 순) emit → `ontology-tools.schema.json` 재생성 → Go `ontology_tools_schema.json` 로 byte 복사. 3-way drift canary(TS emit.test + Go contract_test) 그대로 통과.

### 2) mock-first 결정적 K8s 스냅샷

`web/src/api/mock.ts` 에 `buildK8sSnapshot(objects, links)`(순수·결정적) 추가:

- **온톨로지 상관**: 온톨로지 GpuDevice/Node/Endpoint/Model 객체를 근거로 파생. `crit` GPU/Node → 그 노드가 `NotReady`, 그 위 파드에 `OOMKilled` + 재시작 카운트↑ + `OOMKilling`/`BackOff` 이벤트. `crit` Endpoint(NotReady 엔드포인트) → 배포 rollout `unavailable`.
- **결정성**: seed=객체 id 해시(mulberry32), 15s 버킷 아님(스냅샷은 요청 내 고정). 같은 온톨로지 → 같은 k8s 스냅샷.
- **정직 표기**: `source: "kubernetes (mock)"`, 모든 답에 `mock: true` 플래그. VITE_MOCK on 이면 UI 가 "MOCK" 뱃지로 명시.

### 3) Agent 질의 루프 + UI

`web/src/api/agent.ts` 에 `runK8sQuery(objects, links, k8s, {intent})`(순수·결정적) 추가 — ReAct 타임라인(reasoning → k8s tool call+args → result(파드/노드 id·objectId 인용)). 의도 키워드로 tool 선택:

- "재시작/OOM/파드" → `list_pods` + `get_events`
- "NotReady/노드" → `list_nodes`
- "배포/rollout" → `describe_deployment`

`web/src/pages/AiAgent.tsx` 에 **"클러스터 상태 (K8s)"** 모드 탭 추가. ReAct 타임라인 + 파드/노드 카드(objectId citation 클릭 → ObjectView). **MOCK 뱃지** 정직 표기. two-tier 게이팅 유지(조회 자동; mutation 없음 — ActionForm 도 없음).

### 4) HONESTY (direction 8)

- VITE_MOCK on → k8s 답은 **MOCK** 으로 명시(뱃지 + source 문자열). "실 k8s 접속" 주장 금지.
- 실연동은 **official kubernetes-mcp-server SPIKE** — 본 구현은 transport-only swap 이 되도록 tool 계약(레지스트리·스냅샷 스키마)을 구조화. spike 는 IMP-79 K8s 백본과 짝(이 스펙 note).

### 5) ISOLATION (direction 9)

- `buildK8sSnapshot` 은 objects/links 배열을 받는 순수 함수 → 특정 타입 부재(빈 스냅샷)에서 throw 없이 graceful degrade(빈 pods/nodes/events). IMP-88 격리 스위트 그대로 green.

## 테스트 케이스

1. **4 read tool 등록 + read-only**: `K8S_TOOL_REGISTRY` 에 list_pods/list_nodes/get_events/describe_deployment 존재. `assertReadOnly` 가 두 레지스트리 통과. 아티팩트에 4종 포함(mutating 동사 tool 없음).
2. **drift canary green**: TS emit.test(emit == committed) + Go contract_test(committed == embed) 통과. 온톨로지 4 tool 도 여전히 존재(비회귀).
3. **결정적 k8s mock + 온톨로지 상관**: 같은 온톨로지 → 동일 k8s 스냅샷. `crit` GPU/Node 가 있으면 NotReady 노드·OOMKilled 파드·OOMKilling 이벤트가 그 노드/객체를 인용하며 나온다. 온톨로지에 crit 없으면 파드 전부 Running.
4. **agent 가 파드/노드 질문에 인용으로 답**: "왜 이 파드가 재시작했나" → list_pods+get_events tool step + 파드 id·objectId citation. "어느 노드가 NotReady 인가" → list_nodes + NotReady 노드 + node objectId citation.
5. **정직 mock 표기**: 응답 `source` 에 "mock", 모든 답 `mock: true`. UI MOCK 뱃지.
6. **격리 green**: 빈/부분 스냅샷에서 buildK8sSnapshot throw 없음. IMP-88 스위트 통과.
7. **two-tier**: k8s tool step 은 read-only 4종뿐. mutating 흔적 없음.

## 보안 (light-check)

- k8s tool 은 조회(list/get/describe)만 — delete/scale/cordon/drain 은 auto agent tool 로 노출 안 됨(assertReadOnly + Go contract_test 이중 강제). 있다면 ActionForm+capability 경로에만(본 스펙 범위 밖).
- 엄격한 인자 검증: enum(phase/condition/reason) + additionalProperties:false(LLM hallucinated args 거부). objectId/namespace 는 스냅샷 실재 값만 매칭(임의 문자열은 빈 결과 = graceful).
- 시크릿 없음(mock 파드 이름/이벤트 메시지는 합성). audit 는 마스킹 메타만.

## Out of scope / SPIKE

- 실 kubernetes-mcp-server 연동(transport swap) = **SPIKE**, IMP-79 K8s 백본과 함께 park. 본 구현은 mock-first 이며 계약만 실연동 준비.
- k8s mutating(scale/restart/cordon/drain/delete) tool — 명시적으로 제외(read-only only).
