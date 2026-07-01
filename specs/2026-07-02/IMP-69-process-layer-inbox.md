# IMP-69 — PROCESS 레이어(Task/Workflow) + Action Inbox

- **Type**: ux (sev=high, effort=L)
- **Branch**: `feature/evolve-cycle5-active-ontology`
- **Date**: 2026-07-02
- **Sources**: `docs/ontology-usecase-comparison.md` §1B·§4, Palantir operational-process-coordination

## 배경 / Why

deep-research(패턴 1·6, 3-0)가 확인한 실사례의 핵심: 운영 온톨로지는 **2계층**으로 돈다.

- **PROCESS 층** — Task(assignee·시각·priority·status·workflow step), Workflow(순차 단계).
- **SUBJECT-MATTER 층** — 디지털트윈(우리의 Endpoint/Model/GpuDevice/Node/Service/Trace 그래프, IMP-56).

Palantir의 canonical 진입은 **Action Inbox**: *할당된 과업 큐 → 컨텍스트에서 온톨로지 탐색 → 조치 →
process 층 + subject-matter(디지털트윈) 양쪽에 writeback*. 우리는 subject-matter 층만 있고 Incident는
있으나 **assignee/priority/status/workflow를 가진 1급 Task와 "내게 할당된 과업" 진입 큐가 없다**.
그래서 "오퍼레이터가 오늘 무엇을 해야 하나"라는 과업-앵커 진입점(패턴 1)이 비어 있다.

## 무엇을 만드나 (Fix — 구현 계약 그대로)

### 1) Task/Workflow를 1급 PROCESS object로 신설 (types.ts)
- `Task`를 `ObjectType` 유니온에 추가(1급 온톨로지 객체 — ObjectView가 그대로 렌더, 링크로 subject-matter에 연결).
- `TaskProps { title, assignee, createdAt, assignedAt?, priority(low|med|high|urgent), status(open|triaged|assigned|in-progress|resolved), linkedObjectIds[], workflowId, workflowStepIndex }` — `OntologyObject<TaskProps>`의 props.
- `WorkflowDef { id, name, steps: WorkflowStep[] }`, `WorkflowStep { key, label, terminal? }` — **순서 있는 단계 정의**. Task.workflowStepIndex가 이 배열의 현재 위치.
- 새 `LinkKind = "tracks"` — Task --tracks--> subject-matter object(과업이 감시/조치하는 대상). Incident --spawns--> Task(인시던트가 과업을 낳음).
- `TaskStatus`/`TaskPriority` 타입 alias + `WORKFLOW_ORDER`(mock에서 status 전이 시 step 동기화 단일 출처).

### 2) mock.ts — Task 결정적 생성 + Incident→Task 링크 + 양 계층 writeback
- `INCIDENT_WORKFLOW: WorkflowDef` — steps: `triaged → assigned → in-progress → resolved`(순차).
- `buildOntologyFresh()`에서 **각 Incident마다 결정적으로 Task 하나**를 파생(seed=incident id):
  - assignee(운영자 풀에서 결정적), priority(severity→priority 매핑), status(초기 triaged/assigned),
    linkedObjectIds = 그 Incident가 affects하는 subject-matter 객체 + 그 이웃(2계층 링크의 subject-matter refs).
  - `add("task:<incId>", "Task", …)` + 링크: `incident:<id> --spawns--> task:<incId>`,
    각 linkedObjectId마다 `task:<incId> --tracks--> <objId>`.
  - Task override(ONTOLOGY_OVERRIDES)로 status/props writeback을 반영(mergeOverride 단일 출처 — IMP-81).
- Task status/step은 **`TASK_OVERRIDES`가 아니라 기존 `ONTOLOGY_OVERRIDES`** 경로로 반영(writeback ↔ 재구성 정합 재사용). props에 `status`/`workflowStepIndex`를 얹는다.
- **양 계층 writeback**: `applyAction`에서 assign/reassign/resolve가 target=`task:*`일 때:
  - process 층 = Task props(status/assignee/workflowStepIndex) 전이(ONTOLOGY_OVERRIDES).
  - subject-matter 층 = `resolve`면 그 Task가 tracks하는 각 subject-matter 객체(및 spawns한 Incident)의 상태도 함께 수렴(디지털트윈 반영). **실 외부 push는 IMP-67 spike** — 여기서는 온톨로지 override로만.
  - 기존 IMP-59 `evaluateSubmission`/revision/idempotency/audit 경로 전부 재사용(계약 불변, 추가만).

### 3) registry.ts — assign / reassign / resolve verbs 추가 (capability 게이팅)
- `assign { target: Task, params: [assignee(text,required)], requiredCap: "incident.write" }` — status open/triaged → assigned(step 전진).
- `reassign { target: Task, params: [assignee(text,required)], requiredCap: "incident.write" }` — assignee 교체(status 불변, in-progress로 전진 가능).
- `resolve`는 **이미 존재**(target=Incident)하나 Task에도 필요 → registry의 target은 단일이므로 **Task 전용 `resolveTask`** verb를 추가(라벨 "과업 해소", requiredCap `incident.write`, status→resolved, terminal step). Incident resolve와 충돌 없음.
- 모두 observe 프로파일에서 `incident.write` 부재 → `evaluateSubmission`이 disabled + 기계판독 사유(단일 출처).
- STATE_TRANSITION: Task verb는 온톨로지 status를 직접 바꾸지 않고(Task는 process object) props로 전이 → 새 `TASK_STEP_TRANSITION` 맵으로 workflowStepIndex/status를 결정(applyAction이 소비).

