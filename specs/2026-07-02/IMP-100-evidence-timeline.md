# IMP-100 — 근거 evidence 타임라인 시각언어 (신호→추정원인→영향 세로 타임라인)

- Type: aesthetic (sev=medium, effort=M)
- Branch: feature/evolve-cycle7-incident-explain
- Date: 2026-07-02

## 배경 / 문제
EvidencePanel(IMP-93), KineticStrip 4-슬롯 카드, COP hop 은 근거를 **평면 텍스트 나열**로만 보여준다
(SIGNAL_KIND_LABEL 칩 + 문장, 또는 ev-line 카드 스택). Datadog Watchdog·incident.io·Grafana OnCall 은
"무엇이 먼저 무너졌나"를 **세로 evidence timeline**(시간축 rail·이벤트 마커·severity 색·경과시간·인과 연결선)으로
그려 인과 흐름이 한눈에 읽힌다. 우리 표면은 평면적이라 시니어가 아닌 온콜이 **순서/인과**를 못 잡는다.

## 목표 (한 줄)
같은 근거 데이터(IMP-99 seam / IMP-72 KineticAlert.signals)를 **세로 evidence timeline** 시각언어로 승격 —
first-anomaly부터 현재까지 rail 위에 신호 마커를 severity 색·경과시간으로 배치하고, "추정 원인" 노드를
강조 + 영향으로 잇는 연결선을 그린다. 데이터/서술은 그대로, 인과 흐름만 읽히게.

## 설계

### 단일 재사용 컴포넌트: `EvidenceTimeline`
IMP-97 first-anomaly 타임라인과의 중복을 피하기 위해 **하나의 타임라인 컴포넌트**를 만든다.
정규화된 마커 배열 `TimelineMarker[]` 를 받아 세로 rail + 마커로 렌더한다(데이터 소스 무관).

```ts
export interface TimelineMarker {
  id: string;
  kind: string;               // 근거 계열(alertrule/throttle/k8sEvent/firstAnomaly/…) — 접두 라벨/색 판별
  severity: "crit" | "warn" | "info"; // 마커 색(WCAG 텍스트 병기 — 색-only 금지)
  when: string;               // 경과시간 라벨("12분 전") — Date.now 미의존, seam 값 그대로
  title: string;              // 신호 서술(what/label)
  cause?: string;             // 추정 원인(강조 노드) — 있으면 인과 연결선
  impact?: string;            // 추정 영향(연결선 끝)
  citation?: { ref: string; objectId: string | null }; // IMP-93 인용(objectId면 클릭)
  isAnchor?: boolean;         // first-anomaly = 시간축 앵커(rail 시작점 강조)
}
```

- **재파생 금지**: 마커 배열은 seam/alert 이 이미 정렬한 순서 그대로(first-anomaly→now). 컴포넌트는 정렬/임계 계산 없음.
- **severity 색**: kind→severity 결정적 매핑(alertrule/k8sEvent=crit, throttle/saturation/backpressure/k8sPod/k8sDeployment=warn, firstAnomaly/idleAlloc=info). rail 마커 dot 색 + 텍스트 배지 병기(색-only 금지).
- **경과시간**: `when` 라벨(seam 의 observedAt) 그대로 렌더.
- **추정 원인 강조**: `cause` 있는 마커는 `ev-tl-cause` 노드로 강조(스틸블루 좌측 rail 두껍게) + `cause → impact` 세로 연결선(SVG/CSS 커넥터).
- **인용 보존(IMP-93)**: `citation.objectId` 있고 onCite 제공 시 클릭 버튼(ev-cite-link 재사용), 아니면 텍스트.
- **motion-reduce**: 진입/hover transition 은 전역 @media(prefers-reduced-motion) 규칙이 이미 죽인다. 신규 무한 애니메이션 도입 금지.
- **토큰**: Backend.AI 라이트 + 스틸블루(--primary) + 상태색(--red/--amber). NO neon. 깊이=border/surface-2, 정렬=rail, 타입 위계=fs/weight.

### 어댑터(재파생 아님 — 형태 변환만)
- `markersFromEvidence(lines: EvidenceLine[]): TimelineMarker[]` — EvidencePanel 용. EvidenceLine → marker 필드 매핑.
- `markersFromSignals(signals: DetectionSignal[]): TimelineMarker[]` — KineticStrip 용. DetectionSignal → marker(cause/impact 없음 → 마커만).

### 배선
1. **EvidencePanel**: `<ol className="ev-lines">` 를 `<EvidenceTimeline markers={markersFromEvidence(visible)} onCite=… />` 로 교체. progressive disclosure(상위 N + expander)·empty-state·rootCauseSummary·confidence 배지 그대로 유지. dense 변형도 유지.
2. **KineticStrip [슬롯2]**: `.kinetic-signals` 리스트를 `<EvidenceTimeline markers={markersFromSignals(alert.signals)} compact />` 로 교체. 인용(citation) 유지. cause/impact 는 슬롯3(probableCause)에 이미 있으므로 마커에는 안 실음(중복 회피).
3. **COP hop**: EvidencePanel(dense) 경유이므로 자동 승격 — 별도 배선 없음.

## 테스트 케이스 (Vitest)
- **T1 정렬·마커**: 타임라인이 first-anomaly→now 순서로 마커를 렌더(seam 순서 보존). listitem 수 = 입력 마커 수.
- **T2 severity 색 + 경과시간**: 각 마커에 severity 클래스(ev-tl-sev-crit/warn/info) + 경과시간(when) 텍스트가 있다. 색-only 아님(텍스트 병기).
- **T3 추정 원인 강조 + 연결선**: cause 있는 마커는 ev-tl-cause 노드 + 연결선(ev-tl-connector) 렌더, impact 도 렌더.
- **T4 인용 보존(IMP-93)**: objectId 인용은 onCite 제공 시 클릭 버튼(ev-cite-link) → onCite(objectId). 미제공이면 비클릭 텍스트.
- **T5 first-anomaly 앵커**: isAnchor 마커는 ev-tl-anchor 로 rail 시작점 강조.
- **T6 재사용**: markersFromEvidence / markersFromSignals 어댑터가 각 소스에서 동일 TimelineMarker 형태를 낸다.
- **T7 reduce-motion**: 컴포넌트가 신규 무한 애니메이션을 도입하지 않는다(전역 규칙 존중 — DOM에 animation 인라인 없음).
- **회귀**: 기존 EvidencePanel/KineticStrip/Investigate/isolation(IMP-88) 테스트 green. progressive disclosure·empty·confidence 유지.

## 비목표 / 제약
- 데이터 모델 변경 없음(IMP-99 seam·KineticAlert.signals 그대로 소비, 재파생 금지).
- 새 fetch/네트워크 없음. mock-first.
- neon/글로우 금지. dangerouslySetInnerHTML 금지(모두 escape 텍스트/SVG).

## TOUCHED_SURFACES
- ObjectView 근거 패널(EvidencePanel), COP hop 카드 아래 근거(dense), Kinetic 알림 스트립 [슬롯2] 근거.
