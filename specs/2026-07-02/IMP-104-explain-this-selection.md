# IMP-104 — explain-this-selection (콕 집어 물어보기, 키보드 우선)

- Type: ux (sev=high, effort=M)
- Branch: feature/evolve-cycle8-assist
- Date: 2026-07-02

## 배경 / 문제
지금은 statusGlossary 7개 상태 배지(IMP-97)만 InfoTip 으로 설명되고, 그 외 화면의 임의 용어·메트릭 라벨·위젯 영역은 "이게 뭔지" 콕 집어 물어볼 경로가 없다(60여 파일에 native `title=` 잔존 — 키보드/터치 미접근, WCAG 1.4.13 위반). 초심자가 대시보드에서 'TTFT'·'blast-radius'·특정 카드가 뭘 보여주는지 그 자리에서 물어볼 explain-this 경로가 부재 — 진입장벽의 핵심.

전역 AssistPanel(IMP-103)은 이미 있으나 "무엇이든 물어보기"를 **빈 상태**로만 연다. 특정 요소를 콕 집어 **프리필**해서 여는 seam 이 없다.

## 목표 (구현 범위)
1. **PRIMARY(키보드 우선)**: `data-explain-key` 속성을 배지/메트릭 라벨/위젯에 부착 → 해당 요소가 focusable(tabindex=0)이 되고 hover/focus 시 ⓘ 어포던스 노출. Enter / Space / context-menu 키 / 우클릭 / 롱프레스로 전역 AssistPanel(IMP-103)을 `{term, widget-context}` 프리필로 연다(**텍스트 선택 불필요**). 재사용 래퍼 `<ExplainThis explainKey=... />` + 훅 제공.
2. **SECONDARY(마우스 편의만)**: 텍스트 선택 시 floating 'ⓘ 설명' 버튼. **유일 경로 금지** — 키보드 경로가 항상 존재(선택 팝오버는 키보드 접근 함정).
3. **Resolution**: 등록 glossary term(IMP-108 lookupTerm) → 큐레이션 정의; 미등록 → rule-based 사전 폴백(buildAssistAnswer 의 정직 폴백 재사용) + 실모델 seam(IMP-110). **환각 금지**.
4. **Progressive disclosure**(Linear 'Why?' 식): 짧은 정의 먼저, 상세/관련어로 확장 — AssistPanel StreamingLog + glossary short→why 계약 재사용.
5. **a11y**: role, aria-describedby(트리거→설명 어포던스), aria-live=polite 결과영역(AssistPanel StreamingLog role=log/status 재사용), Esc dismiss, ≥4.5:1 대비, **NO focus theft**(WCAG 2.2 Consistent Help 3.2.6 — 어포던스는 자동 발화하지 않음, 사용자 조작으로만 연다). 읽기전용·mutation 금지.
6. native `title=` 은퇴 시작: 최고가치 상태/메트릭 라벨 첫 배치를 `data-explain-key` 로 전환(전 60파일 일괄 아님 — 어포던스 배선 + 의미 있는 첫 배치, 나머지는 follow-up).

## 설계

### 프리필 seam — assistBus (module-level pub/sub, 순수·의존성 0)
AssistPanel 은 Layout 의 셸-로컬 상태(IMP-103·IMP-88 격리)로 유지한다. 딥 컴포넌트가 prop-drilling/전역 provider 리렌더 없이 프리필 오픈을 트리거하도록 **module singleton 이벤트 버스**를 둔다:
- `web/src/components/assistBus.ts`: `openExplain(prefill)`, `subscribeExplain(cb)` — 순수 pub/sub. 구독자 없으면 no-op(격리: 버스만 있고 AssistPanel 미마운트여도 크래시 없음).
- `AssistPrefill = { explainKey?: string; label?: string; widgetId?: string }`.
- Layout 이 `subscribeExplain` 으로 구독 → `setAssistOpen(true)` + prefill state 저장 → AssistPanel 에 `prefill` prop 전달.

### AssistPanel prefill 소비
- 신규 optional prop `prefill?: AssistPrefill`.
- 열릴 때 prefill 이 있으면: (a) explainKey 로 glossary lookup → 있으면 term 정의 자동 ask, (b) 없으면 label 로 자유질문 ask(→ rule-based 폴백, 환각 금지), (c) widgetId 있으면 컨텍스트 배너에 위젯명 강조.
- prefill 자동 ask 는 **사용자 조작(Enter/우클릭/선택버튼 클릭)으로 연 결과**이므로 focus theft 아님(패널 자체가 dialog 로 포커스를 받음 — IMP-102 계약 유지).