### 4) /inbox 화면 = 할당된 과업 큐 (Inbox.tsx) + 라우트/nav/App 배선(같은 pass)
- LEFT: Task 큐(리스트) — assignee/priority/status 필터. 각 행 = priority chip + status badge + title + linked 수.
- CENTER: 선택 Task 상세 — workflow 진행 스텝퍼(순차 단계, 현재 강조) + assignee + linked subject-matter 객체 목록(클릭 → ObjectView 열기, `useObjectView` 재사용) + Task Action(ActionForm: assign/reassign/resolveTask).
- 조치 → ActionForm.onDone에서 process 층(Task) 갱신 반영(재조회) + subject-matter 객체는 ObjectView가 자체 재조회.
- 빈 큐(필터 결과 0) → empty 상태 카피.
- route: `ROUTES.inbox = "/inbox"`, `PAGE_CAP.inbox = "dashboard"`(양 프로파일 공통 진입 — mutation은 ActionForm이 별도 게이팅, two-tier). nav: **추적** 그룹에 "과업 인박스" 추가(과업-앵커 진입). App.tsx 렌더 스위치 + Layout `Page` 유니온 추가.

### 5) 제약
mock-first · zero prod deps · Backend.AI 라이트+스틸블루 토큰 · 한글 주석 · reduce-motion 안전(신규 애니메이션 없음, 기존 컴포넌트 재사용) · ObjectView/ActionForm/registry 게이팅 재사용(추가만, 재작성 금지).

## 데이터 흐름 (writeback 양 계층)

```
Inbox 큐(Task) ──선택──> Task 상세 + linked subject-matter 객체(ObjectView)
   │                                   │
   │ ActionForm(assign/reassign/resolveTask)   ActionForm(restartModel/scaleReplicas/… — 기존)
   ▼                                   ▼
POST /ontology/actions/:verb (submitAction, IMP-59 계약)
   ▼
applyAction:
   process 층  → ONTOLOGY_OVERRIDES["task:<id>"].props {status, assignee, workflowStepIndex}
   subject 층  → (resolveTask) tracks 대상 + spawns Incident 상태 수렴(디지털트윈)
   ▼  (mergeOverride 단일 출처 — 직접조회/재구성 어긋남 0)
ActionResult(object=갱신 Task) → onDone → Inbox 재조회 · ObjectView 재조회
```

## 테스트 케이스 (Vitest)

Inbox.test.tsx (client 모킹, capabilities manage/observe 주입):
1. **task queue renders + filters** — 큐에 Task 행 렌더. assignee/priority/status 필터가 목록을 좁힌다.
2. **select task shows linked subject-matter objects** — Task 선택 → tracks된 subject-matter 객체가 목록에 뜨고, 클릭 시 ObjectView가 열린다(fetchOntologyObject 호출).
3. **action advances task status AND writes back to subject-matter object** — Task Action(resolveTask) 실행 → onDone의 ActionResult.object가 status=resolved(process 층 전진). (subject-matter 수렴은 mock 단위 테스트에서 검증.)
4. **workflow step advances** — assign 실행 → workflowStepIndex 전진(스텝퍼 반영).
5. **assign/reassign/resolveTask gated** — observe(incident.write=false) → ActionForm submit disabled + 사유 노출.
6. **empty inbox** — 필터 결과 0 → empty 상태.
7. **incident→task link + nav/route** — `ROUTES.inbox`/`PAGE_CAP.inbox` 등록(router.cap 회귀).

mock.process.test.ts (또는 기존 mock 테스트 확장 — 순수 계약):
8. **deterministic Task 생성** — 두 번 buildOntology → 동일 Task id/assignee/priority/linkedObjectIds.
9. **incident→task link** — 각 Incident마다 `spawns` Task + Task→subject-matter `tracks` 링크 존재.
10. **assign/resolveTask writeback (양 계층, mergeOverride 정합)** — resolveTask → Task status=resolved(process) + 직접조회(ontologyObject)와 재구성(buildOntology)이 일치. resolveTask가 tracks하는 subject-matter 객체 상태도 수렴(디지털트윈).
11. **gated (서버 등가)** — observe에서 assign → applyAction이 403 denied(mock trust boundary).

기존 테스트(ObjectView/ActionForm/Investigate/router.cap/Layout.nav 등) 비회귀.

## 보안 라이트체크
- writeback은 전부 capability-gated `ActionForm`/`evaluateSubmission`/`applyAction` 경로 위에서만(자동 mutation 없음, two-tier 유지).
- 신규 secret/eval/dangerouslySetInnerHTML 없음. Task props는 escape 렌더(fmtVal/텍스트). assignee는 결정적 mock 값(사용자 자유 입력은 assign 폼 → 서버 등가 게이팅 통과 시에만).

## Out of scope
- 실 외부 시스템 push(webhook 트랜잭셔널) = IMP-67 spike.
- Task 생성/삭제 UI, SLA 타이머, 알림 디스패치 연동(후속).
