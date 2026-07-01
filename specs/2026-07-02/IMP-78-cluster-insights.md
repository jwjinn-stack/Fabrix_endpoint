# IMP-78 — 온톨로지 로컬-inference 클러스터 인사이트

> AI Agent(/agent)에 **'클러스터 인사이트'** 모드를 추가한다. Dynamo 배포 로컬 모델(/playground/chat 계열, 별도 :8000)이
> **온톨로지 스냅샷(objects/links + 파생 메트릭 요약)** 을 근거로 "유사 상태 GPU 군집 · 반복 hot-node 패턴 · 유휴 할당갭 집중 노드"
> 같은 **생성적 인사이트**를 도출한다. HARD grounding — 모든 claim 은 objectId 인용 필수, **인용 없으면 표시 안 함**(hallucination 금지).
> 결정적 RCA(IMP-60 현행)는 그대로 두고, 인사이트는 그 위 **옵션 레이어(별도 탭)**.

- **Type**: ux (sev=medium, effort=L)
- **Branch**: `feature/evolve-cycle5-active-ontology`
- **Sources**: IMP-60(AI Agent), Dynamo /playground/chat 경로(:8000 별도 서비스), HARD-grounding 규범, IMP-81(순수/부수효과 경계)

## 배경 / 문제

- `web/src/api/agent.ts` 의 `runAgentLoop` 은 **완전 결정적 mock ReAct 루프**(buildRootCausePath 규칙)로, 실제 로컬 모델을 부르지 않는다.
  단일 진입점 RCA 엔 좋지만 "유사 이상 객체 군집 · 반복 패턴 · 용량 리밸런싱 후보" 같은 **생성적 인사이트**는 규칙으로 못 낸다.
- 실 inference 축은 `/playground/chat`(Dynamo :8000) 하나뿐 — "로컬 모델이 온톨로지를 읽고 인사이트를 생성"하는 경로가 미구현.

## 목표 (Fix — 정확히 구현)

1. **'클러스터 인사이트' 모드** 추가(/agent, 탭 전환). grounding 컨텍스트 = 온톨로지 스냅샷(objects/links + **파생 메트릭 요약**)을
   압축해 Dynamo 로컬 모델에 **구조화 프롬프트**로 보내고, 모델이 인사이트를 **objectId 인용과 함께** 반환.
2. **HARD grounding**: 모든 insight claim 은 온톨로지 objectId(들) 인용 필수. 인용 없는 claim 은 **표시 안 함**(드롭/플래그).
   모델이 온톨로지에 **실재하지 않는** id 를 인용하면 그 id 는 무효 처리, 유효 인용이 0개면 그 insight 는 드롭.
3. **결정적 RCA 유지**: 현행 `runAgentLoop`/RCA 카드 동작은 **그대로**. 인사이트는 distinct 모드/탭(대체 아님).
4. **mock-first**: 결정적 mock 모델 응답 제공(백엔드 0개로 화면 동작). `VITE_MOCK=off` 는 **transport 만 스왑**
   (실 Dynamo 모델로). client.ts fetch/timeout/retry 재사용. IMP-60 two-tier 게이팅 + audit 계승.

## 설계

### 데이터 흐름 (순수/부수효과 경계 — IMP-81 계승)

```
[AiAgent '클러스터 인사이트' 탭]
   └─(mount/재분석)─> client.runAgentInsights()   ← transport seam (mock ↔ 실 Dynamo)
                          │  POST /agent/insights
                          ▼
        mock: runAgentInsightsMock(buildOntology 스냅샷)
                          │  (1) 순수: buildInsightGroundingContext(objects, links)  ← 스냅샷 압축
                          │  (2) 순수: mockModelInsightCompletion(context)           ← 결정적 "모델 출력"(JSON text)
                          │  (3) 순수: parseAndGroundInsights(rawCompletion, validIds) ← HARD grounding 강제(드롭)
                          │  (4) 부수효과: audit append(AGENT_AUDIT)                  ← IMP-60 계승
                          ▼
                   AgentInsightRun { insights[], grounded, groundingSummary, audit, ... }
   실백엔드(VITE_MOCK=off): 동일 POST → BFF → Dynamo /playground/chat → 같은 스키마 반환.
                            citation 강제(parseAndGroundInsights)는 client 측에서 한 번 더 방어 가능하나,
                            mock/실백엔드 모두 서버가 강제한 뒤 스키마로 고정(AgentInsightRun) → UI 는 표시만.
```

