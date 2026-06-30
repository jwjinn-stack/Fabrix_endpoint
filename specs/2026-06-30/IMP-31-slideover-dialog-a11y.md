# 기능: 슬라이드오버 상세 패널 네이티브 `<dialog>` 기반 포커스 트랩·복원·Escape (IMP-31)

## 목적
IMP-12 가 8개 중앙 모달을 네이티브 `<dialog>.showModal()` 프리미티브(`Modal.tsx`)로 이전했으나,
우측 슬라이드 표면(`SlidePanel`·그 위에 빌드된 `InspectDrawer`·`Notifications`)은 범위 밖이었다.

현 결함:
- `SlidePanel`: `div role=dialog` + 수동 Escape·초기 focus 만. **포커스 트랩 없음 · 배경 inert 없음 · 닫힘 시 트리거 복원 없음.** 11개 페이지가 이 표면을 드릴다운에 공유.
- `InspectDrawer`: `SlidePanel` 상속 — 같은 결함.
- `Notifications`: `role=dialog aria-modal="true"` 선언만. 포커스 진입·트랩·Escape·복원 전무 → 키보드/SR 사용자에게 사실상 죽은 표면.

손수 포커스 트랩을 짜지 않고, IMP-12 의 `Modal.tsx` 와 **동일한 네이티브 `<dialog>` 메커니즘**을 우측-슬라이드 변형으로 재사용한다.
`showModal()` 한 번으로 11개 페이지가 포커스 트랩·배경 inert·Escape(cancel)·top-layer 승격·열 때 포커스 진입·닫을 때 트리거로 포커스 복원을 무료 획득한다.

## 요구사항
1. **SlidePanel → `<dialog className="slide-panel">` + `showModal()`** 로 전환.
   - `Modal.tsx` 의 useEffect 패턴 그대로: open 동기화(`!dlg.open` 일 때만 `showModal()`), body overflow 잠금(StrictMode 재마운트 보장), `cancel` 이벤트 → `onClose`(Escape).
   - 수동 `panelRef.current?.focus()` 제거(showModal 이 포커스 진입·복원 담당).
   - 외곽 `.slide-overlay` div 제거 — 배경 어둡힘은 `dialog.slide-panel::backdrop`, 슬라이드인은 `dialog.slide-panel[open]` transform/transition.
   - 백드롭(`::backdrop`) 클릭 닫기는 `onClick` 에서 `e.target === ref.current` 일 때만(Modal 과 동일).
   - 기존 props(`open`·`title`·`subtitle`·`onClose`·`children`·`footer`·`width`)·`DetailRow` export 완전 보존 → 11개 호출처 무변경.
   - aria: 제목 있으면 `aria-labelledby`(useId), 없으면 기존 `aria-label` 폴백 유지.
2. **InspectDrawer**: 변경 불필요(SlidePanel 상속). 회귀만 확인.
3. **Notifications**: 비-모달 `<dialog>` + `show()` 로 전환.
   - **모달 vs 비-모달 판단/근거**: 알림 피드는 상단 🔔 토글로 여는 *보조* 패널이고 페이지 작업을 막을 필요가 없다(닫지 않고 대시보드를 계속 봐도 됨). WAI-ARIA/CSS-Tricks 지침상 보조 패널은 비-모달이 적합 → `show()`(top-layer 승격·시맨틱은 얻되 배경 inert·포커스 트랩 없음).
   - 비-모달은 `cancel`/Escape 가 자동 발생하지 않으므로 Escape→onClose 를 수동 키 핸들러로 보강, 열릴 때 패널/닫기 버튼으로 포커스 진입, 닫힐 때 트리거 복원은 호출처(Layout 의 🔔 토글)가 유지.
   - `aria-label="알림"` 유지. `aria-modal` 제거(비-모달이므로 부정확).
   - 기존 `drawer-scrim` 어둡힘 div 제거(비-모달은 배경 가리지 않음 — 의도적).

## 함수 시그니처
```ts
// SlidePanel.tsx (변경 없음 — 외형 API 보존, 내부만 dialog 로)
export default function SlidePanel(props: {
  open: boolean; title: ReactNode; subtitle?: ReactNode;
  onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}): JSX.Element | null;
export function DetailRow(props: { label: string; children: ReactNode }): JSX.Element;

// Notifications.tsx (변경 없음)
export default function NotificationsDrawer(props: { open: boolean; onClose: () => void }): JSX.Element | null;
```

## 테스트 케이스
- **open-focus-enters**: `open` 시 `dialog.showModal()` 호출되고 다이얼로그가 열린다(focus 진입).
- **Escape-closes**: `cancel` 이벤트(Escape) → `onClose` 호출.
- **close-restores-trigger-focus**: 트리거 버튼 클릭으로 연 뒤 닫으면 포커스가 트리거로 복원(showModal 네이티브 동작; jsdom 폴리필 하 검증 가능 범위 내).
- **backdrop**: 다이얼로그 자체(`::backdrop` 영역) 클릭 → `onClose`, 내부 콘텐츠 클릭 → 닫히지 않음.
- **aria-wiring**: 제목 있을 때 `aria-labelledby` 가 제목 노드 id 와 연결.
- **non-modal-notifications**: Notifications 가 `show()`(비-모달)로 열리고 Escape 키로 `onClose` 호출.

## 출력 위치
- `web/src/components/SlidePanel.tsx` (구현)
- `web/src/components/Notifications.tsx` (구현)
- `web/src/index.css` (`.slide-*` → `dialog.slide-panel[open]`+`::backdrop`, overlay/scrim 제거)
- `web/src/test/setup.ts` (jsdom `HTMLDialogElement.showModal/show/close` 폴리필)
- `web/src/components/SlidePanel.test.tsx`, `web/src/components/Notifications.test.tsx` (테스트)

## 의존성
none (ZERO new runtime deps — 네이티브 `<dialog>` 만 사용)
