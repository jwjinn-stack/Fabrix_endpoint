# FABRIX Endpoint — 추론 온톨로지 moat 서사

> 한 줄 포지셔닝: **"the only inference-aware object graph that closes the loop to action."**
> — 액션까지 닫는, 유일한 추론-인지 객체 그래프.
>
> 이 문서는 IMP-56(온톨로지 데이터 모델)·IMP-57(Object View)·IMP-58(COP 근본원인)·
> IMP-59(Action writeback)·IMP-60(AI Agent)의 **상위 제품 서사 우산**이다.
> 청구는 전부 **capability-vs-capability**(능력 대 능력)로 프레이밍한다 — "우리가 Datadog보다 RCA를 잘한다"는
> 종류의 정확도 우위 주장은 하지 않는다(1차 vendor 문서는 능력의 *존재*만 입증하지, 정확도·오탐률은 미입증).

---

## 1. 토폴로지 시각화는 차별자가 아니다 (레드오션)

관측 시장의 통념과 달리, "서비스 의존성 그래프를 그리고 그 위에서 근본원인을 추론한다"는 능력은
**이미 성숙하고 붐비는 카테고리**다. Deep research(2026-07-01, 1차 vendor 문서 기준)로 재확인한 사실:

- **Datadog Watchdog** — app+infra 의존성을 학습해 정상 상호작용의 베이스라인을 만들고, 새 이상의
  근본원인을 인과 traverse로 추론한다. 단순 "첫 증상 flag"가 아니라 **root cause vs. 하위 cascading
  증상**을 구분한다.
- **New Relic Intelligent RCA(iRCA)** — 엔티티 상관·변경 이벤트를 엮어 근본원인 후보를 초 단위로 지목
  (2026-02 preview).
- **Grafana Contextual RCA / Knowledge Graph(ex-Asserts)** — infra↔app 계층 신호를 자동 상관하고
  의존성 그래프 위에서 근본원인 맥락을 제공한다.

즉, **그래프를 그리는 것 자체도, 그 위에서 인과를 추론하는 것 자체도 우리의 wedge가 아니다.**
FABRIX가 "관계 그래프 기반 근본원인 추적"을 내세운다면, 그 문구만으로는 incumbent와 구별되지 않는다.
차별점은 **그래프의 종류**와 **그래프 위에서 무엇을 할 수 있는가**에 있다.

---

## 2. 진짜 seam — 아무도 결합하지 않은 두 축

Deep research는 두 진영 모두에서 gap을 검증했다(verification 1-0 unanimous). FABRIX의 moat는
토폴로지 viz가 아니라, **어느 경쟁자도 동시에 제공하지 않는 두 가지의 결합**이다.

### 축 A — LLM-추론-native 인과 온톨로지 (Endpoint→Model→GPU→Node)

범용 관측 도구의 인과 그래프는 **generic microservice/host 그래프**다. LLM 추론 워크로드의 고유
인과 사슬 — 하나의 느린 **Endpoint**가 어떤 **Model**을 서빙하고, 그 모델이 어느 **GPU**에 얹혀 있으며,
그 GPU가 어느 **Node**에 담겨 있고, 그 노드의 포화가 어떤 다른 서비스로 번지는지 —
을 **1급 타입(typed object)과 관계(typed link)로 모델링한 도구는 조사 범위에서 발견되지 않았다.**

- LLM-native 진영(Langfuse/Arize/LangSmith)은 agent traces·eval·drift·token·latency로 스코프가
  명시되어 있고, 2026 비교 기사는 "LLM observability와 infrastructure observability는 다른 계층"이라며
  **two-layer 아키텍처**(infra RCA는 별도 APM tier)를 권장한다. 6개 플랫폼 어느 것도 GPU-to-node
  매핑이나 remediation을 다루지 않는다.
- Datadog LLM Observability는 LLM span을 APM/infra/RUM과 **한 request로 잇는 사람용 cross-signal 상관**
  이지, LLM-native 사슬 위 자동 그래프 인과 추론이 아니다.
- arXiv 2026("Beyond Microservices…", 2603.02057)은 request-centric trace와 uniform CPU/mem 가정이
  LLM 추론에서 붕괴하며, fragmented execution graph·opaque accelerator runtime·GPU-driver counter가
  **specialized modeling**을 요구함을 확인한다.

> ⚠️ 정직성 주석: "어느 경쟁자도 Endpoint→Model→GPU→Node 온톨로지를 모델링하지 않는다"는 **반증 부재로
> 추론된 negative**다. vendor가 명시적으로 "우리는 그것이 없다"고 말한 게 아니라, 공개 1차 문서에서
> 해당 능력의 서술을 찾지 못한 것에 근거한다. 따라서 이 축은 "우리가 아는 한 유일"로 프레이밍한다.