### ExplainThis 래퍼 / useExplain 훅
- `web/src/components/ExplainThis.tsx`:
  - `useExplain({ explainKey, label, widgetId })` → focusable/키보드/우클릭/롱프레스 핸들러 묶음 + ⓘ 어포던스 표시 상태 반환.
  - `<ExplainThis explainKey label widgetId>children</ExplainThis>` → children 을 감싸 tabindex=0·role·aria-label·ⓘ affordance·Enter/Space/contextmenu/우클릭/롱프레스 → `openExplain`.
  - ⓘ 는 hover/focus 시 노출(자동 발화 아님 — Consistent Help). 클릭도 오픈.
- 롱프레스: touchstart 500ms 타이머 → openExplain(터치 편의). touchend/move 로 취소.

### 텍스트 선택 팝오버(SECONDARY)
- `web/src/components/ExplainSelectionPopover.tsx`: document `selectionchange`/`mouseup` 로 선택 텍스트 감지 → 선택 rect 근처에 floating 'ⓘ 설명' 버튼. 클릭 시 `openExplain({ label: selectedText })`.
- **마우스 편의 전용**: 키보드로는 절대 이 경로만 강요되지 않음(모든 data-explain-key 요소가 키보드 경로 보유). 버튼은 aria-label 부여, Esc/선택해제 시 사라짐.
- Layout 에 1회 마운트(전역).

### native title= 첫 배치 전환
- 최고가치 = StatusInfoTip 이 이미 쓰는 상태 용어 + 핵심 메트릭 라벨. StatusInfoTip 은 이미 InfoTip(접근가능) 이므로 회귀 대상 아님 — 그대로 둠.
- 첫 배치: `StatCard` 의 metric 라벨 중 widgetMeta relatedTerms 와 매핑되는 라벨에 ExplainThis 부착(대시보드 고트래픽). 그리고 Layout 헤더의 정보 성격 title= 일부를 유지(닫기/새로고침 등 조작 title= 는 은퇴 대상 아님 — 용어 설명 title= 만 대상).
- 나머지 ~55 파일은 follow-up(스펙에 명시). 점진 마이그레이션.

## 테스트 케이스 (Vitest/RTL)
1. data-explain-key 요소가 focusable(tabindex=0) 이고 ⓘ 어포던스를 가진다.
2. Enter 키 → openExplain 발화 → AssistPanel 이 prefill(term 정의)로 열린다.
3. 우클릭(contextmenu) → 동일하게 열린다(기본 컨텍스트메뉴 preventDefault).
4. 등록 glossary term(ttft) → 큐레이션 정의가 log 에 렌더(grounded).
5. 미등록 term → 정직 폴백("등록된 용어 정의를 찾지 못했습니다") — 환각 없음.
6. 선택 팝오버(secondary): 텍스트 선택 시 'ⓘ 설명' 버튼 등장, 클릭 시 프리필 오픈. 키보드 경로가 별도로 존재함을 확인(secondary 임).
7. progressive disclosure: 짧은 정의 먼저(term), why 가 이어짐.
8. a11y: Esc 로 패널 닫힘, aria-label 존재, 어포던스가 자동 발화하지 않음(마운트만으로 dialog 안 열림 — no focus theft).
9. 읽기 전용: openExplain 은 mutation 없음(패널은 읽기전용 문구).
10. 격리(IMP-88): assistBus 구독자 없이 openExplain 호출해도 throw 없음. 기존 AssistPanel/InfoTip/isolation 테스트 green.

## 보안 라이트체크
- 읽기 전용: openExplain/ExplainThis/팝오버 어디에도 mutation 없음.
- 환각 금지: 미등록 → buildAssistAnswer 정직 폴백(선언된 glossary/widgetMeta 값만).
- innerHTML 미사용: 모든 텍스트는 React 이스케이프 렌더. 선택 텍스트도 label 문자열로만 전달(HTML 보간 없음).
- injection: 선택/label 문자열을 프롬프트/정의에 보간하지 않음 — lookupTerm 완전일치만.

## Out of scope (follow-up)
- 나머지 ~55 파일 native title= → data-explain-key 전면 전환(점진).
- 실모델 자유질문 응답(IMP-110 seam).
