# IMP-68 — /ontology 재설계: 추상 타입 카탈로그 → 운영 준비도 스코어카드

- **Type**: ux (sev=high, effort=M)
- **Branch**: feature/evolve-cycle5-active-ontology
- **Date**: 2026-07-02
- **Backlog**: evolve/IMPROVEMENTS.md §IMP-68

## 배경 / 문제

사용자가 현 `/ontology`(IMP-63) 화면을 **"애매하다(추상적이다)"** 고 지적했다. 자체 리서치
(docs/ontology-usecase-comparison.md §3·§4)로 원인을 확정했다: 현 화면은 **개념헤더 + 타입 카탈로그 +
스키마 그래프 + Action 목록** — "무슨 타입이 존재하나" 를 나열하는 **browsable 카탈로그(박물관형)** 다.
조사한 모든 실사례(Netflix·Datadog·ServiceNow·Palantir)가 **만장일치로 이 안티패턴을 피하고**
과업/알림/객체에서 진입한다(패턴 1·5). 카탈로그는 **"반복 운영 과업을 구동"할 때만** 가치가 생긴다
(Datadog Software Catalog Scorecards: 매일 1회 pass/fail 운영 준비도 — 패턴 7).

## 목표 (Datadog Software Catalog Scorecards 패턴)

`/ontology` 의 **정문(front door)** 을 **운영 준비도 스코어카드** 로 바꾼다:

1. 타입 나열 대신, 각 **인스턴스**(Endpoint/Model/GpuDevice/Node/Service)를 **pass/fail 규칙** 으로 채점.
   규칙을 **Production Readiness / Observability / Ownership** 3그룹(Datadog 기본 그룹)으로 묶는다.
2. 화면 최상단 = **"지금 무엇이 주의를 요하나"** 요약 — 실패 규칙 수 + 위험(at-risk) 인스턴스 수.
   ("무슨 타입이 있나" 가 아니라 "지금 뭐가 문제냐" 에 답하는 과업-앵커 진입.)
3. 각 실패 항목 클릭 → 해당 인스턴스의 **ObjectView(IMP-57)** 드로어 열기(속성·관계·인라인 Action),
   또는 **/investigate COP(IMP-58)** 로 딥링크(근본원인 추적) — 카탈로그를 **과업으로 연결**.
4. 개념헤더 + 스키마 그래프 + Action 목록은 **제거하지 않고** "스키마 참조" **보조 탭** 으로 접는다
   (reachable 하되 정문 아님 — IMP-70 재배치와 정합).
5. 스코어는 온톨로지 인스턴스 **props 에서 결정적으로 파생**(mock-first, IMP-81 스냅샷 재사용).

## 설계

### 1) 순수 스코어링 계층 — `web/src/api/ontologyScorecard.ts` (신규)

TopologyView/스키마 파생과 동일 관례: **순수 함수**(DOM 무관, 결정적)로 스코어를 만든다.
`ontologySchema.ts`(카탈로그·스키마 그래프)의 형제 모듈.

**채점 대상 타입(SCORABLE)**: `Endpoint`, `Model`, `GpuDevice`, `Node`, `Service`.
- Trace(실행 궤적)·Incident(이벤트)는 "운영 준비도" 대상이 아니라 관측/이벤트 → **채점 제외**
  (단, 스키마 참조 탭에서 여전히 카탈로그·그래프에 등장 = reachable).

**규칙(Rule)** — `{ id, group, label, applies(type), evaluate(obj) → pass|fail }`. 그룹 3종:

- **Production Readiness (운영 준비)**
  - `status-healthy`: 상태가 위험(crit) 이 아님 (모든 SCORABLE). fail=위험.
  - `deployed`: 배포/활성 상태 — Endpoint.ready=true / Model.replicas>0 / GpuDevice·Node 는 상태≠unknown.
- **Observability (관측성)**
  - `has-telemetry`: 텔레메트리 신호를 emit — 타입별 핵심 메트릭 prop 존재
    (Endpoint.replicas, Model.context_window, GpuDevice.util_perc, Node.cpu_util, Service.qps).
  - `threshold-signal`: SLO/임계 판정 신호 존재 — Service.error_rate / GpuDevice.temp_c·xid_recent /
    Endpoint.backend / Model.pattern / Node.cpu_util (임계 판정 가능한 축이 있는가).
- **Ownership (오너십)**
  - `has-owner`: 오너/귀속 지정 — Endpoint.app_id||dept_id / Model.provider / Node·GpuDevice.hostname||device /
    Service.name (누가 소유·귀속인지 식별 가능한가).

각 규칙은 **결정적**(props/status 만 읽음, 난수·시각 없음). 규칙 결과 = boolean.

**파생 산출물**:
- `InstanceScore`: `{ object, results: RuleResult[], failCount, passCount, atRisk }`.
  - `atRisk` = status===crit **또는** Production Readiness 그룹에 fail 이 있음.
- `GroupScore`: 그룹별 pass/total 집계(전체·인스턴스별).
- `ScorecardSummary`: `{ scored, atRiskCount, failingRuleCount, byGroup, allPass }`.
  - `failingRuleCount` = 모든 인스턴스의 fail 규칙 총합.
  - `allPass` = scored>0 이고 fail 이 0 (all-pass 상태).
- 정렬: **at-risk 우선 → failCount 내림차순 → id 사전순**(결정적, 주의 요하는 것이 위로).

`buildScorecard(objects) → { instances: InstanceScore[]; summary: ScorecardSummary; groups: {...} }`.
빈 입력 → `scored=0, allPass=false`(empty 상태 카피 트리거).

