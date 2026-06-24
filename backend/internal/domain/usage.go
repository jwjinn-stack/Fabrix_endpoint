package domain

// 사용량·귀속 리포트(문서 4-2) 타입.
// 귀속 차원(부서/앱/키/모델) 중 현재 메트릭에서 실측 가능한 축은 model.
// dept/app/api_key 는 귀속 라벨(§3-3) 연동 후 채워진다(현재 빈 문자열).

// UsageRow — 그룹 단위 1행 (현재 그룹 기준 = model).
type UsageRow struct {
	DeptID           string  `json:"dept_id,omitempty"`
	AppID            string  `json:"app_id,omitempty"`
	APIKeyID         string  `json:"api_key_id,omitempty"`
	Model            string  `json:"model"`
	Requests         int64   `json:"requests"`
	PromptTokens     int64   `json:"prompt_tokens"`
	CompletionTokens int64   `json:"completion_tokens"`
	TTFTp95ms        float64 `json:"ttft_p95_ms"`
	ITLavgMs         float64 `json:"itl_avg_ms"`
}

// UsageReport — GET /api/v1/usage 응답 (문서 4-2).
type UsageReport struct {
	Range       TimeRange  `json:"range"`
	GeneratedAt string     `json:"generated_at"`
	GroupBy     string     `json:"group_by"` // 현재 "model"
	Rows        []UsageRow `json:"rows"`
}

// UsageTrendPoint — 사용량 추세 한 버킷(P4-4 forecast 입력).
type UsageTrendPoint struct {
	Ts       string `json:"ts"` // RFC3339 UTC
	Requests int64  `json:"requests"`
	Tokens   int64  `json:"tokens"` // prompt+completion
}

// UsageTrend — GET /api/v1/usage/trend 응답(시간 버킷 추세). 프론트가 선형 forecast 구간을 그린다.
type UsageTrend struct {
	Range       TimeRange         `json:"range"`
	GeneratedAt string            `json:"generated_at"`
	BucketSec   int               `json:"bucket_sec"`
	Points      []UsageTrendPoint `json:"points"`
}

// PromDuration 은 TimeRange 를 PromQL 구간 문자열로 변환한다(increase/rate 윈도우).
func (r TimeRange) PromDuration() string {
	switch r {
	case Range6h:
		return "6h"
	case Range24h:
		return "24h"
	case Range7d:
		return "7d"
	default:
		return "1h"
	}
}
