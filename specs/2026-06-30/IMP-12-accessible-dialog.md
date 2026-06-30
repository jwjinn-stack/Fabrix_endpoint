# 기능: 접근 가능한 Dialog 프리미티브 + 8개 모달 이전

## 목적
손수 만든 `.modal-overlay` 모달 8곳이 role=dialog/aria-modal·포커스 트랩/복원·Escape·배경 스크롤 잠금을 누락(WCAG 2.4.3/4.1.2 위험). 특히 키 발급 모달은 1회성 비밀 노출. 네이티브 `<dialog>.showModal()` 기반 단일 프리미티브로 일괄 해소.

## 요구사항
- `web/src/components/Modal.tsx`(무의존): `showModal()`로 aria-modal(암묵)·배경 inert·Escape·top-layer·포커스 진입/복원 확보. 수동 보강: `aria-labelledby`(헤더 id), body 스크롤 잠금(StrictMode 재마운트 안전), 백드롭 클릭 닫기(타겟==dialog), cancel→onClose.
- props `{ open, onClose, title, children, className? }`. 닫힘 시 언마운트(기존 폼리셋 시맨틱 유지). `modal-wide` 변형.
- CSS: `dialog.modal`(border 제거·중앙), `::backdrop` 오버레이, `.modal-wide`.
- 8개 `.modal-overlay` → `<Modal>`: Settings(사용자추가), Keys(키발급), ModelImport, Endpoints(위저드/키추가/로그), Playground(비교/코드).

## 테스트 케이스
- visual(browse): 모달 open=true, aria-labelledby, 포커스 진입, Escape 닫힘, body overflow=hidden.
- regression: tsc·lint·test·build green, modal-overlay 잔존 0(ConfirmDialog 제외).

## 출력 위치
- `web/src/components/Modal.tsx`(신규), `web/src/index.css`, 5개 페이지(8 모달).

## 의존성
- 없음(네이티브 dialog).
