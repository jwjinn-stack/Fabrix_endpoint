# IMP-65 — Action 폼 & 실행 피드백 시각 완성도

- Type: aesthetic (sev=low)
- Depends on: IMP-59(완료 — ActionForm/registry/optimistic 계약), IMP-57(ObjectView), IMP-64(objectTypeVisual), IMP-38(IncidentAuditEntry 시각 패턴)
- Branch: feature/evolve-cycle4-ontology
- Date: 2026-07-01

## 배경 / 문제

IMP-59 가 만든 제어 표면(ActionForm + registry + optimistic 수렴)은 **기능적으로 완전**하지만
시각적으로 얇다. 특히:

- cordon/drain/scale 처럼 **실제 blast radius**가 있는 파괴적 mutation 이, ack/snooze 같은
  가벼운 동사와 **동일한 버튼**으로 실행된다 — 위험 위계가 안 보인다. Vercel/Stripe 의
  destructive-confirm(영향 요약 + 명시적 확인) 대비 밋밋하다.
- optimistic 전이(`provisional → reconciled`)가 정적 텍스트 배지뿐 — Linear 식 "지금 반영 중"의
  살아있는 느낌(pending pulse)이 없다.
- ObjectView 안에 audit 이 **아예 없다** — 누가·언제·무엇을 실행했는지 흔적이 안 남는다.
  IMP-38 IncidentAuditEntry 는 이미 timeline 스러운 패턴을 갖는데 Action 에는 미적용.

**중요(비회귀 계약)**: IMP-59 의 mutation 계약(`submitAction`·`ActionResult`·idempotency)과
capability 게이팅(`evaluateSubmission`)은 **손대지 않는다**. 이 작업은 그 위에 얹는 **시각 레이어**다.
severity 필드는 registry 에 **가산(additive)**으로만 추가한다(기존 필드/테스트 불변).

## 목표

1. **Severity-aware confirm** — registry `severity`(가산 필드)에서 파생. `destructive` 동사는
   `ConfirmDialog`(danger 톤) + **영향 요약(sideEffects·rulesNote)** + **type-to-confirm**(대상 id
   입력) 마찰을 요구. `low` 동사(ack/snooze)는 확인 없이 즉시(기존 흐름 유지).
2. **Optimistic 전이 피드백(시각 레이어)** — 제출 시 `provisional` 배지에 **pending pulse**(dot),
   `reconciled` 로 확정, `error` 시 롤백 + toast. IMP-59 가 노출한 `phase`(idle/provisional/
   reconciled/error) 상태에 **그대로 바인딩**(병렬 상태 신설 금지).
3. **Audit 타임라인** — ObjectView 안에 실행 이력을 **세로 타임라인**(flat list 아님)으로. 각 항목:
   시각·verb 라벨·outcome·actor. `onDone(res)` 가 돌려주는 `ActionAuditEntry` 를 ObjectView 가
   누적(신규 fetch endpoint 없음 — 기존 계약만 소비).

## 설계

### 1. registry `severity`(가산)

```ts
export type ActionSeverity = "low" | "destructive";
// ActionSpec 에 severity?: ActionSeverity 추가(옵션 — 없으면 "low").
```

- `restartModel/scaleReplicas/cordonNode/drainGpu` → `destructive`(상태 전이 + blast radius)
- `ack/resolve/snooze` → `low`(온톨로지 status 불변 또는 해소 — 마찰 불필요)
- 헬퍼 `actionSeverity(spec)` 로 파생(미지정 fallback=low). 기존 evaluateSubmission/STATE_TRANSITION 불변.

### 2. ActionForm — severity-aware confirm

- `low`: 기존과 동일 — submit 즉시 `runAction()`(신규 confirm 없음).
- `destructive`: submit 이 **바로 실행하지 않고** `ConfirmDialog` 를 연다.
  - `danger` 톤 + 제목 `"{label} 실행 확인"`.
  - 본문 = **영향 요약**: sideEffects 리스트 + rulesNote(상태 전이) + 대상 id.
  - **type-to-confirm**: 대상 id 를 입력해야 확인 버튼 enable(오조작 방지 — Vercel/Stripe 패턴).
  - 확인 → `runAction()`(기존 optimistic 경로 그대로). 취소 → 닫기(상태 불변).
