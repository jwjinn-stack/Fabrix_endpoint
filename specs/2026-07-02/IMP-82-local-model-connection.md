# IMP-82 — AI Agent 로컬 모델 연결 상태 칩 + Settings 모델 연결 카드

- **Type**: ux (sev=high, effort=M) · Direction 3 + 정직성(8)
- **Branch**: feature/evolve-cycle6-ontology-ux
- **Date**: 2026-07-02

## 배경 / 문제

AiAgent 패널과 클러스터 인사이트가 "로컬 추론 모델(Dynamo)"을 근거로 결과를 낸다고 반복 표기하지만
(AiAgent.tsx:148·429·438), 사용자는 (a) 어떤 엔드포인트/모델에 연결됐는지, (b) 연결이 살아있는지(health),
(c) 응답이 느린지(지연/TTFT) 알 방법이 전혀 없다. Settings 에는 브랜드 색 카드(localStorage-persist)는 있으나
모델 연결 설정은 없다. mock 뒤에서는 실제로 아무 모델에도 연결되지 않으므로, 무엇을 표기하든 **정직성(direction 8)**
이 걸린다 — 절대로 mock 을 "연결됨"으로 위장하면 안 된다.

## 목표 / 원칙

1. **정직 우선**: 기본 상태(mock)는 정직하게 "mock 모델"로 표기한다. "연결됨(online)"이라고 하지 않는다.
   fix 는 정직성을 **강화**해야 한다 — mock 인데 실연결로 보이게 만들면 안 된다.
2. **하드코딩 금지**: 모델명·지연은 실경로(VITE_MOCK=off)에서 GET /v1/models·프로브로 해석한다.
3. **zero 신규 의존성**: 기존 폴링(usePolling)·fetch/timeout·Badge·DataFreshness 재사용.
4. **read-only·저비용**: /health(200 기대)·/v1/models 만. mutation 없음.
5. **manage 게이팅**: Settings 카드는 credentials cap(manage 전용). observe = 읽기 전용(폼 비활성).

## 상태 모델 (3+1)

| 상태 | 조건 | 톤 | 라벨 |
|------|------|----|----|
| mock (기본) | VITE_MOCK 미해제(=mock 활성) | neutral(무채색) | "mock 모델" (NOT "연결됨") |
| online | /health 200 + /v1/models 에 구성 모델 id 존재 | green | "연결됨 · {model}" |
| degraded | /health 200 이나 지연↑(TTFT/latency 임계 초과) 또는 "연결됐으나 다른 모델"(구성 id 부재) | amber | "지연" / "모델 불일치" |
| offline | /health 실패(non-200/네트워크/타임아웃) | red | "오프라인" |

- 지연 배지: **TTFT(time-to-first-token) 우선** 노출(스트리밍 지각-반응 신호). TTFT 없으면 프로브 왕복(latency) 표기.
- degraded 임계: TTFT ≥ 1000ms(목표 <1s) 또는 프로브 latency ≥ 2000ms → degraded.

## 설계

### 신규 순수 모듈 `web/src/api/modelConnection.ts`

- `MODEL_CONN_STORE_KEY = "fabrix.modelConn"` localStorage 키.
- `ModelConnConfig { endpoint: string; model: string; timeoutMs: number }`.
- `loadModelConfig()` / `saveModelConfig()` — theme.tsx loadBrand 패턴 미러(파싱 실패 graceful).
- `isMockMode(): boolean` — `import.meta.env.VITE_MOCK !== "off"` (main.tsx 규약과 동형).
- `resolveConnState(probe, config): { state, tone, label, latencyMs, ttftMs, model }` — **순수 함수**(단위 테스트 대상).
- `probeModel(config, signal): Promise<ProbeResult>` — GET {endpoint}/health + GET {endpoint}/v1/models.
  - health non-200/throw → offline. models 에서 구성 model id 탐색(없으면 mismatch=degraded).
  - TTFT: /v1/models 응답의 왕복시간을 perceived latency proxy 로 측정(프로브가 실제 스트리밍은 아님 — 정직 표기).
  - 응답 **본문 로깅 금지**(모델 id 목록만 파싱, raw 미저장).