**핵심 seam**: mock 은 `mockModelInsightCompletion` 이 "모델이 낸 raw completion(JSON 문자열)"을 결정적으로 만들고,
`parseAndGroundInsights` 가 그걸 파싱 + **온톨로지 실재 id 로만 인용 필터**한다. 실 Dynamo 는 같은 `parseAndGroundInsights` 를
BFF 가 태워 같은 `AgentInsightRun` 스키마로 돌려주면 됨 — 즉 **인용 강제 로직은 transport 와 무관하게 동일**하다(hallucination 방어가 실경로에도 적용).

### 타입 (web/src/api/types.ts 추가)

```ts
// 클러스터 인사이트 종류(생성적) — 규칙 RCA(단일 원인)와 구분되는 "패턴·군집" 축.
export type InsightKind = "gpu-cluster" | "hot-node" | "idle-alloc-gap" | "recurring-pattern";

// 인사이트 한 건 — 모든 claim 은 citations(objectId)로 접지. citations 빈 배열 = 표시 금지(파이프라인이 드롭).
export interface ClusterInsight {
  id: string;              // 결정적 id(테스트 안정)
  kind: InsightKind;
  title: string;           // 사람용 제목(escape 렌더)
  claim: string;           // 생성적 서술(escape 렌더 — "추정", 상관≠인과)
  citations: string[];     // 근거 objectId(온톨로지 실재만; 비면 이 insight 는 드롭됨)
  severity: "info" | "warn" | "crit"; // 표시 톤(임계 아님 — 요약 정보)
}

// 클러스터 인사이트 실행 1회 결과 — RCA(AgentRun)와 형제. grounded=false 면 인사이트 0 + 사유.
export interface AgentInsightRun {
  traceId: string;
  mode: "insights";
  insights: ClusterInsight[];      // HARD grounding 통과분만
  grounded: boolean;               // 유효 인사이트가 하나라도 있으면 true
  groundingSummary: string;        // 스냅샷 압축 요약(객체 N·링크 M·군집 근거) — 사람용
  droppedCount: number;            // 인용 없어 드롭된 claim 수(투명성)
  audit: AgentAuditEntry[];
  generated_at: string;
  source: string;                  // "agent-insights (mock)" | 실백엔드
}
```

### agent.ts 추가 (순수 함수만 — 단위 테스트로 가드)

- `buildInsightGroundingContext(objects, links)` — 스냅샷을 **압축**: GpuDevice util/mem/temp/throttle 요약, hostedBy 로 노드별 GPU 묶음,
  유휴(util<0.1 & mem>0.5) 후보, 상태 히스토그램. 프롬프트에 실을 최소 텍스트 + **valid objectId 집합** 반환.
- `buildInsightPrompt(context)` — **구조화 프롬프트**: system 규칙("각 insight 는 반드시 실재 objectId 를 인용하라, 지어내지 마라, JSON 으로만 답하라")
  + user 컨텍스트(압축 요약). 반환 형식 스키마를 프롬프트에 명시.
- `mockModelInsightCompletion(context)` — **결정적** "모델 출력" 생성(JSON 문자열). context 의 실제 군집/hot-node/idle-gap 을 근거로 만든다.
  hallucination 재현 케이스도 포함(일부러 인용 없는/가짜 id claim 하나) → 파이프라인이 드롭함을 mock 자체로 증명.
- `parseAndGroundInsights(rawCompletion, validIds)` — raw JSON 파싱(실패 시 빈 배열, throw 안 함) → 각 claim 의 citations 를
  **validIds ∩** 로 필터 → **유효 인용 0개면 드롭**. 남은 것만 반환 + droppedCount.
- `buildAgentInsights(objects, links, {traceId, nowIso, rawOverride?})` — 위를 조립해 `AgentInsightRun` 산출.
  `rawOverride` 로 "실 모델이 낸 completion" 을 주입 가능(실백엔드 seam·테스트용).

### client.ts 추가

```ts
// AI Agent 클러스터 인사이트(IMP-78) — 온톨로지 접지 생성적 인사이트. POST /agent/insights.
// VITE_MOCK=off 면 그대로 실백엔드(→Dynamo /playground/chat)로 나가고(transport 만 스왑),
// 응답 스키마는 AgentInsightRun 로 고정. read-only(어떤 mutation 도 유발 안 함).
export async function runAgentInsights(signal?: AbortSignal): Promise<AgentInsightRun> { ... }
```
- `getJSON` 계열이 아닌 POST 이지만 **timeout/retry** 필요(모델 호출은 느릴 수 있음) → runAgent 와 동일 패턴 + AbortSignal.timeout.

