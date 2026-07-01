# 운영 온톨로지 실사용 사례 vs. FABRIX 구현 — 비교·간극 리포트

> 배경: cycle4에서 Palantir 온톨로지를 카피해 데이터모델·COP·Object View·Action·AI Agent·`/ontology` 화면을 구현했으나,
> `/ontology` 화면이 **애매하게(추상적으로)** 느껴진다는 지적. 실제 운영 온톨로지가 프로덕션에서 어떻게 쓰이는지
> deep-research(5각도·22소스·25클레임 적대적 검증, 23확정/2기각)로 조사해 우리 구현과 비교한다.
> 출처는 1차(vendor docs·엔지니어링 블로그) 우선. 상세 인용은 각 절 하단.

---

## 0. 한 줄 결론

> **실제 운영 온톨로지의 가치는 "타입 정의 카탈로그"가 아니라 ①과업-앵커 진입점 + ②writeback 루프에서 나온다.**
> 조사한 모든 실사례(Netflix·Datadog·ServiceNow·Palantir)가 오퍼레이터를 **구체적 과업**(알림·인시던트·할당된 일·감시 대상 객체)에서 시작시키고,
> **실제 상태를 바꾸는 액션**으로 끝낸다. **browsable 타입/스키마 카탈로그에서 시작하는 사례는 하나도 없다.**
>
> → 우리 `/investigate`(COP)·`ObjectView`·`Action 프레임워크`는 **이미 정답 방향**이다.
> **애매함의 정체는 정확히 `/ontology` 화면** — 실사례가 만장일치로 피하는 그 안티패턴(추상 카탈로그+스키마 그래프)이다.

---

## 1. 실사용 사례 (named)

### (A) 인프라 / IT-ops / AIOps — 우리와 가장 가까운 결

| 사례 | 온톨로지 모델(objects/links) | 진입 과업 | 화면 구성 | 출처 |
|---|---|---|---|---|
| **Netflix 실시간 서비스 토폴로지** | 노드=서비스/앱, 엣지=호출 의존(eBPF 네트워크플로 + IPC(gRPC/GraphQL/REST) + 분산 트레이스 **3계층 융합**). "living map", 실트래픽으로 계속 갱신 | **인시던트 대응**("장애가 로컬인가 상류 전파인가"), **blast-radius**("이 서비스 내리면 뭐가 영향받나"), 근본원인, 변경/마이그레이션 계획 | 정적/지연 의존맵을 **명시적으로 거부**. 과업에서 진입하는 라이브 맵 | Netflix Tech Blog(2026) |
| **Datadog Service Page** | Service(=같은 일 하는 프로세스 집합), Resource(엔드포인트/쿼리), Dependency(상·하류, 추론된 DB/큐/서드파티=보라 노드), Deployment(버전 태그), Issue(유사 에러 집계) | 서비스 객체에서 진입 → 드릴인 의존 그래프 | **객체별 drill-in** 의존 패널(글로벌 Service Map은 **별도 아티팩트**). 카드에서 **SLO 생성·인시던트 선언·모니터 생성**(writeback 내장) | docs.datadoghq.com/tracing/services/service_page |
| **Datadog Software Catalog Scorecards** | 엔티티 kind:service/datastore/queue/api… | **매일 1회 자동 pass/fail 평가**(운영 준비도) | Production Readiness/Observability/Ownership 그룹. 규칙 예: "SLO 있나·모니터 있나·on-call 지정·최근 3개월 내 배포" | docs.datadoghq.com/software_catalog/scorecards |
| **ServiceNow (ITOM Event Mgmt)** | CSDM 계층(CI→Service Offering→Service, Support Group) | **알림 triage**(상관 검증 → 조치 → 인시던트 생성) — 가장 흔한 과업=알림에서 인시던트 생성 | 과업 순서(Analyze→Triage→Remediate) 중심. *주의: writeback/자동 CI연결 세부는 본 조사에서 **기각**(1-2), triage-앵커 논지에만 사용* | docs.servicenow.com ITOM |

### (B) Palantir Foundry — 온톨로지의 원형

