package domain

// 관제 대시보드(문서 4-1) 응답 타입.
// 4개 카드(트래픽/품질/가드레일/GPU) + 부서/앱 분포 + 알람으로 구성된다.

// TrafficCard — 실시간 트래픽 (출처: vllm:num_requests_running/waiting, request_success_total).
type TrafficCard struct {
	QPS         float64 `json:"qps"`
	Running     int     `json:"running"`      // vllm:num_requests_running (KEDA 트리거)
	Waiting     int     `json:"waiting"`      // vllm:num_requests_waiting (HPA 트리거)
	SuccessRate float64 `json:"success_rate"` // 0..1
}

// QualityCard — 응답 품질 (출처: vllm:time_to_first_token_seconds 등).
type QualityCard struct {
	TTFTp50ms    float64 `json:"ttft_p50_ms"`
	TTFTp95ms    float64 `json:"ttft_p95_ms"`
	ITLavgMs     float64 `json:"itl_avg_ms"`     // time_per_output_token
	CacheHitRate float64 `json:"cache_hit_rate"` // vllm:gpu_prefix_cache_hit_rate, 0..1
}

// GuardrailCard — 가드레일 요약 (출처: 증적 파이프라인 Part 2).
type GuardrailCard struct {
	Blocked   int `json:"blocked"`   // 기간 내 차단 건수
	PII       int `json:"pii"`       // PII 위반 건수
	Jailbreak int `json:"jailbreak"` // jailbreak 차단 건수
	Flagged   int `json:"flagged"`   // flagged(통과했으나 표시) 건수
}

// GPUCard — GPU/MIG 요약 (출처: DCGM + vllm:gpu_cache_usage_perc).
type GPUCard struct {
	UsagePerc     float64 `json:"usage_perc"`     // 0..1
	KVCachePerc   float64 `json:"kv_cache_perc"`  // 0..1, vllm:gpu_cache_usage_perc
	MIGEfficiency float64 `json:"mig_efficiency"` // 0..1, 문서 3-4 MIG 효율 스코어
}

// LatencyBreakdown — 추론 지연 3분할(P4-1, Grafana vLLM 패턴).
// TTFT = time_to_first_token, TPOT = inter_token_latency(time per output token),
// E2E = request_duration. 각 p50/p95/p99 (출처: dynamo_frontend_* 히스토그램).
type LatencyBreakdown struct {
	TTFTp50ms float64 `json:"ttft_p50_ms"`
	TTFTp95ms float64 `json:"ttft_p95_ms"`
	TTFTp99ms float64 `json:"ttft_p99_ms"`
	TPOTp50ms float64 `json:"tpot_p50_ms"`
	TPOTp95ms float64 `json:"tpot_p95_ms"`
	TPOTp99ms float64 `json:"tpot_p99_ms"`
	E2Ep50ms  float64 `json:"e2e_p50_ms"`
	E2Ep95ms  float64 `json:"e2e_p95_ms"`
	E2Ep99ms  float64 `json:"e2e_p99_ms"`
}

// SchedulerState — 엔진 스케줄러 상태(P4-1, Grafana vLLM Scheduler State).
// running/waiting = vllm:num_requests_running/waiting, queue = request_plane_queue p95,
// kv_cache = vllm:kv_cache_usage_perc(실 KV 캐시 점유, VRAM 비율과 구분).
type SchedulerState struct {
	Running     int     `json:"running"`
	Waiting     int     `json:"waiting"`
	QueueP95ms  float64 `json:"queue_p95_ms"`
	KVCachePerc float64 `json:"kv_cache_perc"` // 0..1
}

// TokenBreakdown — 입력/캐시/출력 토큰 분해(P4-1, 기간 누적).
// 출처: dynamo_frontend_input_sequence_tokens_sum / cached_tokens_sum / output_tokens_total.
type TokenBreakdown struct {
	PromptTokens     int64 `json:"prompt_tokens"`
	CachedTokens     int64 `json:"cached_tokens"` // prompt 중 prefix 캐시 적중분
	CompletionTokens int64 `json:"completion_tokens"`
}

// RankRow — Top-N 랭킹 카드 한 줄(P4-1 Top5 Endpoints/API Keys, Nutanix 패턴).
type RankRow struct {
	Key      string `json:"key"`   // 식별자(model id 또는 api_key_id)
	Label    string `json:"label"` // 표시명(엔드포인트=모델, 키=이름/마스킹)
	Requests int64  `json:"requests"`
	Tokens   int64  `json:"tokens"` // prompt+completion
}

