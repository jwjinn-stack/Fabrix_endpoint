# IMP-93 — 객체·인시던트 상시 근거(Evidence) 패널 (채팅 없이 접지)

- Type: ux (sev=high, effort=M)
- Branch: feature/evolve-cycle7-incident-explain
- Date: 2026-07-02
- Depends on: IMP-99(`buildIncidentEvidence` seam), IMP-94(backpressure 신호), IMP-88(isolation)

## 문제 (Problem)
NotReady/CrashLoopBackOff/OOMKilled/FailedScheduling/backpressure 를 담은 근거는
현재 오직 AI Agent 채팅 ReAct 루프에서만 조회된다. ObjectView 는 props 를 raw key/value
DetailRow 로 나열할 뿐 "왜 이 Model 이 NotReady 인지"를 서술하지 않고, COP hop 카드는
골든시그널만 보여 시니어가 아니면 원인을 못 읽는다. 초심자는 채팅을 열어야만 원인에 도달한다.

## 목표 (Goal)
시니어가 아닌 온콜이 **채팅 없이** 객체/인시던트를 열자마자 "무엇(신호) → 왜(추정원인) →
영향" 을 바로 읽는다. 결정적 AI 채팅은 보조(secondary) 진입점으로 강등하고, 이 패널이
원인 도달의 **PRIMARY** 경로가 된다.

## 설계 (Design)

### 단일 소스 소비 (IMP-99 seam)
- 새 파생 규칙/데이터 모델을 만들지 않는다. `buildIncidentEvidence(objectId, snapshot)`
  (web/src/api/incidentEvidence.ts) 하나만 소비한다.
- 스냅샷 조립: `{ objects, links, k8s: buildK8sSnapshot(objects, links) }`.
  - K8s 상관은 objectId 로 결정적이며(링크 traverse 불요) mock-first 데이터 계약을 그대로 쓴다.
- 신규 컴포넌트 `web/src/components/EvidencePanel.tsx` 하나를 ObjectView 와 COP hop 이 공유
  (규약이 화면마다 갈라지지 않게 — 단일 표면).

### EvidencePanel props
```
{ objectId: string; objects: OntologyObject[]; links: OntologyLink[];
  onCite?: (ref: string) => void; // 인용 클릭 → 참조 객체로 navigate/highlight
  dense?: boolean;                 // COP hop 카드용 조밀 변형(옵션)
}
```

### 렌더 (신호→추정원인→영향)
- seam 결과 `lines[]` 를 순서대로: `signal.what` (+ `signal.when`, `signal.sourceRef`)
  → `probableCause` → `impact`. 예: "ImagePullBackOff ×5 (2분 전, pod/x) → 이미지 pull 실패
  → Endpoint NotReady".
- 헤더: `rootCauseSummary` + confidence 배지(high/med). confidence 는 seam 규약 그대로
  (상관 신호 ≥2 = high) — 재계산 금지.

### Progressive disclosure (NNG)
- 기본 노출: 상위 1–2 개 고신호 줄(seam 이 이미 first-anomaly→event→pod→deployment 순 정렬).
- 나머지는 "전체 이벤트 N건" expander(`<button aria-expanded>`)로 접어둔다. 정보폭탄 방지.
- 줄이 ≤2 개면 expander 미표시.

### Empty-state (환각 금지 · HARD grounding)
- `empty === true` → seam 의 `emptyReason`("수집된 이벤트 없음")을 **verbatim** 렌더.
  지어내지 않는다. found=false(미지 id)도 동일 폴백.

### Interactive citations
- 각 줄의 `signal.sourceRef` 및 `sourceRefs[]` 중 온톨로지 objectId 형태(`type:id`)는
  클릭 가능 → `onCite(ref)` 호출.
  - ObjectView: `onCite` = traverse(참조 객체가 그래프에 있으면) → 같은 패널 in-place 이동.
  - COP hop: `onCite` = view.open(ref) → ObjectView 드로어 오픈.
  - pod/event ref(`pod/x`, `node/x`, `deployment/x`)는 온톨로지 객체가 아니므로 비클릭
    (텍스트 인용, escape 렌더). objectId 형태만 클릭 대상.

### 채팅 강등 (secondary)
- AiAgent 로 가는 채팅은 이미 별도 화면. ObjectView/COP 에서 근거 패널이 상단(Related/Actions
  위, 인시던트/문제 객체일 때)에 오도록 배치해 "먼저 읽히는" 경로로 만든다. 채팅은 명시적
  버튼/화면으로만 — 근거 패널이 default·passive.

### a11y
- `<section aria-label="근거">`, 헤더 `<h4>`. expander 는 `aria-expanded` + 텍스트 라벨.
- 인용 클릭은 `<button>`(키보드 도달·Enter/Space). 색-only 금지 — confidence 는 텍스트 배지.
- 용어(NotReady/backpressure 등)는 자연스러우면 InfoTip 재사용.

### 보안
- 모든 seam 텍스트(message/what/cause)는 React 기본 escape 텍스트 렌더. dangerouslySetInnerHTML
  없음. 인용 ref 도 텍스트/`onClick` 콜백 — URL 주입 없음.

## 테스트 케이스 (Vitest)
1. evidence 섹션이 seam 에서 신호→추정원인→영향 순서로 렌더된다(what·cause·impact 텍스트).
2. progressive disclosure: 기본 상위 1–2 줄만, "전체 이벤트 N건" expander 클릭 시 나머지 노출.
3. confidence: 상관 신호 ≥2 → high 배지(seam 규약 재사용).
4. empty-state: 상관 근거 0 → "수집된 이벤트 없음" verbatim, 근거 줄 없음.
5. clickable citation: objectId 인용 클릭 → onCite 호출(ObjectView traverse / COP open).
6. 기존 K8sSnapshot 소비만(신규 fetch/데이터 모델 없음) — buildK8sSnapshot 파생 확인.
7. ObjectView 통합: 문제 객체 열면 근거 섹션 렌더(기존 ObjectView/Investigate/isolation 테스트 green).

## Out of scope
- 자동 LLM 원인 서술(IMP-95), 복합 MCP tool(IMP-98), first-anomaly 타임라인 컴포넌트(IMP-100),
  액션 인라인 설명(IMP-96), 읽는 법 온보딩(IMP-97). 근거 패널은 순수 파생 렌더에 한정.