### 축 B — 그래프 노드에 붙은 실행 가능한 typed Action (closing the loop)

**결정적이고 업계 공통인 gap**: 조사된 4개 툴(Datadog Watchdog, New Relic iRCA, Grafana Contextual RCA,
+ LLM-native 진영)은 모두 **diagnostic-only**다 — 근본원인을 surface하고 최대 manual fix를 *추천*할 뿐,
**in-product 자율 실행은 아무도 하지 않는다.**

- Datadog **Bits AI SRE**, Grafana **Assistant Investigations**(2026-06) 같은 최신 human-in-the-loop
  remediation조차 **최종 사람 승인을 유지**하며 자율 실행은 아직 미출시다.
- 그리고 이들의 "action"은 **AI가 제안하는 다음 단계**지, Object–Link 그래프에 정의된 **typed Action**
  (restart/scale/cordon/evict)이 아니다.

FABRIX의 Action(IMP-59)은 Palantir Foundry의 Action Type을 그대로 미러링한다 — 대상 Object Type,
파라미터 폼, Submission Criteria(capability 게이팅), Side Effects를 **온톨로지의 1급 연산**으로 선언하고,
`restart/scale/cordon/drain`을 confirm(+dry-run 여지)과 함께 그래프 노드 위에서 바로 실행한다.
observe 프로파일에서는 write capability가 없어 자연히 비활성화되고, manage 프로파일에서만 실행된다.

---

## 3. IMP-56/58/59/60이 이를 어떻게 실현하나 (observe → investigate → operate 폐루프)

| 단계 | 무엇 | 실현(IMP) |
|---|---|---|
| **Observe(관측)** | 메트릭·트레이스·GPU·노드를 온톨로지 객체로 "승격" | IMP-56 (Object/Link 데이터 모델), 기존 관측 화면 |
| **Investigate(추적)** | 느린 Endpoint에서 관계 그래프(serves→runsOn→hostedBy)를 따라 추정 근본원인 + blast-radius를 한 화면에서 | IMP-58 COP(`/investigate`), IMP-57 Object View |
| **AI 접지(에이전트)** | 로컬 모델이 온톨로지를 read-only tool로 조회해 근본원인 후보 + 실행 가능 Action을 제안 | IMP-60 AI Agent(`/agent`) |
| **Operate(제어)** | 그래프 노드 위 typed Action을 confirm + capability 게이팅으로 실행 | IMP-59 Action(writeback) 프레임워크 |

이 네 조각이 하나의 온톨로지 위에서 이어지는 것이 폐루프다: **본 것(observe) → 원인을 따라간 것
(investigate) → 그 위에서 바꾸는 것(operate)**. incumbent는 세 번째 화살표(그래프 위 자율 실행)에서 멈춘다.

**안전(two-tier 게이팅)**: 에이전트의 tool은 조회 3종(queryObjects/traverseLinks/getIncidents)뿐이고
mutating tool은 존재하지 않는다 — 모델이 confirm 없이 변경을 부를 구조적 경로가 없다. mutation은 오직
`<ActionForm>` + `evaluateSubmission`(capability + status) 게이팅으로만 실행된다.

---

## 4. 정직한 경쟁 표

> 프레이밍 규칙: 아래는 **능력의 존재/부재**를 기술한다. 정확도·오탐률 비교가 아니다.
> "diagnostic-only"는 "근본원인을 surface하고 최대 manual fix를 추천하되, in-product 자율 실행은 하지 않음"을 뜻한다.

| 도구 | 인과 RCA | 인과 그래프의 종류 | 그래프 위 "action" | 자율 in-product 실행 |
|---|---|---|---|---|
| **Datadog** Watchdog / Service Map | 있음(성숙) | generic microservice/host | Bits AI SRE = AI 제안 next step (typed Object-Link action 아님) | 없음(최종 사람 승인) |
| **New Relic** iRCA | 있음(preview) | generic entity/change | 가이드/제안 | 없음 |
| **Grafana** Contextual RCA / Assistant Investigations | 있음 | generic infra↔app | Assistant 제안(2026-06) | 없음(최종 사람 승인) |
| **Arize / Langfuse / LangSmith** | LLM trace/eval 중심 (infra 인과 그래프 약함) | (별도 APM tier 권장) | 없음 | 없음 |
| **FABRIX Endpoint** | 있음(추정 근본원인, 상관≠인과 명시) | **LLM-추론-native**(Endpoint→Model→GPU→Node) | **typed Action**(restart/scale/cordon/drain) + confirm + capability 게이팅 | mock-first(optimistic writeback); 실 mutating은 후속 spike(IMP-67) |