- `runAction()` 은 기존 `startTransition`+`applyOptimistic`+`submitAction` 로직을 그대로 추출한 것 —
  **mutation 계약·게이팅 불변**. validateAll/submission 게이팅은 confirm **이전**에 수행.

### 3. optimistic 배지 pulse

- `phase-provisional` 배지 앞에 `<span className="phase-dot">`(pulse 애니메이션).
- pulse 는 CSS `@keyframes af-pulse`(opacity/scale). **prefers-reduced-motion 존중**:
  전역 규칙(index.css:112 `animation-duration: .01ms`)이 자동으로 정지 + 명시적 `@media` 가드로
  reduce 시 정적 dot.
- reconciled=steel-blue 확정, error=danger. (색-only 금지 — 텍스트 병기 유지.)

### 4. ObjectView audit 타임라인

- ObjectView 에 `const [auditLog, setAuditLog] = useState<ActionAuditEntry[]>([])`.
- 각 `ActionForm` 의 `onDone(res)` 에서 `setAuditLog((l) => [res.audit, ...l])`(최근 순 prepend).
- head 변경(traverse/재진입) 시 auditLog 리셋(객체별 컨텍스트).
- 렌더: Actions 섹션 뒤 `실행 이력` 섹션 — `<ol className="audit-timeline">`.
  - 각 entry: 좌측 rail(dot, outcome 색) + verb 라벨(registry) + outcome 배지 + actor + 상대 시각.
  - 비어 있으면 섹션 미표시(빈 상태 노이즈 없음).
- outcome→tone: ok=green, conflict=amber, denied=amber, error=red.

## 파일 변경

- `web/src/actions/registry.ts` — `ActionSeverity` 타입 + `severity` 필드(4개 destructive) + `actionSeverity()`.
- `web/src/components/ActionForm.tsx` — confirm 게이트(destructive) + type-to-confirm + pulse dot.
- `web/src/components/ObjectView.tsx` — auditLog 상태 + 타임라인 섹션.
- `web/src/index.css` — `.phase-dot`/`@keyframes af-pulse`/`.audit-timeline` + reduce-motion 가드.

## 테스트 케이스 (Vitest)

ActionForm.test.tsx (추가 — 기존 5개 유지):
1. **destructive → 명시적 확인 + 영향 요약**: `cordonNode` submit → 즉시 submitAction **호출 안 함**,
   ConfirmDialog(영향 요약 sideEffects 텍스트) 노출. type-to-confirm 전엔 확인 버튼 disabled,
   대상 id 입력 후 enable → 확인 시 submitAction 호출.
2. **low-risk → 확인 없음**: `ack`(low) submit → ConfirmDialog 없이 즉시 진행(submitAction 직접 호출).
3. **pending pulse dot**: destructive 확인 직후 `provisional` 국면에 `.phase-dot` 렌더.
4. **failure 롤백 + toast**: conflict 응답 → `실패 · 롤백됨` 배지 + 에러 토스트(기존 케이스 강화, 회귀 확인).
5. **reduce-motion**: `.phase-dot` 이 `af-pulse` 애니메이션 클래스를 갖고(전역 reduce 규칙이 정지),
   DOM 에 존재(정적으로도 표시)한다.

ObjectView.test.tsx (추가 — 기존 유지):
6. **audit 타임라인 순서**: 두 Action 을 순차 실행 → `.audit-timeline` 이 **최근 순**으로 항목 렌더
   (2건, 최신이 위). verb 라벨·outcome 배지 존재.

기존 ActionForm(5)/ObjectView/Ontology/IMP-59 테스트 **전부 통과**해야 한다.

## 비목표 / 제약

- mutation 계약(submitAction/ActionResult/idempotency/revision 409)·capability 게이팅 **불변**.
- 신규 prod 의존성 0. Backend.AI 라이트 + 스틸블루 토큰만(네온 금지).
- prefers-reduced-motion 안전(pulse 정지). 색-only 금지(텍스트/배지 병기).
- audit 은 세션-로컬(mock 은 res.audit 을 그대로 소비) — 영속 저장/신규 endpoint 신설 안 함.

## 완료 기준

- 위 테스트 전부 통과 + `npm run test` 전량 green.
- `npm run build`(tsc) 통과.
- destructive Action(cordon/drain/scale/restart)에서 danger confirm + type-to-confirm 동작,
  low(ack/snooze)는 즉시. optimistic pulse·audit 타임라인 렌더. reduce-motion 정지.
