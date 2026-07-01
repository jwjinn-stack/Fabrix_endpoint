# IMP-60 — 온톨로지 접지 AI Agent 패널 (로컬 모델 + MCP tool-calling)

- Type: ux (sev=high) · Cycle4 온톨로지 · "AIP" 매핑 (운영 에이전트, NOT 챗봇)
- Branch: `feature/evolve-cycle4-ontology`
- Sources: AWS Prescriptive Guidance grounded-agent **Pattern 5**(NL intent → typed tool calls → authoritative-source grounding → traceable actionable response + escalation gate, structured logs+trace IDs) · Palantir **AIP Agent Studio**(object query tools + traverse links + user-confirm Actions + Kinetic Action Layer with human validation + audit) · Datadog Bits AI SRE · New Relic AI MCP Server · docs/palantir-ontology-analysis.md §3, §5.4

## 문제 (Why)

`Diagnostics.tsx` 의 `McpPanel` 은 **읽기 전용 진입점**일 뿐이다 — FABRIX MCP 서버 발견·연결 스니펫·tool/resource 목록만 보여준다. 앱 안에서 **로컬 추론 모델이 온톨로지를 tool 로 조회**(queryObjects/traverseLinks/getIncidents)하고 **근본원인 후보 + 실행 가능한 Action** 을 제안하는 대화형(에이전트) 표면이 없다. docs §5.4 가 정확히 이 갭("이 느린 엔드포인트 원인 찾아줘" → 그래프 traverse → RCA 후보 + Action)을 지목한다.

## 해결 (What)

새 페이지 `web/src/pages/AiAgent.tsx`, route `/agent` 를 **운영 에이전트**로 추가한다(챗봇 아님).

1. **NOT 챗 버블 — 가시적 ReAct 타임라인**: Reasoning step → Tool call(name+args) → Tool result(source objectIds) → 다음 step. 최종 출력 = confidence 순위 RCA 후보 카드. 카드 클릭 → 해당 온톨로지 객체/엣지 강조(ObjectView 열기 / `/investigate` 로 링크).
2. **HARD two-tier action 게이팅 (load-bearing SAFETY)**: read/query tool(queryObjects/traverseLinks/getIncidents)은 자동 실행. mutating Action 은 `<ActionForm>`(IMP-59) + capability 게이팅으로 **명시적 confirm 클릭**을 요구(observe 에서 hidden/disabled). 모델은 confirm 클릭 없이 절대 mutation 을 트리거하지 못한다.
3. **Grounding 이 1급**: 모든 RCA 카드 주장은 objectId/trace ID 를 인용. tool 이 아무것도 못 찾으면 → "grounding 없음 → 정적 runbook fallback"(모델이 지어내지 않음).
4. **Audit**: 전체 transcript(prompt, tool call+args+result, reasoning, invoked action)를 **trace ID** 로 키잉해 보존. 기존 trace/audit 표면과 연결(ActionAuditEntry 패턴 재사용).
5. **mock-first**: mock.ts 의 mock 에이전트 루프가 **실제 MCP 와 동일한 tool 인터페이스**를 호출(VITE_MOCK=off 는 transport 만 스왑, tool 스키마 fork 금지). mock 에이전트는 seed 시나리오(느린 endpoint → 포화 GPU → cordon+scale 권장)에 대해 **결정적 ReAct trace** 를 생성하며, grounding 소스로 `api/investigate.ts` traverse 를 재사용한다.

## 설계 (How)

### 데이터 계약 (types.ts — additive only)
- `AgentToolName = "queryObjects" | "traverseLinks" | "getIncidents"` (read-only tools; mutating 은 tool 이 아니라 ActionForm confirm 으로만).
- `AgentToolCall { tool; args; }`, `AgentToolResult { objectIds: string[]; summary; found: boolean; }`.
- `AgentStep`(discriminated union): `{ kind:"reasoning"; text }` | `{ kind:"tool"; call; result }` — ReAct 타임라인 한 줄.
- `RcaCandidate { objectId; title; objectType; confidence; claim; citations: string[]; suggestedAction?: { actionType; target } }` — citations 는 objectId/trace ID(grounding 강제).
- `AgentRun { traceId; intent; steps: AgentStep[]; candidates: RcaCandidate[]; grounded: boolean; fallbackRunbook?: string[]; audit: AgentAuditEntry[]; generated_at; source; }`.
- `AgentAuditEntry { traceId; kind: "prompt"|"tool"|"reasoning"|"action"; detail; ts; }` — ActionAuditEntry 와 형제(transcript 라인).

### client.ts
- `runAgent(intent?, entity?, signal?): Promise<AgentRun>` → `POST /agent/run`(mock/실백엔드 동일 계약). transport 만 스왑.

### mock.ts — 결정적 에이전트 루프 (`runAgentMock`)
- 동일 tool 인터페이스로 정의된 read tool 3종을 **실제로 실행**: `agentQueryObjects`/`agentTraverseLinks`/`agentGetIncidents` — 전부 `buildOntology()` + `buildRootCausePath()`(investigate.ts) 위에서 동작(단일 grounding 출처).
- 시나리오: entity 미지정 → `defaultEntry()` 로 가장 아픈 진입(느린 endpoint). ReAct step 순서(결정적):
  1. reasoning: "가장 아픈 진입점을 찾는다"
  2. tool getIncidents → triggered incident objectIds
  3. reasoning: "느린 endpoint 에서 그래프를 traverse"
  4. tool queryObjects(Endpoint) → endpoint objectIds
  5. tool traverseLinks(entry) → serves/runsOn/hostedBy 이웃 objectIds
  6. reasoning: "first-anomaly 가 가장 이른 hop 이 근본원인"