| 진입 유형 | 무엇인가 | 구성(objects/links/actions) | 출처 |
|---|---|---|---|
| **Object View**(객체-중심) | ONE 객체의 360° 허브 — 전기적 데이터 + 모든 링크된 객체 + 핵심 metric + **임베드된 워크플로/액션**을 한 화면에 | Airport 예: 링크된 Aircraft/Flight + 워크플로 임베드. Object Explorer로 "Search Arounds(링크 순회)"→객체 집합에 **bulk Action(writeback, ≤1000)** | docs/foundry/object-views, /ontology/applications |
| **Action Inbox**(과업-중심) | 할당된 과업 큐 → 컨텍스트에서 온톨로지 탐색 → 조치 → **디지털트윈+외부시스템에 writeback** | **2계층**: PROCESS(Task: assignee·시각·priority·status, Workflow=순차 단계) over SUBJECT-MATTER(디지털트윈=단일 진실원). PSPS 예: 고객 "연락 실패" 표기 + 외부 방송시스템 push(webhook 트랜잭셔널: 외부 실패→온톨로지 변경 없음) | docs/foundry/use-case-patterns/operational-process-coordination |
| **Common Operating Picture**(상황-중심) | 상황의 공유 실시간 뷰 — "벽에 거는 big-screen" | **고정 소수 위젯 세트**: Metric Card + Map + Chart:XY + Object Table. 스키마 나열이 **아님** | learn.palantir.com/appdev-06, docs/foundry/workshop/example-applications |

**Palantir의 명시적 논지**(why-ontology, 원문): *"The Ontology represents the decisions in an enterprise, not simply the data"* · *"Closing the action loop as decisions are made in real-time is what distinguishes an operational system from an analytical system."* 명사(objects)는 반드시 동사(actions)와 짝지어진다("semantics must be paired with kinetics").

---

## 2. 공통 성공 패턴 (검증됨, 대부분 3-0)

1. **과업-앵커 진입점** (high, 4개 1차 소스 수렴) — 알림·인시던트·할당된 일·감시 객체에서 시작. 타입 리스트에서 시작 안 함.
2. **writeback 루프** (high) — 화면에서 상태를 바꾸는 액션(인시던트 생성·scale·cordon·재할당) + 소스 시스템 전파. 정적 카탈로그엔 구조적으로 없음.
3. **Object View = 360° 단일 객체 허브** (high) — 속성 + 링크된 이웃 + metric + 임베드 액션.
4. **COP = 단일 화면·소수 위젯** (high) — 화면 점프 대신 한 화면. 우리 IMP-58 단일화면 설계를 검증.
5. **인프라 그래프는 라이브 텔레메트리 파생 + 객체별 drill-in** (high) — 손으로 그린 글로벌 스키마 그래프가 아님. 글로벌 맵과 객체별 뷰는 **분리된 아티팩트**.
6. **2계층 분리**(PROCESS over SUBJECT-MATTER) (high, 단일소스) — Task/Workflow 프로세스 층을 디지털트윈 위에.
7. **카탈로그는 "반복 과업을 구동"할 때 가치** (high) — Datadog Scorecards처럼 매일 pass/fail 운영준비도로 만들면 "무슨 타입이 있나"가 아니라 "지금 뭐가 문제냐"에 답함.

---

## 3. 우리 구현과의 비교 (screen by screen)

| 우리 구현 | 실사례 정합 | 판정 |
|---|---|---|
| **`/investigate` COP**(IMP-58) — Endpoint→Model→GPU→Node 단일화면 근본원인 + blast-radius | 패턴 1·4·5와 정합(과업-앵커, 단일화면, 객체별 drill-in). Netflix/Datadog/Palantir COP와 동형 | ✅ **정답 방향** |
| **`ObjectView`**(IMP-57) — 속성 + linkKind 이웃 in-place traverse + 인라인 Action | 패턴 3과 거의 1:1(360° 허브). Palantir Object View 모델 | ✅ **정답 방향** |
| **Action 프레임워크**(IMP-59) — 파라미터 폼·capability 게이팅·optimistic·audit | 패턴 2(writeback 루프)의 핵심. Palantir Action(명사+동사) 정합 | ✅ **정답 방향**(실 mutating은 IMP-67 spike) |
| **`/agent`**(IMP-60) — MCP tool-calling·two-tier 게이팅 | AIP Agent 방향과 정합(오픈 질문 남음: 실전 triage에서의 구체 affordance) | ✅ 방향 정합 |
| **`/ontology`**(IMP-63) — 개념헤더 + **타입 카탈로그 + 스키마 그래프** + Action 목록 | ❌ **패턴 1·5·7과 정면 배치** — 실사례가 만장일치로 피하는 "browsable 타입/스키마 카탈로그". 과업 진입점 아님, 글로벌 스키마 그래프를 전면에 | ⚠️ **애매함의 정체** |

