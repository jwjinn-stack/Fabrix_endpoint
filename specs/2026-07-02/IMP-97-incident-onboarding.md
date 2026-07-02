# IMP-97 — 인시던트 화면 '읽는 법' 온보딩 + 상태 용어 InfoTip

- Type: ux (sev=medium, effort=M)
- Branch: `feature/evolve-cycle7-incident-explain`
- Date: 2026-07-02

## 배경 / 문제

COP(`Investigate.tsx`)·`KineticStrip`·`ObjectView` 에 상태 배지(triggered/acked·NotReady·warn/crit·backpressure)가
색+라벨로만 존재하고 용어 설명이 없다. `Ontology.tsx` 에만 IMP-83 '읽는 법' 온보딩(progressive disclosure)과
IMP-4 InfoTip 패턴이 있고, 인시던트/원인 표면엔 없다. 시니어 아닌 온콜은 '이 화면을 어떻게 읽나' 와
'무엇이 먼저 무너졌나(타임라인)' 를 스스로 파악해야 한다.

## 방향 (Direction 6 — beginner-friendly, NO info-bomb)

세 인정 패턴 결합:
1. Progressive disclosure(NN/g 1995) — essentials 먼저, detail on demand → **default-collapsed '읽는 법' 패널**.
2. Tooltip-on-demand contextual glossary — 용어를 화면 clutter 없이 in-flow 자가설명(재사용 IMP-4 InfoTip).
3. Least-experienced on-call 가이드(incident.io) — 신호→추정원인→영향→조치 3단 인라인 마이크로 런북.

## 구현 (exactly)

### 1) 단일 glossary 소스 — `web/src/api/statusGlossary.ts` (신규, 순수·의존성 0)
- `STATUS_GLOSSARY: Record<string, GlossaryTerm>` — 상태 용어 단일 출처.
- 최소 항목: `triggered`(발생·미확인), `acked`(확인·배정됨), `notready`(파드 미기동), `backpressure`(유입>처리율),
  `warn`(주의 임계), `crit`(위험 임계), `blast`(영향 확산·blast-radius).
- 각 항목 = `{ term(표시 라벨), short(한 줄 정의), why?(왜 중요) }`.
- COP/KineticStrip/ObjectView 가 이 하나만 소비 → 3면 일관.

### 2) 상태 배지 InfoTip — `web/src/components/StatusInfoTip.tsx` (신규)
- `<StatusInfoTip termKey="triggered" />` — glossary 에서 항목을 꺼내 IMP-4 `InfoTip`(hover+focus+tap, Esc dismiss,
  aria-describedby, not hover-only) 로 렌더. 미지 key 는 렌더 안 함(방어).
- 배지 옆에 작은 `ⓘ` 트리거(persistent, 자동 발화 아님).

### 3) '이 화면 읽는 법' 온보딩 — `web/src/components/IncidentReadingGuide.tsx` (신규)
- IMP-83 disclosure 패턴 재사용하되 **per-user 1회 dismiss** 를 localStorage(`fabrix.incidentGuide.dismissed`)로 기억.
- 기본 상태: dismiss 안 한 사용자 = collapsed(펼치지 않음, 작은 persistent '?' 트리거만). 정보폭탄 금지 —
  auto-expand 없음. dismiss 한 복귀 사용자 = 트리거만 표시(패널 자체가 숨지 않고 '?' 는 남음, 필요 시 재확인 가능).
- 펼침 내용: 신호→추정원인→영향→조치 3-step + inline 마이크로 런북('가장 경험 적은 온콜' 기준 문장).
- 핵심 용어는 `StatusInfoTip`(단일 glossary)로 인라인 정의.
- localStorage 불가(프라이빗 모드) → try/catch 로 조용히 무시(savedViews.ts 관례).

### 4) first-anomaly '무엇이 먼저 무너졌나' 타임라인
- **이미 존재**: `EvidencePanel`(IMP-93)이 COP hop 카드(`dense`)와 ObjectView 에서 `EvidenceTimeline`(IMP-100)을
  first-anomaly 앵커로 렌더한다. IMP-97 은 **두 번째 타임라인을 만들지 않는다**.
- 규약: 읽는 법 패널(collapsed 헤더) 안에는 타임라인을 렌더하지 않는다 → health-at-a-glance 이후 drill-down
  층(hop/ObjectView)의 EvidencePanel 에만 존재(정보폭탄 방지).

### 배선
- COP(`Investigate.tsx`): page-head 아래 `<IncidentReadingGuide />`, HopCard 상태 Badge 옆 `<StatusInfoTip>`.
- `KineticStrip`: 영향 객체 상태 Badge 옆 + `확인·배정`(ack) rung 근처 `<StatusInfoTip>`.
- `ObjectView`: header 상태 Badge 옆 `<StatusInfoTip>`.

## 제약
mock-first, zero prod deps, Backend.AI 라이트+스틸블루 토큰, Korean 주석, no info-bomb(default-collapsed·1회
dismiss·persistent '?'), a11y(keyboard/Esc, not hover-only). IMP-83/4/100 재사용(중복 타임라인 금지).
IMP-88 isolation green 유지.

## 테스트 케이스 (`web/src/components/IncidentReadingGuide.test.tsx` + StatusInfoTip 커버)
1. 읽는 법 패널 default-collapsed — 초기 렌더 시 3-step 본문 미표시, '?' 트리거만 보임.
2. '?' 트리거 클릭 → 펼침(3-step 본문 표시), 다시 클릭 → 접힘.
3. dismiss → localStorage 플래그 기록, 재마운트(복귀 사용자) 시 auto-expand 안 함(여전히 collapsed).
4. 상태 배지 InfoTip 이 단일 glossary 에서 정의를 꺼낸다(triggered=발생·미확인, notready=파드 미기동, backpressure=유입>처리율).
5. InfoTip 접근성 — 키보드 focus 로 열림, Esc 로 닫힘(hover-only 아님).
6. glossary 단일 출처 — 같은 termKey 는 3면에서 동일 문구(statusGlossary import 1곳).
7. 타임라인 중복 없음 — 읽는 법 패널은 EvidenceTimeline 을 렌더하지 않는다(EvidencePanel/COP drill-down 에만).
8. 자동 coach mark 없음 — 마운트 시 자동 발화(auto-fire)하는 오버레이/모달 없음.
9. 회귀: 기존 Investigate/KineticStrip/ObjectView/isolation(IMP-88) 테스트 green.

## 보안 라이트체크
- UI 카피 + localStorage dismiss 플래그(boolean)만. dangerouslySetInnerHTML 없음, 외부 리소스 없음,
  glossary 는 정적 상수(사용자 입력 무관) → React 기본 escape. clean 예상.
