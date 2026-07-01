# IMP-61 — 관계 그래프 기반 근본원인 추적을 차별화 축으로 (LLM 인프라 관측 경쟁 대비)

- **Type**: compete (sev=medium, effort=M)
- **Branch**: `feature/evolve-cycle4-ontology`
- **Date**: 2026-07-01
- **우산(umbrella)**: IMP-56(온톨로지 데이터 모델)·IMP-57(ObjectView)·IMP-58(COP 근본원인)·IMP-59(Action writeback)·IMP-60(AI Agent)의 상위 제품 서사 + 구체 데모 시나리오.

## 배경 / 문제

Datadog(Watchdog RCA·Service Map), New Relic(iRCA), Grafana(Contextual RCA·Assistant Investigations)는
서비스 의존성 그래프 위 **자동 근본원인 추론**을 이미 성숙하게 제공한다(레드오션). LLM-native 툴
(Arize/Langfuse/LangSmith)은 trace·eval·drift에 강하나 인프라 인과 그래프는 약하다.

Deep-research(2026-07-01, verification 1-0 unanimous · primary vendor sources)로 검증된 SEAM:
**아무도 결합하지 않은 두 축** — (1) LLM-추론-native 인과 온톨로지(Endpoint→Model→GPU→Node),
(2) 그 그래프 노드에 붙은 **실행 가능한 typed Action**(restart/scale/cordon/evict) + confirm/dry-run + capability 게이팅.
조사된 4개 툴 전부 **diagnostic-only**(근본원인 surface + 최대 manual fix 추천, in-product 자율 실행은 아무도 미출시).
Datadog Bits AI SRE·Grafana Assistant Investigations 같은 최신 human-in-the-loop 조차 최종 사람 승인 유지.

⇒ FABRIX moat = 토폴로지 viz가 아니라 **"the only inference-aware object graph that closes the loop to action"**.

## 목표 (TWO deliverables)

### A) 제품 서사 문서 `docs/inference-ontology-moat.md`
capability-vs-capability 프레이밍(“better RCA than Datadog” 금지). 커버:
1. 토폴로지 viz는 차별자가 아님(incumbent가 이미 causal RCA 보유 — 레드오션).
2. 진짜 seam = LLM-추론-native 온톨로지(Endpoint→Model→GPU→Node) + executable typed Actions
   (restart/scale/cordon/evict) + confirm/dry-run + capability 게이팅.
3. IMP-56/58/59/60이 이를 어떻게 실현하나(observe→investigate→operate 폐루프).
4. 정직한 경쟁 표(Datadog Watchdog/Bits AI SRE, Grafana Assistant Investigations, New Relic iRCA,
   Arize/Langfuse) — 전부 human-approval/diagnostic 유지. deep-research 소스 인용.
5. narrowing-window 주의(executable-remediation gap은 월단위로 좁혀지는 중).

주의: LLM-ontology gap은 반증 부재로 추론된 negative(vendor가 명시적으로 "없다"고 말한 게 아님).
날조된 경쟁사 인용 금지. 청구는 vendor 1차 문서가 입증하는 "능력 존재"까지만(정확도·false-positive는 미청구).

### B) 내장 데모 시나리오 (scripted, mock-first)
"slow endpoint → saturated GPU / hot node → recommended cordon+scale"의 결정적 guided walkthrough.
기존 `api/investigate.ts`(buildRootCausePath)를 evidence surface로 **재사용**(traversal 재구현 금지).

- **왜 seeded fixture가 필요한가**: 기존 mock seed(qwen25-vl-7b NotReady)는 Model에서 dead-end라
  GPU→Node 포화 경로가 생성되지 않음(probe 확인). 정확한 서사(slow EP → saturated GPU → hot node →
  cordon+scale)를 결정적으로 보이려면 목적 특화 seeded 온톨로지 fixture가 필요하다.
- **thin layer 원칙**: investigate/agent core 로직 불변. 데모는 (1) 순수 fixture + (2) buildRootCausePath
  호출 + (3) 순서 있는 narrative step 배열로만 구성. Investigate 화면은 데모 fixture를 기존 path 렌더에
  주입하고 step 하이라이트만 추가(rebuild 아님).

## 구현 계획

