# IMP-95 — 온-객체 AI 원인 설명 (인시던트 open 시 '무엇이/왜/영향/다음 조치' 자동 생성)

- Type: compete (sev=high, effort=L)
- Branch: `feature/evolve-cycle7-incident-explain`
- Date: 2026-07-02

## 배경 / 문제
현재 AI 원인 설명은 사용자가 AI Agent 화면에서 직접 질문해야 나온다. Datadog Bits AI SRE·Grafana
Assistant·Dynatrace Davis 는 인시던트를 열면 별도 질문 없이 '무엇이·왜·영향·다음 조치'를 근거 인용과
함께 즉시 요약한다. 재료(K8s tool·온톨로지·detection·IMP-99 seam)는 다 있는데 자동 요약 진입점이 없다.

## 목표 (backlog refinements 그대로)
1. ObjectView/KineticStrip 에 '원인 설명' 진입점 + (OPT-IN) 자동 요약. 결정적 K8s/온톨로지 근거로
   `get_incident_context`(=IMP-99 seam `buildIncidentEvidence`)를 소비해 구조화 서술 생성.
2. 출력 = 4 고정 섹션: **무엇이 / 왜(root-cause) / 영향 / 다음 조치**.
3. INTERACTIVE 인용 — 모든 주장이 소스(K8s event / objectId / KineticAlert)로 링크, 클릭 → navigate/highlight.
   HARD rule: **인용 없는 단정 금지**(uncited claim 은 드롭), mock 은 'mock' 스탬프.
4. PROGRESSIVE/staged 렌더(hypothesis → evidence → conclusion) — 단일 blocking spinner 지양.
5. auto-generate 는 **OPT-IN**(기본 explicit-click) — 매 mount 비용/지연·로컬모델 의존 non-blocking.
6. Dynamo :8000 미연결(mock) 시 룰기반 템플릿 폴백은 **'rule-based (no model)' 구별 badge** 필수
   (IMP-82 ModelStatusChip state 재사용).
7. **ZERO auto-mutation** — 추천은 제안만, ActionForm confirm 유지.

## 설계

### seam (순수·결정적·의존성 0) — `web/src/api/causeNarrative.ts`
- `buildCauseNarrative(evidence: IncidentEvidence, opts: { mock: boolean })`:
  - 입력은 **오직 IMP-99 seam 결과**(`get_incident_context` 가 반환하는 것과 동일 shape). 새 파생 규칙 발명 금지.
  - 출력 `CauseNarrative`:
    - `sections`: 4 고정 `{ key: 'what'|'why'|'impact'|'next', title, claims: NarrativeClaim[] }`.
    - `NarrativeClaim { id, text, citations: {ref, objectId|null}[] }`.
    - **HARD grounding**: citation 이 하나도 없는 claim 은 `buildCauseNarrative` 가 **드롭**한다
      (화면에 안 샌다). empty(근거 0) evidence → 각 섹션 claim 0 + `empty=true`.
    - `mode`: `'model'`(실 Dynamo 연결) | `'rule-based'`(mock/미연결). mock 이면 항상 `'rule-based'`.
    - `source`: `'AI 원인 설명 (mock · rule-based)'` 등 정직 표기.
  - 결정적: 동일 evidence+mock → 동일 결과(Date.now 미의존 — when 은 seam 값 그대로).
- 근거 소스: `무엇이`=evidence.lines(signal.what) / `왜`=rootCauseSummary + 상위 probableCause /
  `영향`=lines impact / `다음 조치`=상위 신호 계열별 정적 runbook 문구(제안만, verb 실행 아님).
  모든 claim 은 해당 EvidenceLine 의 `sourceRefs`(objectId/podRef)를 인용으로 계승 → 인용 강제.

### UI — `web/src/components/CausePanel.tsx`
- props: `objectId, objects, links, onCite?`.
- **OPT-IN**: 기본은 '원인 설명 생성' 버튼만(자동 생성 안 함 — per-mount 비용/모델 의존 회피).
  - 별도 체크박스 '열면 자동 생성'(세션 로컬, 기본 OFF) — 켜면 mount 시 자동 트리거(비침습).
- **staged 렌더**: 생성 클릭 → stage 진행(`hypothesis` → `evidence` → `conclusion`), 각 단계 표시.
  단일 blocking spinner 아님 — 이미 도착한 섹션은 즉시 렌더, 다음 단계는 뒤이어.
- 4 섹션을 순서대로 렌더. claim 마다 인용 pill — objectId 형태 + onCite 있으면 클릭 버튼(navigate),
  아니면 텍스트(escape). EvidenceTimeline 의 인용 규약(objectIdFromRef)과 동형.
- **폴백 badge**: `mode==='rule-based'` 이면 무채색 'rule-based (no model)' badge(ModelStatusChip 의
  mock state 와 동일 정직 톤). `'model'` 이면 표기 없음(실 연결 칩은 헤더의 ModelStatusChip 담당).
- empty → seam 의 emptyReason 표시(지어내지 않음).
- **ZERO mutation**: 이 패널엔 어떤 mutation 경로도 없다. '다음 조치' 는 서술(제안)일 뿐 —
  실제 실행은 ObjectView 의 기존 Actions 섹션(ActionForm confirm)으로만.

### 배선
- ObjectView: Evidence 패널 아래(또는 위)에 `<CausePanel>` 추가, `onCite` → 기존 traverse 재사용.
- KineticStrip: 카드에 '원인 설명' rung/버튼은 추가하지 않고(범위 최소), ObjectView 를 PRIMARY 진입점으로.
  (KineticStrip 는 이미 조사/ack rung 이 있음 — 원인설명 표면 중복 회피. backlog '진입점' 요구는 ObjectView 로 충족.)

## 테스트 (`web/src/api/causeNarrative.test.ts`, `web/src/components/CausePanel.test.tsx`)
- seam: 4 섹션(what/why/impact/next) 고정 반환.
- seam: 인용 없는 claim 드롭(uncited → 미포함). empty evidence → empty=true + claim 0.
- seam: mock=true → mode='rule-based', source 에 'mock'/'rule-based'. 결정적(동일 입력 동일 출력).
- 컴포넌트: OPT-IN 기본 — 초기 렌더 시 4 섹션 미표시(생성 버튼만).
- 컴포넌트: 생성 클릭 → 4 섹션 렌더, staged(단일 spinner 아님 — role=status stage 진행).
- 컴포넌트: 인용 클릭 → onCite(objectId) 호출(navigate).
- 컴포넌트: mock → 'rule-based (no model)' 폴백 badge 표시.
- 컴포넌트: mutation 없음 — 패널에 confirm/submit 버튼 없음(제안만).
- 기존 agent/ObjectView/EvidencePanel/isolation(IMP-88) 테스트 green.

## 보안 / grounding
- HARD grounding — 인용 없는 서술은 seam 단계에서 드롭(화면 노출 불가).
- read-only — 패널에 mutation 경로 0. 변경은 ActionForm confirm 만.
- 정직 — mock/rule-based 를 badge 로 명시. dangerouslySetInnerHTML 없음, 외부 리소스 없음, 시크릿 없음.

## Out of scope
- 실 Dynamo 스트리밍(transport 는 VITE_MOCK=off 스왑 대비만). KineticStrip 원인설명 rung. MCP prompt 템플릿.