**결론**: cycle4의 대부분(투자 규모 큰 화면들)은 이미 옳다. 문제는 **`/ontology` 한 화면**이 실사례가 피하는 "박물관형 카탈로그"라는 것. 사용자가 느낀 "애매함"과 정확히 일치한다.

---

## 4. "추상 카탈로그 → 과업-앵커 운영 화면"으로 가는 시사점

1. **`/ontology`를 운영 준비도 스코어카드로 전환** (패턴 7) — 타입 나열 대신 "각 Endpoint/Model이 SLO·알림·오너·최근활동을 갖췄나"를 pass/fail로 채점해 **"지금 무엇이 주의를 요하나"**에 답하고, 각 항목을 객체/COP로 링크. → **IMP-68**.
2. **PROCESS 레이어 + Action Inbox 신설** (패턴 1·6) — Incident/Task를 assignee·priority·status·workflow 갖춘 1급 process object로, "내게 할당된 운영 과업" 큐를 진입점으로. 우리 인프라 그래프(Endpoint/Model/GPU/Node)가 subject-matter 층. → **IMP-69**.
3. **온톨로지 진입점 재배치** (패턴 1) — 오퍼레이터가 과업/COP/객체에 랜딩하게, 온톨로지 개요는 "스키마 참조" 보조 탭으로 강등(박물관 정문 금지). → **IMP-70**.
4. **글로벌 스키마 그래프는 참조로, 일상은 객체별 drill-in** (패턴 5) — 스키마 그래프 유지하되 전면에서 접고, 실 진입은 객체 이웃 뷰. → IMP-70에 포함 또는 소규모 별건.

---

## 5. 정직한 한계 (caveats)

- **Palantir 근거는 전부 1차 vendor docs·튜토리얼** — 제품이 "무엇인가"엔 권위 있으나 **프로덕션 성공의 독립 증거는 아님**(자기홍보). 산업별(제조·물류·금융…) **outcome(MTTR·처리량) 동반 실배포 케이스는 검증 실패** — 패턴·데모만 확보.
- **"360°/디지털트윈/action loop"는 Palantir의 열망적 마케팅 언어** — 사실이 아니라 그들의 프레이밍으로 귀속.
- **ServiceNow의 writeback·자동 CI연결 세부는 본 조사에서 기각**(1-2) — triage-앵커 논지에만 사용, writeback 모범으로 과신 금지.
- **Datadog Service Page도 사실은 ~20섹션 대형 대시보드** — "과업-앵커 vs 스키마 브라우징"은 실제론 **혼재**. 다만 "객체 진입점에 액션 임베드"는 견고.
- **2계층 분리(패턴 6)는 단일 소스**(Palantir 1개 페이지).
- **GPU-추론 특화 온톨로지 사례는 전무** — 엔티티 모델은 **복사 아니라 적응** 필요.

## 6. 미해결 질문 (다음 리서치 후보)
- 실 Palantir 고객이 배포한 구체 object/link/action 타입과 측정된 운영 성과(MTTR·처리량·비용)?
- AIP Agent가 프로덕션 triage에서 온톨로지를 어떻게 다루나(읽기→액션 제안→사람 확인 후 writeback)의 구체 화면 affordance? (우리 IMP-60 관련)
- GPU-추론 도메인의 올바른 PROCESS 층 모델 = Palantir식 Task(assignee/priority/status/workflow)인가, ServiceNow식 alert-native인가?
- 글로벌 스키마 그래프를 오퍼레이터가 실제로 일상에서 얼마나 쓰나(vendor들은 객체별/과업 뷰에 일상을 앵커하고 글로벌 맵은 분리 유지)?

---

## 출처 (핵심)
- Netflix, *From Silos to Service Topology* (2026) — netflixtechblog.com
- Datadog Service Page / Software Catalog Scorecards — docs.datadoghq.com
- ServiceNow ITOM Event Management(triage) — docs.servicenow.com
- Palantir: why-ontology · operational-process-coordination · object-views · applications · workshop/example-applications · learn.palantir.com/appdev-06
- Thoughtworks, *Why ontologies matter, why they fail* — "전체 도메인을 배포 전 모델링(boil-the-ocean)"이 대표 실패모드, 그런 프로젝트는 ~1년 후 죽는다.
