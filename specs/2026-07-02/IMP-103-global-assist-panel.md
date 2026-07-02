# IMP-103 — 전역 in-context Assist 진입점 (⌘/ '무엇이든 물어보기')

- **Type**: ux (sev=high, effort=M)
- **Branch**: feature/evolve-cycle8-assist
- **Date**: 2026-07-02

## 배경 / 문제

AI 어시스트가 `/AiAgent` 전용 라우트(IMP-60)에만 존재해, 다른 40+ 화면에서 모르는 용어·지금 상황을
물어보려면 컨텍스트를 버리고 페이지를 떠나야 한다. Layout 에는 ⌘K 팔레트 핸들러(IMP-75)만 있고
`?`/`⌘/` 어시스트 트리거가 없다. Grafana Assistant·Datadog Bits·Dynatrace Davis CoPilot 은 모두
화면을 떠나지 않는 전역 ask-anything 오버레이를 제공하는데, 진입장벽 낮추기의 핵심 표면이 통째로 빈다.

## 목표 (이 사이클에서 구현)

전역 어디서나 `⌘/`(primary) 또는 `?`(secondary)로 여는, 자동으로 **현재 화면 컨텍스트를 주입**하는
in-context Assist 패널. mock-first(honest mock/rule-based), 읽기 전용, lazy-import, IMP-102 a11y 계약 소비.

## 구현 상세

### 1. Layout 배선 (`web/src/components/Layout.tsx`)
- 헤더 스파클 트리거 버튼(⌘K 트리거 옆) — `aria-label`/`title` 에 단축키 노출("무엇이든 물어보기 (⌘/)").
- 전역 keydown = `useGlobalShortcutGuard`(IMP-102): `⌘/`(chord) primary, bare `?` secondary,
  input/textarea/contenteditable·IME(isComposing/229) 무시, ⌘K(IMP-75)와 충돌 없음(다른 키).
- 패널 상태 = shell-local `useState`(전역 리렌더 회피). `assistOpen` boolean.
- `AssistPanel` = `lazy(() => import("./AssistPanel"))` + `Suspense`(초기 번들 0). `assistOpen`일 때만 렌더.
- 현재 `page`(route)를 AssistPanel 에 prop 으로 전달 → 자동 화면-컨텍스트 주입 근거.

### 2. AssistPanel (`web/src/components/AssistPanel.tsx`, 신규 lazy)
- v1 = MODAL dialog. `useDialogA11y`(IMP-102): `role=dialog` + `aria-modal` + `aria-labelledby`,
  초기 포커스 입력창, Esc 닫기, 포커스 트랩, 닫을 때 트리거 복원.
- **자동 화면-컨텍스트 주입(킬러)**: 마운트 시 `getScreenContextResult({ route })`(IMP-106 seam) 로
  현재 route + 마운트 위젯 id·메타를 읽어 컨텍스트 배너에 표기(화면명 + 위젯 목록). 앱 전체 덤프 금지.
- **'이 화면 설명' 원클릭 프리셋** — 컨텍스트 배너 위 최상단 버튼. 클릭 시 화면 컨텍스트 기반
  rule-based 설명(위젯 whatItShows + relatedTerms glossary 인용)을 StreamingLog 에 흘린다.
- 자유 질문 입력 + 프리셋(용어 예: "TTFT란?"). 제출 시 rule-based 답변.
- **답변 생성(mock-first, 정직)**: 결정적 rule-based 경로 —
  (a) glossary `lookupTerm`(IMP-108) 완전일치 → 큐레이션 정의(short + why + 관련어).
  (b) '이 화면 설명' → getScreenContext 위젯 메타 요약.
  (c) 위 실패 → 정직한 폴백("등록된 용어를 찾지 못했습니다… 실 모델 미연결"). 환각 금지.
  → 답변은 `useStreamingLog`(begin→appendToken→commit) 로 흘려 `StreamingLog`(role=log 완료 append +
    role=status 진행)에 렌더. IMP-110 이 `streamAssist` 로 swap 할 수 있게 구조화.
- **ModelStatusChip**(IMP-82) 표기 — mock 이면 무채색 "mock 모델"·rule-based 로 정직 표기.
- 읽기 전용 — 패널에 mutation 경로 0(navigate/설명만).

### 3. 답변 헬퍼 (`web/src/api/assist.ts`, 신규 순수 seam)
- `buildAssistAnswer(query, ctx)` — 결정적 rule-based 답변 문자열 + kind(term/screen/fallback) 반환.
- `chunkAnswer(text)` — 스트리밍 토큰 청크(단어 단위). IMP-110 이 실 스트림으로 대체할 seam.
- `screenTitle(route)` — route → 사람이 읽는 화면명(NAV 라벨 정합, 단일 출처).
- 순수 함수 — 단위 테스트로 가드(no DOM, no model, no side effect).

## 격리 (IMP-88 green)
- AssistPanel 은 lazy + `assistOpen` 기본 false → 미오픈 시 미마운트. 파일 제거해도 Layout 은 렌더되고
  나머지 앱 동작(isolation.test 는 Layout 렌더·nav만 검증, AssistPanel 미참조). 트리거 버튼 제거 ≠ 앱 붕괴.

## 성능
- lazy import → 초기 eager 번들 0. 패널 상태 shell-local useState(전역 provider 리렌더 없음).

## 보안 (light-check)
- 읽기 전용 — 패널에서 mutation 유발 경로 없음(navigate/텍스트 렌더만).
- 화면 컨텍스트는 read-only(getScreenContextResult.readOnly=true), 사용자 입력을 프롬프트에 보간하지 않음
  (rule-based resolver 는 선언된 GLOSSARY/WIDGET_META 값만 반환 — prompt-injection 방어).
- 시크릿 없음. 답변은 전부 escape 텍스트(dangerouslySetInnerHTML 없음).
- 정직 라벨링 — ModelStatusChip mock 표기, 답변 폴백 시 "실 모델 미연결" 명시.

## 테스트 케이스
1. `⌘/` 로 패널이 열린다(input/textarea/IME 밖에서). input 포커스·IME 조합 중엔 안 열림.
2. 헤더 스파클 트리거 클릭 → 패널 열림.
3. 패널이 열리면 현재 route 화면-컨텍스트가 자동 주입(화면명 + 위젯 목록 표시).
4. '이 화면 설명' 프리셋 클릭 → 화면 기반 설명이 StreamingLog 에 렌더.
5. dialog a11y — role=dialog·aria-labelledby, 열 때 입력창 포커스, Esc 닫기, 닫을 때 트리거 복원(IMP-102).
6. 답변이 StreamingLog(role=log 완료 append) 로 렌더된다.
7. ModelStatusChip 이 정직한 "mock 모델" 표기(mock 모드).
8. glossary 용어 질문("TTFT란?") → 큐레이션 정의 답변. 미등록 → 정직 폴백(환각 금지).
9. lazy import — AssistPanel 이 정적 import 되지 않음(Layout 청크에 미포함).
10. 격리 — AssistPanel 없이도 앱 동작(Layout 렌더·isolation.test green).
11. 읽기 전용 — 패널에 mutation 경로 없음(순수 답변 seam 테스트).
12. `buildAssistAnswer` 순수 함수 — term/screen/fallback 결정적.

## Out of scope
- 실 스트리밍(IMP-110). non-modal complementary 승격(후속). explain-this-selection(IMP-104).