// PipelineStage — 엔진 요청 파이프라인 한 단계(P4-3 queue→prefill→decode 색분할).
type PipelineStage struct {
	Name  string  `json:"name"`
	AvgMs float64 `json:"avg_ms"`
	Kind  string  `json:"kind"` // proxy | route | queue | prefill | decode | network
}

// EnginePipeline — GET /api/v1/proxy/pipeline 응답. 평균 요청의 단계별 지연 분해
// (dynamo_frontend_stage_duration / request_plane_queue / TTFT / request_duration).
type EnginePipeline struct {
	Stages    []PipelineStage `json:"stages"`
	QueueMs   float64         `json:"queue_ms"`
	PrefillMs float64         `json:"prefill_ms"` // = TTFT
	DecodeMs  float64         `json:"decode_ms"`  // = E2E - TTFT
	TotalMs   float64         `json:"total_ms"`
	HasTraces bool            `json:"has_traces"` // 개별 분산 트레이스(victoria-traces) 가용 여부
	Source    string          `json:"source"`     // live | mock
}

// DeptUsage — 부서별 사용량 분포 막대 (Top N).
type DeptUsage struct {
	DeptID  string  `json:"dept_id"`
	Name    string  `json:"name"`
	Percent float64 `json:"percent"` // 0..1
}

// AppUsage — 앱별 요청 분포 막대 (Top N).
type AppUsage struct {
	AppID   string  `json:"app_id"`
	Percent float64 `json:"percent"` // 0..1
}

// AlarmSeverity 는 알람 심각도.
type AlarmSeverity string

const (
	SeverityInfo     AlarmSeverity = "info"
	SeverityWarning  AlarmSeverity = "warning"
	SeverityCritical AlarmSeverity = "critical"
)

// Alarm — 대시보드 하단 알람 라인.
type Alarm struct {
	Severity AlarmSeverity `json:"severity"`
	Message  string        `json:"message"`
}

// DashboardOverview — GET /api/v1/dashboard/overview 응답 (문서 4-1 한 화면).
type DashboardOverview struct {
	Range        TimeRange        `json:"range"`
	GeneratedAt  string           `json:"generated_at"` // RFC3339 UTC (표시단에서 Asia/Seoul 변환)
	Traffic      TrafficCard      `json:"traffic"`
	Quality      QualityCard      `json:"quality"`
	Guardrail    GuardrailCard    `json:"guardrail"`
	GPU          GPUCard          `json:"gpu"`
	Latency      LatencyBreakdown `json:"latency"`   // P4-1 추론 지연 3분할
	Scheduler    SchedulerState   `json:"scheduler"` // P4-1 스케줄러 상태/큐
	Tokens       TokenBreakdown   `json:"tokens"`    // P4-1 토큰 입력/캐시/출력 분해
	DeptUsage    []DeptUsage      `json:"dept_usage"`
	AppUsage     []AppUsage       `json:"app_usage"`
	TopEndpoints []RankRow        `json:"top_endpoints"` // P4-1 Top5 엔드포인트(모델)
	TopKeys      []RankRow        `json:"top_keys"`      // P4-1 Top5 API 키
	Alarms       []Alarm          `json:"alarms"`
}

// TimePoint — 시계열 한 점 (QPS / 지연 3분할 p95 / 스케줄러 / 차단 겹쳐보기).
type TimePoint struct {
	Ts        string  `json:"ts"` // RFC3339 UTC
	QPS       float64 `json:"qps"`
	TTFTp95ms float64 `json:"ttft_p95_ms"`
	TPOTp95ms float64 `json:"tpot_p95_ms"` // P4-1 추론 지연 3분할 시계열
	E2Ep95ms  float64 `json:"e2e_p95_ms"`
	Running   int     `json:"running"` // P4-1 스케줄러 실행/대기 시계열
	Waiting   int     `json:"waiting"`
	Blocked   int     `json:"blocked"`
}

// Timeseries — GET /api/v1/dashboard/timeseries 응답.
type Timeseries struct {
	Range  TimeRange   `json:"range"`
	Points []TimePoint `json:"points"`
}
