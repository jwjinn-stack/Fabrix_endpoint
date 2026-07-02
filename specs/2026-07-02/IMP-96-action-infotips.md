# IMP-96 — 액션 인라인 설명 InfoTip (무엇을·언제·상태전이·부수효과·되돌리기; WCAG 1.4.13)

- **Type**: ux (sev=medium, effort=M)
- **Branch**: feature/evolve-cycle7-incident-explain
- **Date**: 2026-07-02

## 문제 (Problem)
인시던트/워크로드 액션(처리중/해소/스누즈/restart/scale/cordon/drain)은 버튼으로만 노출되고,
그 액션이 **무엇을** 하는지·**언제** 써야 하는지·**되돌릴 수 있는지**를 버튼 앞에서 알 수 없다.
- `registry.ts`의 `ActionSpec`은 `rulesNote`(상태 전이)·`sideEffects`·`severity`만 갖고 `reversibility`/`whenToUse`가 없다.
- 이 정보는 오직 `ActionForm`의 **destructive 확인 다이얼로그**(~175행)에서만 드러난다.
- `KineticStrip` 조치 사다리 버튼·`ObjectView` 액션·이웃 버튼은 native `title=`만 갖는다
  → WCAG 1.4.13(Content on Hover or Focus) 결함: 키보드/터치 트리거 불가, dismissible/hoverable/persistent 아님.

## 목표 (Fix — 정확히 이대로 구현)
1. **선언적 필드를 ActionSpec에 추가**(rulesNote+sideEffects 곁, 단일 출처):
   - `whenToUse: string` — 언제 쓰는가(사람용).
   - `reversible: { value: 'yes' | 'no' | 'partial'; how?: string }` — 되돌리기 가능 여부·방법.
   - ActionForm + KineticStrip 사다리 + ObjectView 3면이 **한 소스**에서 읽는다.
2. **native `title=` → 접근 가능한 InfoTip 교체**(IMP-4 패턴):
   focus+hover 트리거 · Esc dismiss · hoverable(버블 위로 마우스 이동 가능) · persistent(자동 소멸 없음).
   WCAG 1.4.13 + 키보드 2.1.1.
3. **consequence-tier(과설명 회피)**:
   - consequential 동사(drain/cordon/restartModel/scaleReplicas/drainGpu) → **풀 사다리**
     (무엇 · 언제 · 상태 전이 · 부수효과 · 되돌리기).
   - lifecycle 동사(ack/resolve/snooze) → **전이 부제만**(예: triggered→acked).
   - tier 판정은 registry의 `severity`(destructive=consequential, low=lifecycle)로 결정 — 새 축 발명 없음.
4. **되돌리기+저 blast-radius → Undo affordance 우선**(NNG). heavy destructive confirm은
   irreversible/고 blast-radius에만 유지하되 **같은 registry 카피 재사용**(단일 출처, trust boundary 불변).
   - 본 구현에서 현 consequential 동사는 전부 `reversible.value !== 'yes'`(no/partial) → destructive confirm 유지가 맞다.
     Undo affordance는 registry의 `reversible`을 InfoTip/칩에 노출하는 것으로 충족(향후 yes+low-blast 동사가 추가되면
     그 동사만 confirm 대신 Undo로 흐르도록 severity=low로 선언하면 됨 — 계약은 이미 준비됨).
5. **reversible/irreversible 칩**을 버튼 인접에 redundant 시각 신호로 노출.

