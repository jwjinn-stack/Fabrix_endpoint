package domain

// 가드레일(Semantic Router 연동 + 증적) 도메인 타입.
// 모든 추론 요청은 우리 레이어에서 PII/Jailbreak 판정을 거치고, 그 결과가
// 불변 증적(ClickHouse guard_audit, 후속 WORM)으로 남는다. (SSOT 2-2/2-4, 4-3)

// GuardDecision — 가드레일 최종 판정.
type GuardDecision string

const (
	DecisionAllow   GuardDecision = "allowed" // 통과
	DecisionBlocked GuardDecision = "blocked" // 차단(PII 또는 jailbreak)
	DecisionFlagged GuardDecision = "flagged" // 통과했으나 표시(낮은 위험)
)

// PIIEntity — 탐지된 PII 항목(원문 미저장, 유형/신뢰도만).
type PIIEntity struct {
	Type       string  `json:"type"`       // ssn_kr | rrn | account_kr | passport_kr | email | phone | class_NN(SR)
	Confidence float64 `json:"confidence"` // 0..1
}

// GuardVerdict — 단일 요청 판정 결과(플레이그라운드 응답에 동봉).
type GuardVerdict struct {
	Decision     GuardDecision `json:"decision"`
	GuardTypes   []string      `json:"guard_types"`            // ["pii"], ["jailbreak"], ...
	PIIEntities  []PIIEntity   `json:"pii_entities,omitempty"` // 탐지된 PII (마스킹된 메타만)
	JBConfidence float64       `json:"jb_confidence"`          // jailbreak 신뢰도 0..1
	Category     string        `json:"category,omitempty"`     // intent 분류(예: other, business)
	Reason       string        `json:"reason,omitempty"`       // 차단 사유(사용자 표시용)
	LatencyMs    int64         `json:"latency_ms"`             // 가드레일 처리 지연
	PolicyVer    string        `json:"policy_version"`
}

// PolicyRule — 단일 가드레일 정책 축의 토글 + 동작.
type PolicyRule struct {
	Enabled bool   `json:"enabled"`
	Action  string `json:"action"` // block | flag
}

// GuardPolicy — 정책 카탈로그(#12). PII 외 jailbreak·secrets 다축을 토글/동작 지정.
// Portkey/Kong/NeMo 정책 카탈로그 패턴.
type GuardPolicy struct {
	PII       PolicyRule `json:"pii"`
	Jailbreak PolicyRule `json:"jailbreak"`
	Secrets   PolicyRule `json:"secrets"`
}

// DefaultPolicy — 증권사 기본(전 축 차단).
func DefaultPolicy() GuardPolicy {
	return GuardPolicy{
		PII:       PolicyRule{Enabled: true, Action: "block"},
		Jailbreak: PolicyRule{Enabled: true, Action: "block"},
		Secrets:   PolicyRule{Enabled: true, Action: "block"},
	}
}

// GuardAuditRow — 증적 1행(ClickHouse fabrix.guard_audit 미러, 4-3 테이블 행).
type GuardAuditRow struct {
	EventID       string        `json:"event_id"`
	Ts            string        `json:"ts"` // RFC3339 UTC
	TraceID       string        `json:"trace_id"`
	UserRef       string        `json:"user_ref"` // salted SHA-256(x-user-id) — 원문 비식별
	DeptID        string        `json:"dept_id"`
	AppID         string        `json:"app_id"`
	APIKeyID      string        `json:"api_key_id"`
	Model         string        `json:"model"`
	Decision      GuardDecision `json:"decision"`
	GuardTypes    []string      `json:"guard_types"`
	PIISubtypes   []string      `json:"pii_subtypes"`
	JBConfidence  float64       `json:"jb_confidence"`
	PolicyVersion string        `json:"policy_version"`
	MaskedSample  string        `json:"masked_sample"` // 마스킹된 프롬프트 일부(원문/PII 미포함)
	HTTPStatus    int           `json:"http_status"`   // 응답 상태 코드(P4-9, SIEM 표준 컬럼)
	LatencyMs     int64         `json:"latency_ms"`    // 가드레일 판정 지연 ms(P4-9)
}

// GuardSummary — 증적 뷰 요약 카드(검사/차단/PII/JB/flagged).
type GuardSummary struct {
	Checked   int `json:"checked"`
	Blocked   int `json:"blocked"`
	PII       int `json:"pii"`
	Jailbreak int `json:"jailbreak"`
	Flagged   int `json:"flagged"`
}

// GuardAuditReport — GET /api/v1/guard/audit 응답.
type GuardAuditReport struct {
	Range       TimeRange       `json:"range"`
	GeneratedAt string          `json:"generated_at"`
	Summary     GuardSummary    `json:"summary"`
	Rows        []GuardAuditRow `json:"rows"`
	Source      string          `json:"source"` // clickhouse | unavailable
}
