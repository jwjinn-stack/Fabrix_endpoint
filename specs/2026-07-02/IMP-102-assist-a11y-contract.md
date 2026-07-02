# IMP-102 — 어시스트 접근성 계약 (dialog focus 복원·Esc·트랩 + 스트리밍 role=log 완료낭독/role=status 진행 + 단축키 input 가드)

- **Type**: ux (sev=high, effort=S)
- **Branch**: feature/evolve-cycle8-assist
- **Date**: 2026-07-02
- **의존**: IMP-103(전역 Assist 패널)의 기반 계약. 이 아이템은 **재사용 primitive(훅/컴포넌트)** 만 만들고, 실제 패널은 만들지 않는다.

## 문제 (Problem)
전역 오버레이 + 스트리밍 답변은 접근성 회귀의 단골이다.
- IMP-12/31 에서 손수 짠 다이얼로그의 포커스 트랩/복원이 이미 문제였다.
- 새 어시스트가 aria-live 에 **증분 토큰**을 흘리면 스크린리더가 매 변경마다 재낭독·가로채기 → 오히려 "답을 못 듣는" 회귀.
- `?`/`⌘/` 전역 단축키가 입력 필드 안에서 오발화하면 폼 타이핑을 깬다(WCAG 2.1.4).

## 해결 (Fix) — 정확히 이대로 구현

### 1. 오버레이 계약 — `useDialogA11y` 훅
APG Dialog 패턴. IMP-12/31 검증 자산(네이티브 `<dialog>.showModal()`)을 훅으로 추출하지 않고, **더 재사용성 높은 순수 훅**으로 제공한다(IMP-103 이 임의 컨테이너에 얹을 수 있게).
- `role="dialog"` + `aria-modal="true"` (호출부가 부여, 훅은 refs/handlers 제공)
- 열릴 때 **입력창(또는 지정 initial-focus 요소)** 으로 초기 포커스 이동
- **Esc** 로 닫기(`onClose` 호출)
- 닫힐 때 **트리거 요소로 포커스 복원**(열기 직전 `document.activeElement` 저장 → 닫힐 때 `.focus()`)
- **포커스 트랩은 열린 동안만**(Tab/Shift+Tab 순환, 컨테이너 밖으로 못 나감)
- `aria-labelledby` → 패널 제목(호출부가 titleId 연결)

시그니처:
```ts
useDialogA11y({ open, onClose, initialFocusRef?, restoreFocus? }): { dialogRef }
```
- `dialogRef` 를 오버레이 컨테이너에 붙이면 트랩/포커스/Esc 가 전부 걸린다.
- 네이티브 `<dialog>` 강제 아님 — 일반 `div[role=dialog]` 에도 동작(IMP-103 이 슬라이드 패널로 쓸 수 있게). IMP-12/31 의 `<dialog>` 컴포넌트는 그대로 유지(회귀 없음).

### 2. 스트리밍 낭독 — **핵심 정정** — `useStreamingLog` 훅 + `<StreamingLog>` 컴포넌트
증분 토큰을 aria-live 에 흘리지 **말 것**. 대신:
- (a) 답변 **리스트 컨테이너** = `role="log"` `aria-live="polite"` `aria-atomic="false"`
- (b) 진행 중 말풍선 = `aria-busy="true"` 이고 그 스트리밍 텍스트는 **라이브 낭독 대상에서 제외**(미커밋 버블은 `aria-hidden` 토글 / log 밖에 렌더)
- (c) 스트림 **완료 시** 완성된 메시지를 log 에 **확정 append** → 한 번에 온전히 낭독
- (d) 진행/에러/스로틀 = **별도 `role="status"`(polite)** 영역에 "응답 생성 중"/"완료"/"연결 오류" 짧게(무음 실패 금지)
- 스크롤 점프 방지: append 시 컨테이너가 사용자 위치를 강제로 끌지 않는다(하단 근처일 때만 following, 아니면 유지).

훅 상태 모델:
```ts
type Phase = "idle" | "streaming" | "done" | "error";
useStreamingLog(): {
  messages: LogMessage[];         // 확정된(완료) 메시지만 — log 에 렌더
  draft: string;                  // 진행 중 버퍼(aria-busy 버블, 낭독 제외)
  phase: Phase;
  statusText: string;             // role=status 문구(진행/완료/에러)
  begin(); appendToken(t); commit(); fail(msg?); reset();
}
```
`<StreamingLog>` 은 이 훅 출력(또는 props)로 role=log(확정 메시지) + aria-busy 드래프트 버블 + role=status 를 렌더하는 무의존 표현 컴포넌트.

