# IMP-94 — backpressure 원인 신호 모델링 (큐 깊이·처리율·동시성·대기 p95)

- Type: ux (sev=high, effort=M)
- Branch: feature/evolve-cycle7-incident-explain
- Date: 2026-07-02

## 배경 / 문제
`대기 큐 적체 — 스케줄러 backpressure` 인시던트(mock.ts `inc_seed_q`, dedup `scheduler:queue-backpressure`)는
현재 `waiting` 값 하나 + 사람용 문자열 한 줄로만 표현된다. KineticStrip 4-슬롯 카드(신호→추정원인→영향)와
IMP-93 Evidence 패널이 backpressure 를 설명할 근거 신호가 없다 — GPU throttle·TTFT 는 신호가 있는데
backpressure 만 서술 근거가 비어 있는 **비대칭**. 초심자는 "큐가 왜 쌓이는지" 를 알 수 없다.

## 목표
backpressure 에 GPU throttle 과 동일한 신호 풍부함을 부여한다. 모든 값은 기존 `waiting` seed 의
**고정 함수(결정적, Date.now 미사용)** 로 파생하고, IMP-99 `buildIncidentEvidence` seam 을 통해
Evidence 패널·KineticStrip 이 인용한다.

## 설계

### 1. types.ts — 스케줄러/큐 신호 스키마 (결정적 파생 대상)
- `DetectionSignalKind` 에 `"backpressure"` 추가.
- `SchedulerSignals` 인터페이스 신설 (Incident.props 에 실려 detection 이 읽음):
  - `queueDepthTrend: number[]` — 짧은 시계열(큐 깊이 추이). `vllm:num_requests_waiting` 대응(mock).
  - `admittedRate: number` / `offeredRate: number` — req/s. admitted<offered = 유입>수용력.
  - `concurrencyLimit: number` / `concurrencyInUse: number` — `max_num_seqs` 대응(mock).
  - `queueWaitP95: number`(초) / `queueWaitSlo: number`(초) — `vllm:request_queue_time_seconds` 대응(mock).
  - `ttftRising: boolean` — TTFT 동반 상승(상관 게이팅용, waiting seed 로 파생).
  - `waiting: number` — 원시 seed(재현·감사).
  - `source: "mock"` — mock 라벨(실수집 스왑 대비).

### 2. mock.ts — 결정적 파생
- 순수 함수 `deriveSchedulerSignals(waiting: number): SchedulerSignals` 신설. **NO Date.now** —
  오직 `waiting` 의 고정 함수. 큐 깊이 추이는 waiting 으로 수렴하는 단조 근사 시계열,
  admittedRate=수용력 상한, offeredRate=admitted+waiting 유입, concurrency 포화, queueWaitP95=waiting 비례,
  ttftRising = waiting≥SLO 게이트.
- `inc_seed_q` 승격 시(dedup 접두 `scheduler`) 파생 결과를 Incident.props 에 병합. seed `waiting` 은
  기존 알림 문자열 임계(>8)와 정합하는 고정 상수(mock seed=12).

### 3. detection.ts — signalsForObject Incident 분기 + SLO 게이팅
- `Incident` + scheduler props 보유 시 backpressure 클러스터(~4 DetectionSignal) 방출:
  1. 큐 깊이 추이(queueDepthTrend 마지막값 + 상승).
  2. admittedRate<offeredRate (유입>수용력).
  3. concurrency saturation (inUse≥limit).
  4. queueWaitP95 vs SLO.
- **CRITICAL 증거 규율**: `waiting>0` 을 인시던트로 자동 취급 금지. `isBackpressureIncident()` 게이트 =
  **지속 waiting(≥지속 임계) AND queueWaitP95>SLO AND ttftRising** 상관 조건(bare constant 아님 —
  SLO 임계 대비). 게이트 실패 시 신호 0개 방출(짧은 큐 = 정상).
- `probableCauseText` / impact 문구에 상관≠인과 hedging("추정") 유지.
- `attributeDetections` 가 게이트 통과한 Incident 를 KineticStrip 카드로 승격(suggestedFor=Incident→ack).

### 4. KineticStrip — 4-슬롯 인용
- `SIGNAL_KIND_LABEL` 에 `backpressure: "큐 적체"` 추가(exhaustive Record).
- 신호=큐깊이+대기 p95, 추정원인=유입>수용력·concurrency cap·대형 prefill, 영향=대기 SLA·TTFT 동반.
  (probableCause/impact 는 detection 이 결정적으로 생성 — 컴포넌트는 렌더만.)

### 5. incidentEvidence.ts — IMP-99 seam 통과
- `KIND_RANK` 에 `backpressure` 추가(정렬 안정).
- `detectionCause`/`detectionImpact` 에 backpressure 케이스 추가.
- signalsForObject 를 그대로 재사용하므로 별도 파생 없음(단일 출처).

### 6. vLLM 표준 메트릭 매핑(real-swap fidelity)
- queue depth ~ `vllm:num_requests_waiting`, admitted/offered rate, concurrency ~ `max_num_seqs`,
  queue-time ~ `vllm:request_queue_time_seconds`. 전부 mock — `source:"mock"` 라벨.

## 테스트 케이스 (Vitest)
1. **결정성**: `deriveSchedulerSignals(w)` 동일 입력 → 동일 출력(Date.now 미의존). 두 번 호출 JSON 동일.
2. **backpressure 클러스터**: 게이트 통과 Incident → signalsForObject 가 `backpressure` 신호 ≥3 방출,
   각 신호에 citation/observedAt.
3. **SLO 게이팅(waiting>0 ≠ incident)**: 짧은 큐(waiting 작음/queueWaitP95≤SLO/ttft 비상승) → 신호 0개.
   지속+SLO 초과+ttft 상승 → 신호 방출.
4. **buildIncidentEvidence 통과**: seam 이 backpressure 근거 줄을 포함(kind==="backpressure"),
   probableCause/impact 채워짐, sourceRefs 존재.
5. **KineticStrip 렌더**: backpressure signals 를 가진 alert → "큐 적체" 라벨 + 큐깊이/대기 신호 렌더.
6. **회귀**: 기존 detection/incidentEvidence/isolation(IMP-88) 테스트 green.

## 제약
mock-first, prod deps 0, 결정적(no Date.now), 상관≠인과 카피, Backend.AI light + steel-blue,
Korean 주석, IMP-99 seam 통과, IMP-88 isolation green.
