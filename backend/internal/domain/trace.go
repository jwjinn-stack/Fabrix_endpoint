package domain

// 분산 트레이스 / 세션 / 가드레일 원문 — Langfuse 정합(하이브리드).
// 프론트(web/src/api/types.ts)의 Trace/Session/GuardContent 와 1:1 (json snake_case).
// 설계: docs/langfuse-trace-정합-설계.md, docs/구현가능성-검증.md §2-1/§2-3.

// SpanKind: Langfuse observation type 10종 + 서빙 내부(victoria-traces) 6종.
type SpanKind string

// SpanSource: langfuse=토큰/비용/프롬프트/가드레일, otel=victoria-traces(Dynamo span + vLLM span 속성).
type SpanSource string

// TraceSpan — Langfuse observation 또는 OTel span(또는 vLLM llm_request span 속성 파생).
type TraceSpan struct {
	SpanID     string         `json:"span_id"`
	ParentID   string         `json:"parent_id,omitempty"`
	Name       string         `json:"name"`
	Kind       SpanKind       `json:"kind"`
	Source     SpanSource     `json:"source"`
	StartMs    int            `json:"start_ms"`
	DurationMs int            `json:"duration_ms"`
	Status     string         `json:"status"` // ok | error
	Level      string         `json:"level,omitempty"`
	Model      string         `json:"model,omitempty"`
	CostKRW    float64        `json:"cost_krw,omitempty"`
	Derived    bool           `json:"derived,omitempty"` // vLLM llm_request span 속성을 구간 분해(별도 span 아님)
	Attributes map[string]any `json:"attributes"`
}

// TraceSummary — 요청 1건(Langfuse trace + root generation 집계).
type TraceSummary struct {
	TraceID         string  `json:"trace_id"`
	TS              string  `json:"ts"`
	Model           string  `json:"model"`
	Endpoint        string  `json:"endpoint"`
	AppID           string  `json:"app_id"`
	DeptID          string  `json:"dept_id"`
	APIKeyID        string  `json:"api_key_id"`
	UserID          string  `json:"user_id,omitempty"`
	SessionID       string  `json:"session_id,omitempty"`
	Route           string  `json:"route,omitempty"`
	TotalMs         int     `json:"total_ms"`
	TTFTMs          int     `json:"ttft_ms"`
	QueueMs         int     `json:"queue_ms"`
	DecodeMs        int     `json:"decode_ms"`
	PromptTokens    int     `json:"prompt_tokens"`
	CompletionToken int     `json:"completion_tokens"`
	CachedTokens    int     `json:"cached_tokens"`
	TokensPerSec    float64 `json:"tokens_per_sec"`
	TotalCostKRW    float64 `json:"total_cost_krw"`
	InputCostKRW    float64 `json:"input_cost_krw"`
	OutputCostKRW   float64 `json:"output_cost_krw"`
	Status          string  `json:"status"`
	Decision        string  `json:"decision"`
	FinishReason    string  `json:"finish_reason"`
	HTTPStatus      int     `json:"http_status"`
	Stream          bool    `json:"stream"`
}

type TraceListReport struct {
	Range       TimeRange      `json:"range"`
	GeneratedAt string         `json:"generated_at"`
	Traces      []TraceSummary `json:"traces"`
	Source      string         `json:"source"`
}

type TraceDetail struct {
	Summary       TraceSummary `json:"summary"`
	Spans         []TraceSpan  `json:"spans"`
	InputPreview  string       `json:"input_preview"`
	OutputPreview string       `json:"output_preview"`
}

// ── 세션 (Langfuse Sessions) ──
type SessionTurn struct {
	TraceID         string  `json:"trace_id"`
	TS              string  `json:"ts"`
	Model           string  `json:"model"`
	TTFTMs          int     `json:"ttft_ms"`
	TotalMs         int     `json:"total_ms"`
	PromptTokens    int     `json:"prompt_tokens"`
	CompletionToken int     `json:"completion_tokens"`
	CostKRW         float64 `json:"cost_krw"`
	Decision        string  `json:"decision"`
	Status          string  `json:"status"`
	UserPreview     string  `json:"user_preview"`
}

type SessionSummary struct {
	SessionID    string   `json:"session_id"`
	StartedAt    string   `json:"started_at"`
	LastAt       string   `json:"last_at"`
	Turns        int      `json:"turns"`
	AppID        string   `json:"app_id"`
	DeptID       string   `json:"dept_id"`
	UserID       string   `json:"user_id"`
	Models       []string `json:"models"`
	TotalTokens  int      `json:"total_tokens"`
	TotalCostKRW float64  `json:"total_cost_krw"`
	Blocked      int      `json:"blocked"`
	DurationMs   int64    `json:"duration_ms"`
}

type SessionListReport struct {
	Range       TimeRange        `json:"range"`
	GeneratedAt string           `json:"generated_at"`
	Sessions    []SessionSummary `json:"sessions"`
	Source      string           `json:"source"`
}

type SessionDetail struct {
	Summary SessionSummary `json:"summary"`
	Turns   []SessionTurn  `json:"turns"`
}

// ── 가드레일 차단 프롬프트 원문 (Langfuse GUARDRAIL observation.input) ──
// Semantic Router 는 원문을 보존하지 않으므로(구현가능성-검증 §2-3), 앱/프록시가
// Langfuse observation.input 에 계측한 경우에만 Captured=true. 아니면 graceful 안내.
type GuardContent struct {
	TraceID  string `json:"trace_id"`
	Captured bool   `json:"captured"`
	Input    string `json:"input"`
	Output   struct {
		Blocked  bool   `json:"blocked"`
		Reason   string `json:"reason"`
		Category string `json:"category"`
	} `json:"output"`
	Masked bool   `json:"masked"`
	Source string `json:"source"`
}