### 3. 전역 단축키 가드 — `useGlobalShortcutGuard`
WCAG 2.1.4 Character Key Shortcuts.
- `activeElement` 가 `input`/`textarea`/`[contenteditable]` 이면 무시
- **IME 조합 중**(`e.isComposing` 또는 keyCode 229) 무시
- **수식키 chord(`⌘/` = meta/ctrl + `/`) 를 primary**, 단독 문자(`?`)는 secondary(가드 통과 시에만)
- 재매핑/비활성 가능(옵션) — `enabled` 플래그로 끄기 지원(WCAG 2.1.4 완전충족의 "끄기" 경로)

시그니처:
```ts
useGlobalShortcutGuard({ onTrigger, enabled?, allowBareChar? }): void
```

### 4. 타깃/대비
- 인터랙티브 타깃 ≥ 24×24px (WCAG 2.5.8) — 재사용 CSS 유틸 `.a11y-target-min`(min 24px) 제공, StreamingLog 액션·닫기 버튼에 적용.
- 텍스트/UI 대비 4.5:1 / 3:1 — 기존 `--text`/`--primary-strong`/`--border-strong` 토큰만 사용(Backend.AI 라이트 + 스틸블루, 신규 색 없음).

## 구현 범위 (Scope)
- 신규 `web/src/a11y/useDialogA11y.ts`
- 신규 `web/src/a11y/useStreamingLog.ts`
- 신규 `web/src/a11y/StreamingLog.tsx` (표현 컴포넌트)
- 신규 `web/src/a11y/useGlobalShortcutGuard.ts`
- 신규 `web/src/a11y/index.ts` (배럴)
- CSS: `web/src/index.css` 에 `.a11y-target-min`, `.streaming-log*` 최소 스타일(토큰만)
- **패널 자체는 만들지 않음**(IMP-103). 이 아이템 = 계약 + 재사용 조각 + 테스트 하네스.

## 격리(IMP-88) 준수
- 순수 훅/표현 컴포넌트 — 앱 라우팅/cap 과 무관. 제거해도 앱 동작(어디서도 아직 mount 안 함). IMP-88 스위트 불변.

## 테스트 케이스 (Vitest + RTL)
`web/src/a11y/a11y-contract.test.tsx`

**Dialog (useDialogA11y)**
1. open 시 initialFocusRef(입력창)로 **초기 포커스** 이동.
2. Esc 누르면 `onClose` 호출.
3. **트랩** — 열린 동안 Tab 이 컨테이너 밖으로 못 나가고 마지막→처음 순환(Shift+Tab 반대).
4. 닫힐 때 **트리거로 포커스 복원**(열기 전 focus 였던 버튼으로 돌아옴).

**Streaming (useStreamingLog / StreamingLog)**
5. `role="log"` `aria-live="polite"` `aria-atomic="false"` 컨테이너 존재.
6. 스트리밍 중 draft 버블은 `aria-busy="true"` 이고 **log 의 확정 메시지에는 포함되지 않는다**(증분 낭독 아님).
7. `commit()` 후 완성 메시지가 log 에 **1개 append**(완료 낭독) — 토큰 증분이 개별 노드로 쌓이지 않음.
8. `role="status"` 진행 문구: streaming→"응답 생성 중", done→"완료", error→"연결 오류"(무음 실패 없음).
9. 스크롤 점프 방지: 사용자가 위로 스크롤한 상태면 append 가 scrollTop 을 강제 이동시키지 않는다(하단 근처일 때만 following). — jsdom 한계상 로직 단위(shouldFollow)로 검증.

**Shortcut guard (useGlobalShortcutGuard)**
10. `⌘/`(meta+/) → onTrigger 호출(chord primary).
11. activeElement 가 input/textarea/contenteditable → **무시**.
12. IME 조합 중(isComposing) → 무시.
13. `enabled:false` → 무시(끄기 경로).
14. bare `?` 는 allowBareChar 일 때만, 그리고 입력 밖에서만 발화.

**격리 회귀**
15. 기존 IMP-88 isolation + dialog 계열 테스트 그대로 green.

## 게이트
- `cd web && npm run test` + `npm run build` 모두 통과.
- IMPROVEMENTS.md IMP-102 Status → done(이 브랜치).

## 출처
- APG Dialog(Modal): https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- WCAG 2.1.4 Character Key Shortcuts: https://www.w3.org/TR/WCAG22/#character-key-shortcuts
- WCAG 2.5.8 Target Size(Minimum): https://www.w3.org/TR/WCAG22/#target-size-minimum
- Sara Soueidan — accessible aria-live regions
- WebAIM keyboard