### 1) `web/src/api/demoScenario.ts` (신규, 순수 모듈 · 의존성 0)
- **fixture**: slow endpoint → serves → model → runsOn → saturated GPU → hostedBy → hot node,
  + 같은 node에 hostedBy된 다른 Service(blast-radius). 상태·props를 결정적으로 세팅해
  first-anomaly가 상류(GPU/Node)에서 더 이르게 관측되도록(추정 근본원인 = GPU 또는 Node).
- `DEMO_ENTRY_ID` = slow endpoint id. `buildDemoScenario()` → `{ objects, links, entryId, path, steps }`.
  `path`는 `buildRootCausePath(objects, links, entryId)`로 산출(단일 출처 재사용).
- `steps: DemoStep[]` — 각 step은 `{ id(hop objectId), title, narration, action? }`. 마지막 두 step은
  권장 조치: Node에 `cordonNode`, Model에 `scaleReplicas`(ACTION_REGISTRY verb 이름과 정합).
- graceful: fixture가 비정상(entry 없음/path.found=false)이면 steps=[] 로 안전 반환(throw 금지).

### 2) `web/src/urlState.ts` — investigateSchema에 `demo` 플래그 추가(deep-link)
- `demo: strField("")` — "1"이면 데모 재생 모드. 기존 entity와 공존.

### 3) `web/src/pages/Investigate.tsx` — 얇은 데모 affordance
- page-head에 "데모 시나리오 재생" 토글 버튼(demo=1 ⇄ demo=""). InfoTip으로 mock 데모임을 명시.
- demo 활성 시: objects/links/path를 `buildDemoScenario()` 결과로 대체(fetch 대신), CENTER는 동일 HopCard
  렌더 재사용. step 하이라이트 상태(현재 step index)와 이전/다음/처음으로 컨트롤.
- 현재 step의 hop 카드에 `.demo-active` 강조 + 하단에 narration + (마지막 step) 권장 조치 요약.
- demo 비활성 시 기존 동작 100% 불변(회귀 방지).

### 4) `web/src/index.css` — 데모 컨트롤·하이라이트 토큰(Backend.AI 라이트+스틸블루, 네온 금지)
- `.demo-bar`, `.demo-step-narration`, `.cop-hop.demo-active`(스틸블루 ring). reduce-motion 가드.

## 테스트 케이스 (`web/src/api/demoScenario.test.ts`, vitest)
1. **결정적 로드**: `buildDemoScenario()` 두 번 호출 → 동일 entryId·동일 hop id 순서·동일 step id 순서.
2. **순서 있는 step**: steps가 path의 hop 순서와 정합(각 step.id가 path.hops에 존재, 순서 보존).
3. **cordon+scale로 종결**: 마지막 두 step의 action이 각각 `cordonNode`(Node 대상)·`scaleReplicas`(Model 대상).
   path의 추정 근본원인(criticalId)이 GPU 또는 Node(포화 상류).
4. **capability 게이팅 정합**: 권장 action verb가 ACTION_REGISTRY에 존재하고 requiredCap을 가짐
   (cordonNode=endpoints.write, scaleReplicas=models.write) — observe 프로파일에서 자연 비활성.
5. **bad/missing seed 처리**: 내부 헬퍼가 빈/고립 fixture를 받으면 steps=[]·path.found 반영(throw 없음).
6. **evidence surface 재사용**: path가 buildRootCausePath 산출과 동일(traversal 재구현 아님 — 동일 hop id).

## 비목표 / 범위 규율
- investigate/agent core 로직 수정 금지(얇은 seeded-entry 주입 훅만).
- 실 K8s mutating·실백엔드 호출 없음(mock-first, optimistic만).
- 새 데이터 모델 발명 금지 — 기존 OntologyObject/OntologyLink/RcaCandidate/ACTION_REGISTRY만 사용.
- 마케팅 청구는 capability-vs-capability·defensible(날조 인용 금지).

## TOUCHED_SURFACES (visual QA)
- `docs/inference-ontology-moat.md` (신규 서사 문서, 텍스트).
- `web/src/pages/Investigate.tsx` `/investigate` — page-head "데모 시나리오 재생" 토글 → CENTER 경로가
  데모 fixture로 바뀌고 step 컨트롤(이전/다음)로 hop을 하이라이트, 마지막 step에서 cordon+scale 권장.
  launch: `/investigate?demo=1` 또는 페이지 상단 토글 클릭.