### mock.ts 추가

- `runAgentInsightsMock()` — `buildOntology()` 스냅샷 재사용(IMP-81) → `buildAgentInsights` 순수 호출 → audit append(부수효과).
- 라우트 `case "POST /agent/insights"`.

### AiAgent.tsx 변경

- 상단에 **모드 탭**: `근본원인(RCA)` | `클러스터 인사이트`. 기본 = RCA(현행 유지). URL `agentSchema.mode`(strField, 기본 "").
- 인사이트 탭 선택 시 `runAgentInsights` 호출 → 인사이트 카드 목록 렌더. 각 카드: kind 라벨 + title + claim + **근거 objectId 칩**(클릭→ObjectView).
  citations 는 이미 서버가 강제(빈 건 없음)하지만, 방어적으로 `citations.length===0` 이면 렌더 스킵.
- grounded=false → "접지할 군집 근거 없음" note(지어내지 않음). droppedCount>0 → "인용 없는 N건은 표시하지 않음" 투명성 배지.
- 인사이트는 **read-only** — suggestedAction/ActionForm 없음(모든 mutation 은 기존 RCA 카드/ActionForm 경로로만).

## 보안 (light-check)

- grounding 강제: 인용 없는 claim 표시 안 함 → LLM hallucination 이 화면에 못 샌다. 실경로도 동일 파이프라인.
- 인사이트는 read-only — 모델 호출이 어떤 mutation 도 유발하지 않음(ActionForm 없음). two-tier 불변식 유지.
- 시크릿 없음. audit 은 마스킹된 메타만(원문 로깅 금지) — IMP-60 규약 계승.
- 프롬프트 인젝션 표면: 컨텍스트는 우리 온톨로지에서 파생한 값만(사용자 자유 입력을 프롬프트에 직접 넣지 않음). 출력은 objectId 화이트리스트로 강제.

## 테스트 케이스 (vitest)

**agent.insights.test.ts (순수)**
1. `buildInsightGroundingContext` — GPU 군집/유휴갭/노드 묶음 요약 + validIds 가 온톨로지 id 집합과 일치.
2. `mockModelInsightCompletion` — 결정적(같은 컨텍스트 → 같은 문자열). 최소 1건 gpu-cluster + 1건 idle/hot 포함.
3. `parseAndGroundInsights` — **인용 없는 claim 드롭**, 가짜 id(온톨로지 미존재) 인용은 필터되어 유효 0 → 드롭. droppedCount 정확.
4. `buildAgentInsights` — 모든 표시 insight 의 citations.length>0 && 모두 validIds ⊂. grounded=true.
5. 빈 온톨로지 → grounded=false + insights=[] + groundingSummary 존재(지어내지 않음).
6. 결정성 — 같은 스냅샷 2회 → 동일 insight id 집합.
7. rawOverride(실 모델 completion 모사) 주입 → 같은 강제 파이프라인 적용(가짜 인용 드롭).

**mock.agentInsights.test.ts (계약 — 라우터 통과)**
8. `POST /agent/insights` (runAgentInsights) → AgentInsightRun, source mock, 모든 insight 인용 보유.
9. audit transcript traceId 키잉 + prompt/reasoning 종류 포함.
10. **인사이트 응답에 mutating tool/action 흔적 없음**(read-only).

**AiAgent.test.tsx (모드 UI — 기존 케이스 유지)**
11. 기본은 RCA 모드(현행). '클러스터 인사이트' 탭 클릭 → `runAgentInsights` 호출 + 인사이트 카드 렌더.
12. 각 인사이트 카드가 objectId 인용 칩을 렌더(클릭 가능).
13. 인용 없는 claim 은 렌더되지 않음(서버가 드롭 + UI 방어). droppedCount>0 시 투명성 배지.
14. grounded=false(빈 인사이트) → "군집 근거 없음" note, 카드 없음.
15. `runAgentInsights` reject → 에러 상태(페이지 안 죽음).
16. **결정적 mock 응답** — 백엔드 0개로 탭이 동작(installMock 없이도 client 모킹으로).
17. 기존 RCA 타임라인/카드/ActionForm/게이팅 테스트 전부 통과(회귀 없음).

## 완료 기준

- `cd web && npm run test` 전부 통과 + `npm run build`(tsc) 통과.
- 커밋(Conventional Commit, 한글 제목): `feat(ontology): AI Agent 클러스터 인사이트 모드 — Dynamo 로컬 모델이 온톨로지 근거로 군집·패턴 도출(HARD grounding 인용) (IMP-78)`