읽는 법: 다른 도구가 "없다"고 표기된 칸은 **플랫폼 전체에 그 능력이 없다는 뜻이 아니다.** 예컨대 Datadog은
플랫폼 레벨에서 Bits AI SRE라는 remediation 기능이 존재한다. 정확히는 **"Watchdog RCA·Grafana contextual
RCA는 diagnostic-only이고, 그래프 위 자율 in-product 실행은 아직 아무도 출시하지 않았다"**가 참이다.

---

## 5. 주의 — 좁혀지는 창(narrowing window)

executable-remediation gap은 **월단위로 좁혀지는 중**이다. Bits AI SRE, Grafana Assistant Investigations
같은 human-in-the-loop remediation이 빠르게 나오고 있고, 이들이 "최종 사람 승인"을 걷어내는 순간 축 B의
차별화는 약해진다. 따라서:

1. 차별화 창은 **실재하지만 한시적**이다 — 축 A(LLM-추론-native 온톨로지)가 더 방어 가능한 해자다.
   축 A는 "그래프의 종류"라는 구조적 차이라, 경쟁자가 LLM 추론 스택을 1급으로 모델링하기 전까지 유지된다.
2. 마케팅은 **"better RCA than Datadog"를 금지**한다. 정확한 wedge는 축 A+B의 결합이다:
   *"the only inference-aware object graph that closes the loop to action."*
3. IMP-50 correlation 드릴다운은 축 A의 **evidence surface**로 유지한다(traverse의 근거 신호).

---

## 6. 내장 데모 시나리오 (mock-first 증거)

이 서사를 화면 위 30초로 증명하기 위해, `/investigate`(COP)에 **"데모 시나리오 재생"** 어포던스를 얹었다
(IMP-61 · `web/src/api/demoScenario.ts`). 결정적 seeded fixture로 다음을 단계별로 재생한다:

1. **느린 chat Endpoint** — 사용자 체감 지연 상승(진입점).
2. `serves` → **Demo Chat 32B Model** — 지연 동반 상승(레플리카 여력 부족 정황).
3. `runsOn` → **포화 GPU** — 사용률 임계 초과(가장 이른 이상 = 추정 근본원인 상류).
4. `hostedBy` → **핫 Node** — CPU·네트워크 압박(추정 근본원인). → **권장 조치: 노드 cordon**.
5. blast-radius → **같은 노드의 다른 Service** — 영향 확산.
   + 3번 모델에 **권장 조치: 레플리카 조정(scale)**.

경로 자체는 `buildRootCausePath`(IMP-58)를 그대로 재사용해 산출한다(traversal 재구현 없음, 단일 출처).
권장 조치(cordon/scale)는 `ACTION_REGISTRY`의 typed Action이며, 실행은 카드를 열어 confirm + capability
게이팅(observe에서는 비활성)으로만 이루어진다 — 데모조차 축 B의 안전 계약을 벗어나지 않는다.

launch: `/investigate?demo=1` 또는 COP 화면 상단의 "데모 시나리오 재생" 토글.

---

## 부록 — 출처 (deep research, 2026-07-01)

- Datadog Watchdog automated RCA — https://www.datadoghq.com/blog/datadog-watchdog-automated-root-cause-analysis/
- Datadog Watchdog RCA docs — https://docs.datadoghq.com/watchdog/rca/
- Datadog LLM Observability — https://www.datadoghq.com/product/ai/llm-observability/2/
- Datadog LLM Observability & APM guide — https://docs.datadoghq.com/llm_observability/guide/llm_observability_and_apm/
- Datadog AI agent observability — https://www.datadoghq.com/products/ai/agent-observability/
- New Relic Intelligent RCA — https://newrelic.com/blog/ai/intelligent-rca-accurately-pinpoints-root-cause-in-seconds
- Grafana Contextual RCA — https://grafana.com/blog/contextual-root-cause-analysis-grafana-cloud/
- Grafana Assistant Investigations — https://grafana.com/blog/automatically-discover-and-remediate-root-causes-with-grafana-assistant-investigations
- Grafana Knowledge Graph / Workbench — https://grafana.com/docs/grafana-cloud/knowledge-graph/troubleshoot-infra-apps/workbench/
- Agent observability 비교(LangSmith/Langfuse/Arize) — https://www.digitalapplied.com/blog/agent-observability-platforms-langsmith-langfuse-arize-2026
- arXiv "Beyond Microservices…"(LLM inference observability) — https://arxiv.org/html/2603.02057

관련 내부 문서: `docs/palantir-ontology-analysis.md`(§6 범위 규율, §8 카피하는 "느낌" 3가지).
