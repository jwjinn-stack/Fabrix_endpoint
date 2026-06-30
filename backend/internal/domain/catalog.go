package domain

// 모델 카탈로그(Fireworks/Together 벤치마킹 — 카탈로그→플레이그라운드→엔드포인트).
// 클러스터에 서빙 중인 모델을 카탈로그처럼 노출한다.

// ModelType — 카탈로그 분류.
type ModelType string

const (
	TypeChat      ModelType = "chat"
	TypeVision    ModelType = "vision"
	TypeEmbedding ModelType = "embedding"
	TypeRerank    ModelType = "rerank"
)

// ModelInfo — 카탈로그 카드 1개.
type ModelInfo struct {
	ID            string    `json:"id"` // OpenAI model id
	DisplayName   string    `json:"display_name"`
	Provider      string    `json:"provider"` // google / qwen / baai ...
	Type          ModelType `json:"type"`
	ContextWindow int       `json:"context_window"` // 토큰
	Serving       string    `json:"serving"`        // dynamo-agg | vllm
	Namespace     string    `json:"namespace"`
	Workload      string    `json:"workload,omitempty"` // k8s 워크로드명(readiness 조회 키)
	Status        string    `json:"status"`             // ready | unknown | unreachable
	Playground    bool      `json:"playground"`         // 채팅 플레이그라운드 가능 여부
}

// ModelCatalog — GET /api/v1/models 응답.
type ModelCatalog struct {
	GeneratedAt string      `json:"generated_at"`
	Models      []ModelInfo `json:"models"`
}

// ModelLive — 모델별 실시간 운영 메트릭(P4-6, dynamo_frontend by model 라벨).
type ModelLive struct {
	TokS      float64 `json:"tok_s"` // 스트림 생성 속도(=1000/TPOT)
	TTFTp95ms float64 `json:"ttft_p95_ms"`
	E2Ep95ms  float64 `json:"e2e_p95_ms"`
	Requests  int64   `json:"requests"` // 기간 누적
	Deployed  bool    `json:"deployed"` // 메트릭 관측 여부(서빙 중)
}

// ModelMetric — 모델 카드 전면 운영 메트릭(P4-6). 카탈로그 메타 + live 메트릭 조인.
type ModelMetric struct {
	Model         string  `json:"model"`
	DisplayName   string  `json:"display_name"`
	Serving       string  `json:"serving"` // dynamo-agg | vllm | disagg
	Pattern       string  `json:"pattern"` // agg | disagg | vllm
	ContextWindow int     `json:"context_window"`
	GPU           int     `json:"gpu"` // 요구 GPU 수(추정)
	TokS          float64 `json:"tok_s"`
	TTFTp95ms     float64 `json:"ttft_p95_ms"`
	E2Ep95ms      float64 `json:"e2e_p95_ms"`
	Requests      int64   `json:"requests"`
	Deployed      bool    `json:"deployed"`
	Status        string  `json:"status"` // ready | unreachable | unknown
}

// ModelMetricsReport — GET /api/v1/models/metrics 응답.
type ModelMetricsReport struct {
	GeneratedAt string        `json:"generated_at"`
	Models      []ModelMetric `json:"models"`
	Source      string        `json:"source"`
}

// ── 플레이그라운드 ──

// ChatMessage — OpenAI 호환 메시지.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest — POST /api/v1/playground/chat 요청.
type ChatRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
	Temperature *float64      `json:"temperature,omitempty"`
}

// ChatResponse — 플레이그라운드 응답(원문 + 관측 지표 + 가드레일 판정).
type ChatResponse struct {
	Model            string        `json:"model"`
	Content          string        `json:"content"`
	PromptTokens     int           `json:"prompt_tokens"`
	CompletionTokens int           `json:"completion_tokens"`
	LatencyMs        int64         `json:"latency_ms"`
	TokensPerSec     float64       `json:"tokens_per_sec"`
	Guard            *GuardVerdict `json:"guard,omitempty"` // 가드레일 판정(차단 시 Content 는 비고 Reason 표시)
}
