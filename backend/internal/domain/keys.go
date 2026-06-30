package domain

import "strings"

// 키·앱 관리 (문서 Part 1 ACCESS, 4-6). Nutanix Create API Key 플로우 차용.

// IssueKeyRequest — POST /api/v1/keys 요청.
type IssueKeyRequest struct {
	AppID      string `json:"app_id,omitempty"`      // 기존 앱 선택 시 사용. 비면 app_name 으로 slug 생성.
	AppName    string `json:"app_name"`              // 앱 이름(없으면 자동 생성)
	DeptID     string `json:"dept_id,omitempty"`     // 앱 소속 부서. "" 면 미귀속.
	KeyName    string `json:"key_name"`              // 키 표시 이름
	ModelScope string `json:"model_scope,omitempty"` // '*' 또는 특정 모델 id
	QuotaRPM   *int   `json:"quota_rpm,omitempty"`   // 분당 요청 한도(미설정=무제한)
	QuotaTPD   *int64 `json:"quota_tpd,omitempty"`   // 일당 토큰 한도(미설정=무제한, 하드캡 429)
	// 예산 폼(P4-5, Portkey 패턴): 경고 임계(0..1, 한도의 N%에서 경고). 미설정=0.8 기본.
	AlertThreshold *float64 `json:"alert_threshold,omitempty"`
}

// IssuedKey — 발급 응답. plaintext 는 이 순간 1회만 반환(이후 해시만 보관).
type IssuedKey struct {
	APIKeyID  string `json:"api_key_id"`
	AppID     string `json:"app_id"`
	Plaintext string `json:"plaintext"`
	KeyPrefix string `json:"key_prefix"`
}

// APIKeyView — 키 목록 1행 (마스킹 표시 + 쿼터 + 사용량 귀속).
type APIKeyView struct {
	APIKeyID       string   `json:"api_key_id"`
	AppID          string   `json:"app_id"`
	AppName        string   `json:"app_name"`
	DeptID         string   `json:"dept_id"`
	Name           string   `json:"name"`
	ModelScope     string   `json:"model_scope"`
	KeyPrefix      string   `json:"key_prefix"`
	QuotaRPM       *int     `json:"quota_rpm,omitempty"`
	QuotaTPD       *int64   `json:"quota_tpd,omitempty"`
	AlertThreshold *float64 `json:"alert_threshold,omitempty"` // 0..1
	Enabled        bool     `json:"enabled"`
	CreatedAt      string   `json:"created_at"`
	RevokedAt      *string  `json:"revoked_at,omitempty"`
	// 사용량(usage_rollup 귀속 — 범위 기간). 키별 스펜드/Top5 표시용.
	Requests   int64 `json:"requests"`
	PromptToks int64 `json:"prompt_tokens"`
	CompTokens int64 `json:"completion_tokens"`
	// P4-5 예산 진행: 오늘 누적 토큰(인메모리 카운터) + 추정 비용(KRW).
	TokensToday int64   `json:"tokens_today"`
	EstCostKRW  float64 `json:"est_cost_krw"` // 범위 기간 추정 비용(자가호스팅 토큰단가)
}

// KeyQuota — 쿼터 강제용 조회 결과.
type KeyQuota struct {
	QuotaRPM       *int
	QuotaTPD       *int64
	AlertThreshold *float64
	Enabled        bool
	Found          bool
}

// EstCostKRW 는 토큰 사용량의 추정 비용(KRW)을 반환한다.
// 자가호스팅(온프렘 GPU) 환경의 토큰 단가 추정치 — 정산용 아님, 상대 비교/예산 참고용.
// 입력/출력 1M 토큰당 단가(KRW). 모델별 미지정 시 default.
func EstCostKRW(model string, promptTokens, completionTokens int64) float64 {
	m := strings.ToLower(model)
	in, out := 150.0, 600.0 // default: 입력 150원/1M, 출력 600원/1M
	switch {
	case strings.Contains(m, "120b"), strings.Contains(m, "gpt-oss"):
		in, out = 400, 1600
	case strings.Contains(m, "gemma"):
		in, out = 200, 800
	case strings.Contains(m, "30b"), strings.Contains(m, "qwen3-30b"):
		in, out = 150, 600
	}
	return (float64(promptTokens)/1_000_000.0)*in + (float64(completionTokens)/1_000_000.0)*out
}
