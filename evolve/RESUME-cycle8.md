# /evolve cycle8 — 재개 상태 (전역 AI 어시스트)

브랜치: `feature/evolve-cycle8-assist` (origin에 push됨, base=main @ 9d33ac6)
목표: 전역 컨텍스트 AI 어시스트 — 모든 화면에서 용어·영역·"지금 상황"을 물어보면 로컬 모델이 MCP로
컨텍스트를 받아 실시간 설명(진입장벽↓). read-only 어시스트, mock-first, 실모델은 seam.
★워크플로: 백로그·specs 를 이 feature 브랜치에 유지, 사이클 끝에 **PR 한 번**(main 중간 커밋 금지 — 승인 병목 제거).

## 완료 (커밋됨, 6/9)
- dbc342c — 백로그 10건(IMP-102~111) + IMP-111 LLM 게이트웨이 spike 문서
- 9bb2d08 — **IMP-108** glossary-as-data (web/src/api/glossary.ts, 29용어·category/aliases/relatedKeys·lookupTerm; statusGlossary는 7개 서브셋 re-export)
- 0aef25b — **IMP-105** widgetMeta + getScreenContext/describeWidget + thresholdCatalog.ts(IMP-7 단일출처); Dashboard 4 KPI에 data-widget-id
- 1b2597c — **IMP-106** MCP context seam: glossary://{term}·widget://{id} RESOURCE + get_screen_context TOOL(단일 아티팩트 파생, drift 캐너리 green, read-only)
- dae519e — **IMP-102** a11y 계약 (web/src/a11y/: useDialogA11y·useStreamingLog+StreamingLog[role=log 완료낭독+role=status]·useGlobalShortcutGuard[⌘/ chord·input/IME 가드])
- ab0524f — **IMP-103** 전역 AssistPanel (헤더 "✦ 물어보기 ⌘/"+⌘/ 단축키→모달, 자동 화면-컨텍스트 배너·"이 화면 설명" 프리셋·ModelStatusChip "mock 모델"·StreamingLog·lazy chunk·read-only)
- a010c2d — **IMP-104** explain-this-selection (`<ExplainThis>`+useExplain+assistBus, Dashboard KPI 라벨 data-explain-key ⓘ→AssistPanel 프리필, 텍스트선택 보조버튼, native title 1차 4개 은퇴)

현재 935/935 테스트 green, 빌드 green, IMP-88 격리 스위트 green.

## 남은 빌드 (순서, 3건 + spike)
7. **IMP-107** 다음 액션 제안 카드 (compete) — AssistPanel 답변에 근거 첨부 read-only 딥링크 원클릭 카드 + mutating은 ActionForm confirm+capability 게이팅(ZERO auto-mutation·observe read-only). IMP-95/99 evidence rationale·IMP-59 ActionForm·NavParams 재사용. **← 여기부터 재개** (직전 stop, WIP 없음, 처음부터 다시 spawn).
8. **IMP-110** 실모델 스트리밍(TTFT)+경량 히스토리 (ux, L) — IMP-82 modelConnection 재사용, streamAssist(SSE/ReadableStream·AbortSignal), mock 시 'rule-based (no model)' 정직 표기, IMP-102 StreamingLog 낭독 계약. AssistPanel의 chunkAnswer를 streamAssist로 스왑(UI/a11y 계약 유지).
9. **IMP-109** Assist 패널 시각 완성 (aesthetic) — 스트리밍 caret·인용 chip(EvidenceTimeline 재사용)·메시지 밀도 Linear/Vercel/Datadog Bits 수준, motion-reduce, 토큰 수렴. 시각 QA 대상.
- **IMP-111** = spike-needed (LiteLLM 게이트웨이, evolve/plans/IMP-111-llm-gateway-spike.md) — 빌드 안 함.

## 남은 파이프라인
- 3b 시각 QA(앱 부팅 + assist 표면 브라우저 검증) + 기술 정직성 감사(mock/rule-based 표기) + 기능격리(어시스트 빼도 앱 동작·IMP-88 green)
- 4 self-review + **PR 한 번**(백로그·specs 포함) — merge는 사람
- 5 미리보기 기동 + 관람 가이드

## 재개 방법 (다음 세션)
"cycle8 이어서" → 이 브랜치 checkout 확인 후 IMP-107부터 서브에이전트로 순차 빌드 → 3b QA → PR.
각 서브에이전트는 빌드 커밋에서 IMPROVEMENTS.md 상태를 done으로 flip(별도 accepted 커밋 생략).
