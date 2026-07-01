# Palantir Foundry Ontology 분석 → FABRIX Endpoint 적용 설계

> 출처: Palantir 공식 Foundry docs (https://www.palantir.com/docs/foundry/) —
> ontology/overview, action-types/overview, aip/overview, workshop/overview, functions/overview.
> 작성 목적: 팔란티어 온톨로지의 **개념·용어·상호작용 모델**을 정확히 이해하고,
> 우리가 **실제로 구현할 수 있는 것**만 골라 FABRIX Endpoint(GPU inference 관측/제어)에 매핑한다.
> "모든 기능 구현"이 아니라 "팔란티어의 느낌(온톨로지 + 제어 + 로컬 AI 연동)"을 카피하는 것이 목표.

---

## 1. Foundry Ontology 핵심 개념 (docs 원문 기반)

Palantir 은 Ontology 를 **"조직을 위한 운영 계층(operational layer)"** — 즉 원시 데이터 자산과
현실 세계의 운영을 잇는 **의미적(semantic) + 동역학적(kinetic) 다리**로 정의한다.
"보여주는 것"이 아니라 "의사결정을 내리고 실제 시스템을 움직이는 것"이 핵심.

| 구성요소 | Foundry 정의 | 한 줄 요지 |
|---|---|---|
| **Object Type** | 현실 엔티티(장비·시설·주문·거래)를 디지털로 매핑 | 세계를 "명사"로 모델링 |
| **Property** | 객체의 속성 — 메타데이터·보안·거버넌스 포함 | 각 명사의 필드 |
| **Link Type** | Object Type 간 의미적 관계 | 명사들을 잇는 그래프 엣지 |
| **Action Type** | "한 번에 취할 수 있는 객체·속성·링크에 대한 변경 집합의 정의" | 세계를 바꾸는 "동사" (writeback) |
| **Function** | 임의 복잡도의 비즈니스 로직 저작(TypeScript/Python) | 객체 위에서 도는 계산/규칙 |
| **Interface** | 공통 형태를 공유하는 object type 의 다형(polymorphic) 계약 | 타입 추상화 |

### 1.1 Semantic ↔ Kinetic 두 축

- **Semantic (의미)**: Object–Link 그래프로 "무엇이 무엇과 어떻게 연결되는가"를 표현.
  드릴다운·관계 탐색(traverse)의 기반.
- **Kinetic (동역학)**: Action Type 이 사용자의 결정을 온톨로지에 **직접 기록(writeback)**하고,
  단일 트랜잭션으로 커밋되어 **모든 앱에 즉시 반영**된다. 대시보드를 "관제 시스템"으로 바꾸는 축.

---

## 2. Action Types — 읽기 전용 대시보드 → 제어 표면 (docs 원문 기반)

> "Action type 은 사용자가 **한 번에** 취할 수 있는 객체·속성값·링크의 변경/편집 집합의 정의다."

Action 이 제출되면 변경은 **하나의 트랜잭션**으로 커밋되고 즉시 전 앱에 반영 → 데이터 일관성 보장.

| Action 구성 | 역할 | 우리 매핑 후보 |
|---|---|---|
| **Parameters** | 사용자 입력(드롭다운·텍스트·객체 선택) 폼 | "replica 수", "타깃 모델", "drain 노드" 폼 |
| **Rules** | 어떤 속성이 어떻게 바뀌는지 로직·조건부 변환·관계 생성 | 상태 전이 규칙(scale→pending→running) |
| **Submission Criteria** | 실행 전 검증·권한(예: HR 만 실행 가능) | capability 게이팅(manage 프로파일만) |
| **Side Effects** | 알림·webhook·빌드 트리거 | 알림 발송·audit 로그·MCP 호출 |

**핵심 통찰**: 사용자는 하부 데이터 구조를 몰라도 **비즈니스 지향 인터페이스**로 목적을 달성한다.
→ 우리 화면에서 "GPU 노드를 cordon", "모델 재시작", "replica scale" 같은 **동사 버튼**을 온톨로지 객체 위에 얹는다.

---

## 3. AIP — 로컬 AI 모델을 온톨로지에 접지(ground) (docs 원문 기반)

AIP 는 **"AI 를 당신의 데이터·운영에 연결"**한다. 세 빌더:
- **AIP Logic**: 프로덕션급 AI 워크플로(툴 사용) 저작
- **AIP Agent/Chatbot Studio**: 지능형 에이전트 구축
- **AIP Evals**: AI 출력 평가

핵심 특성(docs): **모델 유연성**(다양한 LLM 지원), **보안**, **감사가능성**(의사결정의 audit trail·설명·평가), 확장성.

**상호작용 모델**: LLM 이 온톨로지 객체를 **컨텍스트(grounding)**로 읽고, **Action/Function 을 tool 로 호출**하여
세계를 조회하거나 변경한다. 즉 "채팅"이 아니라 "온톨로지 위에서 도구를 쓰는 에이전트".

> **우리 프로젝트와의 정합**: FABRIX 는 이미 **로컬 추론 모델(GPU inference)**을 운영한다.
> 우리의 "AIP"는 = 로컬 모델 + **MCP tool-calling**으로 우리 온톨로지(GPU/노드/서비스/모델/trace)를
> 조회하고 Action(재시작·scale·drain)을 실행하는 에이전트. (memory: 가드레일/Langfuse 3-레이어와 분리 유지)

---

## 4. Workshop — 온톨로지 위 운영 앱 빌더 (docs 원문 기반)

Workshop 3원칙: ① **Object-Centric**(Object 레이어가 1차 빌딩블록, Action=writeback, Function=로직),
② **Unified Design System**(일관된 컴포넌트), ③ **Dynamic Interactivity**(Events 시스템으로 컴포넌트 간 통신).

구성: **Layouts / Widgets / Variables / Events / Object Lists & Tables**(필터·드릴다운).
대표 패턴: **Alert triage** 시스템, **Common Operational Picture(COP)** — 조직 전반의 핵심 정보를 통합한 단일 화면.

> **우리 매핑**: 현재 화면들(Topology/Gpu/Traces)이 이미 Object List/drill-down 을 갖고 있음.
> 부족한 것 = ① 명시적 **Object View**(단일 엔티티 상세 + 관계 패널 + Action 버튼),
> ② **Events**(한 화면의 선택이 다른 패널을 갱신), ③ **COP 성격의 트러블슈팅 단일 화면**.

---

## 5. FABRIX Endpoint 온톨로지 설계 (우리 도메인 매핑)

팔란티어 개념을 GPU inference 운영 도메인으로 번역. **이것이 이번 사이클의 데이터 모델 골격이다.**

### 5.1 Object Types (명사)

| Object Type | 설명 | 핵심 Property | 기존 데이터 소스 |
|---|---|---|---|
| **Model** | 서빙 중인 추론 모델 | name, status, replicas, quantization | Models.tsx / mock |
| **Endpoint** | 외부 노출 추론 엔드포인트 | url, model, qps, p95 | Endpoints.tsx |
| **Service** | 논리 서비스(모델을 소비) | name, owner, tier | Topology |
| **GpuDevice** | 물리 GPU | uuid, util, mem, temp, host | Gpu.tsx |
| **Node/Host** | GPU 를 담은 물리 노드 | hostname, cpu, mem, gpuCount | NodeMetrics.tsx |
| **Trace** | 추론 요청 1건의 실행 궤적 | traceId, latency, tokens, decision | Traces.tsx |
| **Incident** | (신규) 장애/이상 이벤트 | severity, rootCause, affectedObjects | — 신규 |

### 5.2 Link Types (관계 그래프 — 트러블슈팅의 핵심)

```
Service --consumes--> Endpoint --serves--> Model --runsOn--> GpuDevice --hostedBy--> Node
Trace   --routedTo--> Endpoint
Trace   --executedOn--> GpuDevice
Incident --affects--> {any object}
```

이 그래프가 **"장애 원인을 따라가는 흐름"**의 척추다:
느린 Endpoint → 어떤 Model → 어느 GPU → 어느 Node → 그 노드의 다른 Service 영향까지 **한 방향으로 traverse**.

### 5.3 Action Types (동사 — 제어)

| Action | 대상 Object | Parameters | 검증(capability) | Side Effect |
|---|---|---|---|---|
| **restartModel** | Model | reason | models.write | audit + 알림 |
| **scaleReplicas** | Model | count | models.write | 상태전이 pending→running |
| **cordonNode** | Node | reason | (manage) | trace 재라우팅 표시 |
| **drainGpu** | GpuDevice | graceSec | (manage) | 영향 Service 경고 |
| **acknowledgeIncident** | Incident | note | (기본) | audit |

> 초기 구현은 **mock-first**: Action 은 mock 상태를 낙관적으로 변경(optimistic writeback)하고,
> 실 백엔드/K8s mutating 은 후속 spike. (memory: web 은 백엔드 0개로 동작)

### 5.4 AI Agent (로컬 모델 + MCP)

에이전트가 우리 온톨로지를 **tool 로 조회·행동**한다. Tool 예시:
`queryObjects(type, filter)`, `traverseLinks(objectId, linkType)`, `getIncidents()`,
`invokeAction(actionType, objectId, params)`(검증 게이팅).
→ 화면에서 "이 느린 엔드포인트 원인 찾아줘" → 에이전트가 그래프를 traverse 하고 근본원인 후보 + 실행 가능 Action 을 제시.

---

## 6. 우리가 구현할 것 vs 하지 않을 것 (범위 규율)

### ✅ 이번/후속 사이클에서 구현 (buildable, mock-first)
1. **Ontology 데이터 모델**: Object/Link/Action 타입을 `types.ts`+`mock.ts`에 정의(5.1–5.3).
2. **Object View 화면**: 단일 엔티티 상세 + 관계 패널 + Action 버튼(kinetic).
3. **Troubleshooting Flow(COP)**: Endpoint→Model→GPU→Node 를 관계 그래프로 잇는 단일 근본원인 추적 화면.
4. **Action(writeback) 프레임워크**: 파라미터 폼 + 검증(capability) + optimistic mock 반영 + audit 라인.
5. **AI Agent 패널**: 로컬 모델 + MCP tool-calling(온톨로지 조회 + Action 제안). 기존 MCP 진단 화면 확장.
6. **Ontology/분석 화면**: 이 문서의 개념·타입 그래프를 앱 안에서 렌더(deliverable 3).

### ❌ 구현하지 않음 (팔란티어 고유·과범위)
- Pipeline Builder / Data Connection(ETL 파이프라인) — 우리는 관측 데이터를 이미 받음.
- Quiver(고급 분석 노트북), Foundry 권한/거버넌스 풀스택.
- 범용 Function 저작 IDE, 다형 Interface 시스템 전체.
- 실제 분산 컴퓨팅/데이터 레이크.

---

## 7. IA(정보구조) 재구성 제안 — 트러블슈팅 흐름 중심

현재 nav 는 메트릭 나열형. 팔란티어식 **object-centric + 흐름 중심**으로 재편 제안:

```
탐색(Explore)      : Ontology 개요 · Object 탐색기
관측(Observe)      : Dashboard · Traces · GPU · Nodes · Network · Topology
추적(Investigate)  : Troubleshooting Flow(COP) · Incidents · Object View
제어(Operate)      : Actions · AI Agent(MCP) · Playground
연동(Integrate)    : Diagnostics · Models · Endpoints · Credentials
```

핵심 이동: **Investigate 그룹 신설**(근본원인 추적을 1급 시민으로), **Operate 그룹**(제어·에이전트를 묶음).
기존 화면은 유지하되 그룹만 흐름에 맞게 재배치 → 사용자가 "관측→추적→제어" 순서로 자연스럽게 흐른다.

---

## 8. 요약 — 카피하는 "느낌" 3가지

1. **온톨로지 렌즈**: 메트릭 나열이 아니라 Object–Link 그래프로 세계를 본다(명사·관계·동사).
2. **Kinetic 제어**: 화면에서 Action(동사)을 눌러 세계를 바꾼다 — 읽기 전용의 종말.
3. **접지된 AI**: 로컬 모델이 온톨로지를 tool 로 읽고 Action 을 호출 — "채팅봇"이 아닌 "운영 에이전트".