- `DYNAMO_PRESET` — endpoint `http://localhost:8000`, model 빈값, timeout 8000ms.

### 신규 컴포넌트 `web/src/components/ModelStatusChip.tsx`

- props: `config`, `variant?`(header|panel). mock 이면 프로브 없이 즉시 "mock 모델" 칩(정직).
- 실경로면 usePolling 으로 probeModel 폴링(interval 15s, read-only). Badge(dot) + 모델명 + TTFT/지연 배지.
- title(hover)로 endpoint·상세 표기. 색 비의존(dot+텍스트, WCAG).

### AiAgent.tsx

- 헤더(page-head, DataFreshness 옆)와 인사이트 패널 헤더(cop-panel-h:429)에 `<ModelStatusChip>` 추가.
- config 는 loadModelConfig() 1회 로드(useState 초기값).

### Settings.tsx — `LocalModelCard`

- BrandColorCard/AlertWebhookCard 패턴. endpoint URL·model·timeout 입력 + Dynamo :8000 프리셋 버튼.
- "연결 테스트" 버튼 → probeModel 인라인 리포트(health/models/지연). credentials cap 게이팅(canConfig).
- observe(읽기 전용)면 입력 비활성 + 사유. localStorage 저장(민감정보 아님 — endpoint/model 은 config).

## 정직성 체크

- mock 기본: 칩은 무채색 "mock 모델" + title "mock 모드 — 실제 모델에 연결되지 않음". 절대 green/"연결됨" 아님.
- online 은 실제 /health 200 **그리고** 구성 model id 가 /v1/models 에 존재할 때만.

## 테스트 케이스 (`web/src/api/modelConnection.test.ts`)

1. 기본(config 없음) → loadModelConfig 은 DYNAMO_PRESET 아닌 빈 기본값 반환, isMock 시 resolveConnState = "mock", 톤 neutral, 라벨에 "mock" 포함(NOT "연결됨").
2. probe health 실패 → resolveConnState = "offline"(red).
3. health 200 + 구성 model 존재 → "online"(green), 라벨에 모델명.
4. health 200 + 구성 model 이 목록에 없음 → "degraded"(amber, "모델 불일치").
5. health 200 + TTFT ≥ 1000ms → "degraded"(amber, 지연).
6. TTFT 우선 노출 — ttftMs 있으면 그 값, 없으면 latencyMs.
7. saveModelConfig → loadModelConfig round-trip(localStorage), 파싱 실패 graceful.
8. 타임아웃/네트워크 오류 프로브 → offline(throw 아님).

## 검증

- `cd web && npm run test`(ALL pass, IMP-88 isolation green) + `npm run build`(tsc).
- IMP-82 Status → done (IMPROVEMENTS.md Open 표).

## TOUCHED_SURFACES (visual QA)

- **AI Agent 헤더**(/agent) — 우측 상단 DataFreshness 옆 연결 상태 칩. 기본 무채색 "mock 모델".
- **AI Agent · 클러스터 인사이트 패널** 헤더(cop-panel-h) — 동일 칩(로컬 모델 근거 주장 지점).
- **설정 · 관리**(/settings) — "로컬 추론 모델 연결" 카드(ReconfigurePanel 아래): endpoint/model/timeout 입력 +
  Dynamo :8000 프리셋 + 저장 + **연결 테스트** 인라인 리포트(Badge dot). observe 는 입력 비활성.

## Out of scope

- 실제 스트리밍 완결(chat completion) 프로브 — /health+/v1/models 만(저비용·read-only).
- 토큰/시크릿 입력 — 이번 카드는 endpoint/model/timeout 만(민감정보 없음).
