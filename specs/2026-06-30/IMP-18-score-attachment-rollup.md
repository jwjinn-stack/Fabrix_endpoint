# 기능: 온라인 평가 점수를 라이브 트레이스/세션에 부착 + 세션 단위 지연 롤업

## 목적
FABRIX 는 span-kind 트레이스·세션 목록·LLM-as-judge 를 각각 갖췄지만 서로 끊겨 있다.
Langfuse 차별점은 평가 점수(scores)가 개별 trace/observation 에 '부착'돼 품질을 시계열 추적,
Helicone/Datadog 는 세션 단위 비용·토큰·지연 롤업. 우리 Eval 은 트레이스와 별개 수동 실행이라
운영 중 실제 요청의 품질·세션 비용을 한 흐름에서 못 본다.

이 작업은 mock-stage/schema-first 로:
- (1) Langfuse-shaped `Score` 모델을 backend domain + web types 에 1:1 추가하고 trace/세션에 부착,
- (2) 기존 LLM-as-judge(eval.go) → 선택 trace 에 Score 로 기록하는 인라인 경로,
- (3) observation-level optional + sampling 노출(과설계 금지),
- (4) 세션-레벨 지연 롤업(p50/avg TTFT + total p50) 필드 + UI 헤더/배너.

실 외부 평가 provider·실 빌링 연동 없음. 기존 mock 데이터 레이어(mock.ts) + synthetic Go 경로만.

## 요구사항
- `Score` 타입(Langfuse 정합): `{name, value, data_type: numeric|categorical|boolean, comment?, source: human|llm-judge|api, string_value?, trace_id, observation_id?, session_id?, ts}`.
- `scores: Score[]` 를 `TraceSummary` 에 부착(list 배지 + detail 패널). optional observation-level: `TraceSpan.scores`(root generation 만 스코어해도 OK).
- `SessionDetail.scores: Score[]` (세션 단위 점수).
- `SessionSummary` 지연 롤업: `ttft_p50_ms`, `ttft_avg_ms`, `latency_p50_ms`(turn total_ms p50). 비용/토큰 롤업은 기존 유지.
- mock/synthetic: trace 당 0~몇 개 점수 합성(결정적), 세션 턴에서 p50/avg 계산.
- Traces/Sessions LIST 에 compact 점수 배지 컬럼("정확성 4/5"), DETAIL 에 scores 패널(scoreColor/scoreCue 재사용).
- Session detail 헤더 "이 대화: ₩X · Y턴 · p50 Zms", Trace detail 비용/지연 배너.
- Eval→trace: 트레이스 detail 에서 "이거 평가" 인라인 트리거 → POST 로 Score 기록(mock echo, source=llm-judge).
- escaped React text 로만 렌더(no dangerouslySetInnerHTML).

## 함수 시그니처
### Go (backend/internal/domain/trace.go)
```go
type ScoreDataType string // numeric | categorical | boolean
type ScoreSource string   // human | llm-judge | api

type Score struct {
    Name          string        `json:"name"`
    Value         float64       `json:"value"`
    StringValue   string        `json:"string_value,omitempty"`
    DataType      ScoreDataType `json:"data_type"`
    Comment       string        `json:"comment,omitempty"`
    Source        ScoreSource   `json:"source"`
    TraceID       string        `json:"trace_id"`
    ObservationID string        `json:"observation_id,omitempty"`
    SessionID     string        `json:"session_id,omitempty"`
    TS            string        `json:"ts"`
}
// TraceSummary += Scores []Score `json:"scores,omitempty"`
// TraceSpan    += Scores []Score `json:"scores,omitempty"`  (observation-level)
// SessionSummary += TTFTP50Ms int `json:"ttft_p50_ms"`; TTFTAvgMs int `json:"ttft_avg_ms"`; LatencyP50Ms int `json:"latency_p50_ms"`
// SessionDetail  += Scores []Score `json:"scores,omitempty"`
```
### Go synth (backend/internal/langfuse/synth.go)
```go
func synthScores(seed uint32, traceID, sessionID string) []domain.Score // 결정적 0~2개
func p50i(vals []int) int  // 정수 p50(중앙값, nearest-rank)
func avgi(vals []int) int
```
### Go record path (backend/internal/server/traces.go)
```go
// POST /api/v1/traces/{id}/scores — mock: 본문 받아 Score echo (source=llm-judge|api). 비-mutating store.
func (s *Server) handleRecordScore(w http.ResponseWriter, r *http.Request)
```
### TS (web/src/api/types.ts) — 위 Go 와 1:1 snake_case
```ts
export type ScoreDataType = "numeric" | "categorical" | "boolean";
export type ScoreSource = "human" | "llm-judge" | "api";
export interface Score { name; value; string_value?; data_type; comment?; source; trace_id; observation_id?; session_id?; ts }
// TraceSummary.scores?: Score[]; TraceSpan.scores?: Score[];
// SessionSummary.ttft_p50_ms/ttft_avg_ms/latency_p50_ms; SessionDetail.scores?: Score[]
```
### TS mock (web/src/api/mock.ts) — synthScores/p50/avg 포팅
### TS client (web/src/api/client.ts)
```ts
export function recordScore(traceId: string, body: {name; value; data_type; comment?; source; observation_id?; session_id?}): Promise<Score>
```
### FE 공용 배지 (web/src/components/ScoreBadge.tsx)
```tsx
// scoreColor/scoreCue 재사용. numeric → "이름 4/5", categorical/boolean → string_value.
export function ScoreBadges({ scores, max }: { scores?: Score[]; max?: number }): JSX.Element | null
```

## 테스트 케이스
- (Go) Score JSON 직렬화 — snake_case 키(data_type/string_value/observation_id/session_id/ts) 정확, omitempty 동작.
- (Go) 세션 지연 롤업 — turn total_ms=[100,200,300,400] → latency_p50_ms=300(nearest-rank), ttft 평균 정확.
- (Go) synthSessionDetail 의 SessionSummary 가 ttft_p50_ms/ttft_avg_ms/latency_p50_ms 채움(>0).
- (Go) handleRecordScore — POST 본문 → 200 + Score echo, trace_id 채워짐, source 보존.
- (FE) ScoreBadges — numeric score 배지 "정확성 4/5" 렌더, 빈/undefined scores → null.
- (FE) ScoreBadges — categorical/boolean 은 string_value 표시.
- (FE) detail scores 패널 — comment 가 escaped text 로 렌더(no HTML injection).

## 출력 위치
- backend/internal/domain/trace.go (Score 타입 + 부착 필드)
- backend/internal/langfuse/synth.go (synthScores + p50/avg + 부착)
- backend/internal/server/traces.go (handleRecordScore)
- backend/internal/server/server.go (route 등록)
- backend/internal/langfuse/synth_test.go, backend/internal/server/traces_score_test.go (Go 테스트)
- web/src/api/types.ts (Score + 부착)
- web/src/api/mock.ts (synthScores + 롤업 + record 라우트)
- web/src/api/client.ts (recordScore)
- web/src/components/ScoreBadge.tsx (공용 배지/패널, scoreColor/scoreCue)
- web/src/pages/Traces.tsx, Sessions.tsx (배지 컬럼 + 패널 + 헤더/배너 + 인라인 평가)
- web/src/components/ScoreBadge.test.tsx (FE 테스트)

## 의존성
없음 (신규 runtime dep / Go module dep 0개). React 19 + Go stdlib. scoreColor/scoreCue 재사용.
