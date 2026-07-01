# IMP-59 — Action(writeback) 프레임워크

## 기능
온톨로지 Object 를 대상으로 하는 **동사(Action) 실행 프레임워크**. Palantir Foundry Action Type 의
4요소(Parameters / Rules / Submission Criteria / Side Effects)를 그대로 미러링한 레지스트리 +
공용 `<ActionForm>` 컴포넌트 + 단일 mutation 계약(POST /ontology/actions/:name) + optimistic 수렴 +
audit 라인. 인시던트 ack/resolve/snooze 에 하드코딩돼 있던 kinetic axis 를 일반화한다.

## 목적
- kinetic control 축을 하나의 재사용 경로로 통일 — restartModel/scaleReplicas/cordonNode/drainGpu/
  ack/resolve/snooze 를 같은 계약으로 처리(IMP-57/60 이 재사용).
- capability 게이팅을 **trust boundary** 로 둔다: UI 숨김이 아니라 mock 라우트(서버 등가)에서도 거부.
- optimistic UI 를 timer 가 아니라 **명시적 provisional→reconciled** 상태로 구현 → 실백엔드 스왑이 no-op.
- `revision` 기반 stale-write(409) 낙관적 동시성 경로를 지금 배선(미래 실 mutating 대비).

## 요구사항
1. **ActionType 레지스트리** (`web/src/actions/registry.ts`) — verb 별 4요소 선언:
   - `params`: 폼 스키마(ActionParam[] 재사용, types.ts).
   - `rules`: 대상 Object 상태 전이(예: scaleReplicas → `warn`(pending) → `ok`(running)). mock 이 canonical 반영.
   - `submissionCriteria`: `can()` capability + 대상 status predicate. 불가 시 `{ ok:false, reason }`(기계판독 사유).
   - `sideEffects`: audit 엔트리 + toast + notification(문자열 라벨 배열은 types.ActionType.sideEffects 유지, 실행은 프레임워크).
   레지스트리 verb: restartModel(Model, models.write), scaleReplicas(Model, models.write),
   cordonNode(Node, manage), drainGpu(GpuDevice, manage), ack/resolve/snooze(Incident).
2. **`<ActionForm actionType target onDone />`** (`web/src/components/ActionForm.tsx`):
   - useFieldValidation(NEW hook, `web/src/hooks/useFieldValidation.ts`)로 params 검증 → FieldError 표시.
   - `evaluateSubmission()`로 can()+status 게이팅 → 불가면 submit disabled + 사유 문구(observe 무료 획득).
   - submit → 단일 mutation 계약: client intentId + idempotencyKey 포함. `useOptimistic` 로 provisional 표시,
     mock 이 돌려준 canonical object 로 reconcile. 409(stale revision)면 롤백 + 에러 토스트.
3. **단일 mutation 계약** (`web/src/api/client.ts` `submitAction`): POST /ontology/actions/:name,
   body `{ target, params, intentId, idempotencyKey, revision }`. 응답 `ActionResult{ object, audit, outcome }`.
   VITE_MOCK=off 면 transport 만 스왑(계약 동일).
4. **mock 일반화** (`web/src/api/mock.ts`): `actIncident` 를 흡수하는 `applyAction(name, body)`.
   - capability 재검증(서버 등가 trust boundary) → 불가 403 + reason.
   - revision 불일치 → 409 stale-write.
   - 상태 전이 반영(ONTOLOGY_OVERRIDES 모듈 상태로 revision++ 및 status 갱신) → 다음 buildOntology 반영.
   - idempotencyKey 재사용 → 기존 결과 반환(중복 실행 방지).
   - ActionAuditEntry 기록(모듈 상태 ACTION_AUDIT).
   - 라우트 `POST /ontology/actions/:name`. 기존 `POST /incidents/:id/(ack|resolve|snooze)` 는 applyAction 위임(비회귀).
5. **타입**(`web/src/api/types.ts`): `ActionAuditEntry{actionType,target,params,actor,ts,outcome}`,
   `ActionResult`, `SubmissionCheck{ok,reason?}`. IncidentAuditEntry 는 유지(비회귀).

## 함수 시그니처
```ts
// registry.ts
export interface ActionSpec {
  name: string; target: ObjectType; label: string;
  params: ActionParam[]; requiredCap?: string;
  sideEffects: string[];
  allowedStatus?: ObjectStatus[];   // 이 상태에서만 실행 가능(없으면 무제한)
  rulesNote: string;                // 전이 설명(사람용)
}
export const ACTION_REGISTRY: Record<string, ActionSpec>;
export function evaluateSubmission(spec, ctx:{can:(c:string)=>boolean; targetStatus?:ObjectStatus}): SubmissionCheck;

// hooks/useFieldValidation.ts
export function useFieldValidation(params: ActionParam[]):
  { values; errors; setValue; validateAll(): boolean; touched; touch };

// client.ts
export function submitAction(name, req:{target,params,revision?}): Promise<ActionResult>;

// mock.ts
function applyAction(name: string, body: Record<string,unknown>): Response;
```

## 테스트 케이스 (ActionForm.test.tsx, mock.action.test.ts)
- **normal**: scaleReplicas 폼 렌더(count 입력) → 제출 → provisional 표시 후 canonical 로 reconcile,
  audit outcome=ok, idempotencyKey 존재.
- **retry(idempotency)**: 동일 idempotencyKey 재전송 → 중복 상태전이 없이 같은 결과.
- **failure(409)**: stale revision 으로 제출 → 409 + 사유, 상태 롤백.
- **bad-input**: required 파라미터 미입력 → FieldError + submit 차단.
- **env-missing(capability)**: observe(can=false) → submit disabled + 기계판독 사유. mock 도 403(UI-only 아님).

## 출력 위치
- NEW: web/src/actions/registry.ts, web/src/hooks/useFieldValidation.ts, web/src/components/ActionForm.tsx
- EDIT: web/src/api/types.ts, web/src/api/mock.ts, web/src/api/client.ts
- TEST: web/src/components/ActionForm.test.tsx, web/src/api/mock.action.test.ts

## 의존성
- 신규 prod 의존성 0 (프로젝트 ethos). React 19 useOptimistic(내장). 기존 toast/FieldError 재사용.
- 대상 데이터: buildOntology()(IMP-56). capabilities can()(capabilities.tsx).
- OUT OF SCOPE: 실 K8s mutating(spike IMP-67) — mock optimistic 전이만.