- RCA 후보 = `buildRootCausePath` 의 critical hop(confidence 최상) + blast-radius hop + 상류 hop 을 confidence 순 정렬. 각 후보 citations = 그 hop objectId(+연결 trace/incident id). suggestedAction = objectType 별 매핑(GpuDevice→drainGpu, Node→cordonNode, Model→scaleReplicas).
- **grounding-empty 경로**: entry 를 못 찾으면(고립/미지) `found:false`, `grounded:false`, `candidates:[]`, `fallbackRunbook:[...정적 절차...]` — 모델이 지어내지 않음.
- transcript audit: prompt/tool/reasoning/action 라인을 전부 traceId 로 기록.

### 게이팅 trust boundary (mock 경로 포함)
- read tool 은 조회만 — 절대 mutate 안 함. mutating 은 `POST /ontology/actions/:name`(IMP-59 `applyAction`) 한 경로로만, 이미 `evaluateSubmission`(capability+status) 게이팅 + 403. 에이전트 mock 은 **mutating tool 을 애초에 갖지 않는다**(tool 스키마에 invokeAction 없음) → 모델이 confirm 없이 mutation 을 부를 방법이 구조적으로 없다.
- UI: RCA 카드의 suggestedAction 은 `<ActionForm>` 을 확장 패널로 렌더 → 사용자가 파라미터 입력 + submit(=confirm). observe 에서는 ActionForm 이 disabled+사유(기존 게이팅 재사용).

### UI (AiAgent.tsx)
- page-head(제목/크럼브/InfoTip "운영 에이전트 — 상관≠인과, mutation 은 confirm 필요") + DataFreshness + "분석 실행" 버튼.
- LEFT/상단: intent 입력(자연어, seed 시나리오 프리셋) + entity 선택(옵션).
- CENTER: ReAct 타임라인(ol). reasoning=텍스트 라인, tool=name+args(code)+result(objectId 칩). grounding 배지.
- 하단: RCA 후보 카드(confidence bar + claim + citation 칩 + [상세/조치 열기] → ObjectView, suggestedAction 있으면 ActionForm 확장).
- grounding 없음 → runbook fallback 카드(정적 절차, "grounding 없음" 배지).
- `ObjectView`(useObjectView) 재사용 — 카드 클릭 → 드로어. `/investigate` 로 가는 링크(onNavigate).
- Diagnostics McpPanel 에 "인앱 AI Agent 열기 →" 링크 추가(자연스러운 연결).

### 배선
- router.ts: `agent` → `/agent`, `PAGE_CAP.agent = "dashboard"`(읽기 관제 권한; mutating 은 ActionForm 이 별도 게이팅).
- Layout.tsx: nav — "인프라·관측" 그룹 안 "AI Agent" (근본원인 추적 COP 아래, 자연스러운 인접).
- App.tsx: Page 타입은 Layout 에서 export, render switch 에 `agent` 추가.
- urlState: `agentSchema { entity, intent }` deep-link(옵션).

## 테스트 케이스

- **normal**: 페이지가 ReAct 타임라인을 **순서대로**(reasoning→tool(name+args+result)→…) 렌더 / RCA 카드가 objectId 를 **인용**(citation) / read tool 은 **자동 실행**(사용자 개입 없이 결과 표시).
- **retry(결정성)**: 같은 intent/entity 재실행 → 동일 step 순서·동일 후보 objectId 집합.
- **mutating 게이팅**: RCA 카드의 suggestedAction 은 `<ActionForm>` confirm(submit) 없이 mutate 안 함 / observe(cap-off)면 not-invokable(disabled+사유) / mock 경로도 confirm+capability 없이는 거부(403).
- **grounding-empty → runbook fallback**: tool 이 아무것도 못 찾으면 정적 runbook 표시 + "grounding 없음" 배지, 후보 카드 없음(hallucination 없음).
- **audit**: transcript 가 trace ID 로 기록되고(AgentRun.audit + traceId), prompt/tool/reasoning 라인을 포함.
- **bad-input**: 알 수 없는 entity → grounding-empty 경로(throw 없음).
- **env-missing**: `runAgent` reject → 에러 상태(페이지 죽지 않음).
- route/nav 등록(router.cap · Layout nav 테스트 비회귀).

## 보안 (trust boundary)

두-티어 게이팅이 신뢰 경계다. 확인 사항:
- 에이전트 tool 스키마에 **mutating tool 없음**(queryObjects/traverseLinks/getIncidents 만) → 모델이 mutation 을 부를 구조적 경로 부재.
- mutation 은 `applyAction`(IMP-59) 한 경로 + `evaluateSubmission`(capability+status) — UI 숨김이 아니라 mock 도 403 거부.
- transcript audit 는 마스킹된 메타데이터만(원문 프롬프트/시크릿 로깅 없음). no eval/unsafe/secret.

## Out of scope

- 실제 LLM 추론/스트리밍(mock 은 결정적 ReAct trace). 실백엔드는 transport 스왑만.
- mutating tool 을 에이전트에 직접 부여(의도적 배제 — confirm 게이트 유지).
- ObjectView/ActionForm/온톨로지 타입 파괴적 변경(additive 만).
