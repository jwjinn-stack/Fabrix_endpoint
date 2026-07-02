# IMP-90 — 과업 인박스(/inbox) 제거 — 관제는 할당보다 알림+즉시대응

- **Type**: ux (sev=medium, effort=M) · Direction 12 · IMP-69 REVERSAL
- **Branch**: feature/evolve-cycle6-ontology-ux
- **Date**: 2026-07-02

## Why (제품 결정)
실시간 관제(monitoring) 콘솔의 실제 행동양식은 "과업 배정 → 처리"가 아니라 "알림 → 즉시
조치"다. IMP-69 가 도입한 /inbox(담당자·priority·workflow 스텝퍼 중심 과업 큐)와 그 하부
Task/Workflow(assignee·workflowStepIndex) 레이어는 관제 톤과 어긋나고 유지비만 늘린다.
즉시대응 흐름은 이미 KineticStrip(IMP-72, 알림 → 4-슬롯 즉시 조치)이 담당하므로, /inbox 와
Task 할당 레이어를 안전 제거한다. **Incident 객체 + 그 라이프사이클(ack/resolve/snooze)은
유지**(direction 12 명시).

## 결정 — 강등 아닌 "완전 제거"
Task 는 SUBJECT-MATTER 디지털트윈 위에 얹은 PROCESS 층 1급 ObjectType 로, assignee/workflow
전용이다. 필드만 optional 로 강등하면 exhaustive `Record<ObjectType,…>`/`Record<LinkKind,…>`
맵 곳곳에 dead key(Task/spawns/tracks)가 남는다. 따라서 **Task ObjectType + spawns/tracks
LinkKind + Task/Workflow 타입 + assign/reassign/resolveTask verb 를 전부 제거**하는 편이
"dangling 0" 를 실제로 달성한다. Incident 는 그대로(spawns→Task 링크만 제거).

## Fix (구현 대상)
1. **화면·라우팅**
   - `router.ts` — ROUTES.inbox, PAGE_CAP.inbox 제거.
   - `Layout.tsx` — Page 유니온에서 `"inbox"` 제거, "추적" 그룹의 `과업 인박스` nav 항목 제거
     (그룹은 근본원인 추적(COP) 하나로 유지).
   - `App.tsx` — Inbox import + `effPage === "inbox"` 렌더 케이스 제거.
   - `web/src/pages/Inbox.tsx` + `web/src/pages/Inbox.test.tsx` 삭제.
   - `urlState.ts` — inboxSchema 제거.
2. **온톨로지 데이터 모델(types.ts)**
   - `ObjectType` 에서 `"Task"` 제거.
   - `LinkKind` 에서 `"spawns" | "tracks"` 제거.
   - `TaskPriority`/`TaskStatus`/`TaskProps`/`WorkflowStep`/`WorkflowDef` 타입 제거.
3. **Action 레지스트리(registry.ts)**
   - `TASK_STEP_TRANSITION` 제거, `STATE_TRANSITION` 의 assign/reassign/resolveTask 제거,
     `ACTION_REGISTRY` 의 assign/reassign/resolveTask spec 제거, TaskStatus import 제거.
4. **mock.ts**
   - INCIDENT_WORKFLOW·workflowStepIndex·severityToPriority·OPERATORS·assigneeFor 제거.
   - buildOntology 의 "PROCESS 층 Task 승격" 블록 제거(Incident→spawns→Task, Task→tracks 링크
     생성 삭제). Incident affects 링크·라이프사이클은 유지.
   - applyAction 의 `spec.target === "Task"` writeback 블록 제거.
   - import 에서 TaskProps/TaskPriority/TaskStatus/WorkflowDef, TASK_STEP_TRANSITION 제거.
5. **파생·표면의 exhaustive 맵에서 Task/spawns/tracks 키 제거**(dangling 0):
   - ontologyScorecard.ts(keysByType ×2), ObjectView.tsx(TYPE_METRICS, LINK_META, KIND_ORDER),
     objectTypeVisual.ts, Ontology.tsx(TYPE_DESC, LINK_LABEL), MetricSources.tsx(OBJ_LABEL),
     AiAgent.tsx(TYPE_GLYPH, TYPE_LABEL), investigate.ts(EDGE_BADGE), searchAround.ts
     (SEARCH_AROUND_KINDS, AROUND_LABEL).
6. **테스트**
   - `mock.process.test.ts`(IMP-69 Task 계약) 삭제.
   - `isolation.test.tsx`(IMP-88) — FULL_OBJECTS/FULL_LINKS 의 Task 객체·spawns/tracks 링크
     제거, ALL_TYPES 에서 "Task" 제거, "Task 만 있는 스냅샷"/"비-SCORABLE Task" 케이스를
     Task 부재 세계에 맞게 조정. "inbox 라우트 미등록" 케이스는 이제 실제 미등록을 검증하도록
     `pageFromPath("/inbox") === "dashboard"` 로 갱신.
   - `Layout.nav.test.tsx` — "추적" 그룹 children 에서 과업 인박스 제거.

## Immediate-response 수렴
즉시대응은 KineticStrip(이미 존재, 재작성 없음)이 담당. 이 제거가 KineticStrip 기능을 축소하지
않는다(KineticStrip 은 Task/inboxSchema/assign 계열을 참조하지 않음 — grep 확인 완료).

## 테스트 케이스
- `/inbox` 라우트 제거 → `pageFromPath("/inbox")` = `dashboard`(딥링크 폴백).
- nav 에서 `과업 인박스` 항목 사라짐(Layout.nav.test 그룹 표 갱신 통과).
- Task ObjectType/verb/타입 전부 제거 후 tsc·전체 테스트에서 dangling 참조 0.
- Incident 라이프사이클(ack/resolve/snooze) 그대로 통과.
- IMP-88 격리 스위트 그린 — buildScorecard/buildSchemaGraph/buildObjectTypeCatalog/buildGraph/
  attributeDetections 가 Task 부재 세계에서 crash 없이 degrade.
- `cd web && npm run test`(전부 통과, 특히 isolation) + `npm run build`(tsc) 통과.

## Out of scope
- Incident 객체·라이프사이클 변경. KineticStrip 재설계. 다른 백로그 항목.