## 설계 (Design)
### 단일 출처 (registry.ts)
```ts
export type Reversibility = { value: "yes" | "no" | "partial"; how?: string };
export interface ActionSpec {
  ...
  whenToUse: string;      // 언제 쓰는가(사람용 가이드)
  reversible: Reversibility; // 되돌리기 가능 여부 + 방법(how)
}
export function actionTier(spec): "consequential" | "lifecycle"; // severity 기반
export function reversibilityLabel(r): { chip, tone };           // 칩 라벨/톤 단일 출처
```
동사별 값:
- restartModel: when="서빙 이상/설정 반영 후 파드를 롤링 재기동해 정상 수렴시킬 때", reversible=partial(자동 롤링, 순간 중단은 불가역)
- scaleReplicas: when="트래픽/큐 적체로 용량을 늘리거나 비용 절감으로 줄일 때", reversible=yes(다시 조정)
- cordonNode: when="노드 점검/이상으로 새 스케줄을 막을 때", reversible=yes(uncordon)
- drainGpu: when="GPU 하드웨어 이상/점검으로 워크로드를 안전 이전할 때", reversible=partial(재배치 필요)
- ack: when="담당자가 인지·조사 착수를 알릴 때", reversible=yes(status 불변)
- resolve: when="근본 원인이 해소되어 인시던트를 종료할 때", reversible=partial(재발 시 재오픈)
- snooze: when="야간/유지보수로 일시적으로 알림을 묵음할 때", reversible=yes(만료/해제)

### InfoTip 강화 (hover+focus, hoverable, persistent, Esc)
현 InfoTip은 click 전용 toggletip. WCAG 1.4.13 준수 위해:
- trigger에 `onMouseEnter/onFocus`(open) + `onMouseLeave/onBlur`(close) 추가(hover+focus).
- 버블에도 mouseenter/leave 배선 → **hoverable**(버블 위로 이동 시 유지).
- Esc·바깥 클릭 close 유지(기존). click 토글도 유지(터치·기존 테스트 호환).
- `role="status"` live 영역 유지(스크린리더 announce). persistent(타이머 자동소멸 없음).
- 기존 click 3케이스 테스트 회귀 없음.

### ActionInfoTip 컴포넌트 (신규, 3면 공용)
`ActionInfoTip({ spec })` — registry spec을 받아 tier에 맞게 렌더:
- consequential → 풀 정의 리스트(무엇=label/rulesNote, 언제=whenToUse, 상태전이=rulesNote, 부수효과=sideEffects, 되돌리기=reversible).
- lifecycle → 전이 부제 한 줄(rulesNote) + 언제(whenToUse).
InfoTip으로 감싼다(접근성). + 인접 ReversibleChip.

### 3면 배선
- **ActionForm**: head(spec.label 옆)에 ActionInfoTip + ReversibleChip. destructive 확인 카피는 그대로(같은 출처).
- **KineticStrip**: 실행 rung(슬롯4) 버튼 옆 ActionInfoTip + ReversibleChip(native title 제거).
- **ObjectView**: Actions 섹션 — ActionForm이 이미 InfoTip을 렌더하므로 폼별로 자동 노출. 이웃 버튼 title은 범위 밖(액션 아님) — 유지.

## 테스트 케이스 (Vitest)
1. **registry**: 모든 verb가 `whenToUse`(비어있지 않음) + `reversible.value ∈ {yes,no,partial}`를 갖는다.
2. **actionTier**: destructive=consequential, low=lifecycle.
3. **InfoTip 접근성**: focus로 열림(포커스 트리거) / hover로 열림 / Esc로 닫힘 / role=status. native title 아님.
4. **ActionInfoTip consequence-tier**: consequential은 '언제·되돌리기'까지 노출, lifecycle은 전이 부제만(되돌리기 세부 없음).
5. **ReversibleChip**: reversible=yes→"되돌리기 가능", no→"되돌릴 수 없음", partial→"부분 가역".
6. **3면 단일 출처**: ActionForm·KineticStrip 실행 rung·(ObjectView 경유) 모두 같은 registry whenToUse 문구를 렌더.
7. **회귀**: 기존 ActionForm(destructive confirm/low 즉시)·KineticStrip(사다리/게이팅/폴링)·ObjectView·isolation(IMP-88) 그린.

## a11y / 제약
- WCAG 1.4.13(hover/focus 콘텐츠: dismissible=Esc, hoverable, persistent) + 2.1.1(키보드 트리거).
- 색-only 금지 — 칩은 텍스트+톤 병기.
- mock-first, zero prod deps, Backend.AI 라이트+스틸블루 토큰, 한글 주석.
- destructive-confirm trust boundary 불변(같은 카피 재사용).
- IMP-88 isolation 그린 유지. 다른 백로그 항목 미변경.