### 2) 화면 — `web/src/pages/Ontology.tsx` (transform, not rewrite)

- **탭 2개**(SlidePanel me-tabs/modality-tab 관례 재사용):
  - **"운영 준비도"(기본, primary)** — 스코어카드.
  - **"스키마 참조"(보조)** — 기존 개념헤더 + Object Type 카탈로그 + Link Type 스키마 그래프
    + Action Type 목록을 **그대로** 이 탭으로 이동(기존 컴포넌트·TopologyView·표 재사용).
- **스코어카드 탭 구성**:
  1. **"지금 주의를 요하는 것" 요약 카드** — at-risk 인스턴스 수 + 실패 규칙 총합 + 그룹별 pass/total.
     all-pass 면 "모든 인스턴스 통과" 초록 상태, scored=0 이면 empty 안내.
  2. **인스턴스 스코어 목록** — 정렬(at-risk 우선). 각 행:
     - 타입 글리프/색(objectTypeVisual) + title + 상태 Badge + fail/total 요약.
     - 3그룹 pass/fail 셀(색+텍스트 라벨 — WCAG 1.4.1, 색-only 금지).
     - **딥링크 2개**: [상세] → ObjectView 드로어(view.open), [조사] → /investigate COP(onNavigate("investigate", {entity:id})).
     - 실패한 규칙은 라벨을 명시(어느 규칙이 fail 인지 보이게).
- KineticStrip(IMP-72)·ObjectView(IMP-57) 드로어는 **양 탭 공통**으로 상단/하단 유지.
- 로드/에러/빈 상태·새로고침·DataFreshness 기존 배선 유지.
- 탭 상태는 로컬 useState(기본 "scorecard"). URL 동기화는 IMP-70 범위(여기선 로컬).

### 3) 딥링크 계약(기존 재사용, 신규 계약 없음)

- ObjectView: `useObjectView().open(id)` → urlState obj/objstack(IMP-57).
- COP: `onNavigate("investigate", { entity: id })` → Investigate 가 urlState.entity 로 진입점 pre-fill(IMP-58/72).

## 테스트 케이스

### A. 순수 스코어링 — `web/src/api/ontologyScorecard.test.ts` (신규)
1. **per-instance 채점**: crit Endpoint(ready=false) → status-healthy fail + deployed fail, atRisk=true.
   ok Endpoint(ready=true, app_id 있음) → 전 규칙 pass, atRisk=false.
2. **rule groups**: 결과가 Production Readiness/Observability/Ownership 3그룹으로 묶인다.
3. **"주의 요약" 카운트**: failingRuleCount = 인스턴스별 fail 합, atRiskCount = crit/PR-fail 인스턴스 수.
4. **정렬(결정적)**: at-risk 인스턴스가 목록 상단, 그다음 failCount 내림차순, 그다음 id 사전순.
5. **결정성(retry)**: 같은 입력 재호출 → 동일 instances 순서·동일 카운트.
6. **채점 대상 필터**: Trace/Incident 는 instances 에서 제외(SCORABLE 만).
7. **all-pass**: 전부 정상+오너 있는 입력 → summary.allPass=true, atRiskCount=0.
8. **empty**: 빈 입력 → scored=0, allPass=false(throw 없음).
9. **ownership fail**: app_id/dept_id 둘 다 없는 Endpoint → has-owner fail.

### B. 화면 — `web/src/pages/Ontology.test.tsx` (adapt)
1. **primary=스코어카드**: 기본 진입 시 "운영 준비도" 탭이 활성, "주의" 요약(at-risk 수)이 보인다.
2. **per-instance pass/fail + 그룹**: crit 인스턴스 행이 렌더되고 fail 규칙/그룹 라벨이 보인다.
3. **주의 요약 카운트**: at-risk 수·실패 규칙 수 텍스트가 요약에 표시된다.
4. **실패 항목 딥링크 → ObjectView**: 인스턴스 [상세] 클릭 → ObjectView 드로어(속성) + fetchOntologyObject 호출.
5. **실패 항목 딥링크 → COP**: [조사] 클릭 → onNavigate("investigate", { entity }) 호출.
6. **스키마 그래프 = 보조 탭**: 기본 탭엔 스키마 그래프 없음 → "스키마 참조" 탭 클릭 후 TopologyView·관계표·개념헤더·Action 표 등장(still reachable).
7. **route·nav 유지**: ROUTES.ontology=/ontology, PAGE_CAP.ontology=dashboard.
8. **failure**: fetchOntologyObjects reject → 에러 상태(페이지 생존).
9. **all-pass/empty**: 빈 objects → 스코어카드 empty 안내 + 스키마 참조 탭 여전히 카드 7장.

### C. 순수 파생 회귀 — `ontologySchema.test.ts`
- 변경 없음(카탈로그·스키마 그래프 순수 파생은 보조 탭에서 그대로 사용). 기존 테스트 유지.

## 보안(mock/UI 라이트체크)
- 신규 데이터 계약 없음(기존 fetchOntologyObjects/Links·onNavigate·useObjectView 재사용).
- 스코어링은 순수·결정적(난수/시각 없음, props 만). 사용자 입력·시크릿·주입면 없음.
- props 값은 기존 렌더 관례(escape, fmtVal)로만 표시.

## 제약
mock-first, prod deps 0, Backend.AI 라이트 + 스틸블루 토큰(신규 색 금지), 한글 주석,
reduce-motion 안전(색 전이 무·정적). 스키마 그래프 reachable(보조 탭). capability 게이팅 유지.
TOUCHED_SURFACES 기록(시각 QA).

## 완료 기준
`cd web && npm run test`(전량 pass) + `npm run build`(tsc) green → 커밋.
