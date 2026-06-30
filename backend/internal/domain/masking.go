package domain

// MaskingPolicy 는 게이트웨이 글루가 추론 트레이스를 Langfuse ingestion 으로 보내기 전에
// 적용하는 캡처/마스킹 정책이다. 무엇을(원문 vs 마스킹 vs 미저장) 보존할지 고객사별로 다르므로
// FABRIX 설정 화면에서 편집 → PostgreSQL 영속 → 게이트웨이 글루가 GET /api/v1/masking/policy 로
// 폴링·캐시해 요청마다 적용한다. (FABRIX BFF 는 정책을 저장·제공·UI 만 담당, 실제 마스킹은 글루)
type MaskingPolicy struct {
	// Version 은 변경 추적용 정책 버전(저장 시 운영자가 올리거나 자동 증가).
	Version string `json:"version"`
	// Enabled 가 false 면 마스킹 미적용(CaptureMode 가 full 이면 원문, none 이면 미저장).
	Enabled bool `json:"enabled"`
	// CaptureInput/Output 은 프롬프트/응답을 트레이스에 어떻게 보존할지.
	CaptureInput  CaptureMode `json:"capture_input"`
	CaptureOutput CaptureMode `json:"capture_output"`
	// BlockedCapture 는 차단된 요청의 보존 모드(감사 목적상 원문 보존이 필요할 수 있음).
	// 빈 문자열이면 CaptureInput/Output 을 따른다.
	BlockedCapture CaptureMode `json:"blocked_capture"`
	// Rules 는 PII 유형별 처리(CaptureMode 가 masked 일 때 적용).
	Rules []MaskRule `json:"rules"`
	// UpdatedAt 은 마지막 저장 시각(RFC3339, 서버 설정).
	UpdatedAt string `json:"updated_at,omitempty"`
}

// CaptureMode 는 프롬프트/응답 보존 방식.
type CaptureMode string

const (
	CaptureNone   CaptureMode = "none"   // 저장 안 함(트레이스에 본문 없음)
	CaptureMasked CaptureMode = "masked" // Rules 적용 후 저장
	CaptureFull   CaptureMode = "full"   // 원문 그대로 저장(민감 — 보존/접근통제 필요)
)

// MaskAction 은 탐지된 PII 유형에 대한 처리.
type MaskAction string

const (
	MaskKeep   MaskAction = "keep"   // 그대로 둠
	MaskMask   MaskAction = "mask"   // 부분 가림(예: 010-****-1234)
	MaskHash   MaskAction = "hash"   // 솔트 해시로 대체(비식별)
	MaskRemove MaskAction = "remove" // 완전 제거([REDACTED])
)

// MaskRule 은 PII 유형 1개에 대한 마스킹 규칙.
type MaskRule struct {
	Type   string     `json:"type"`  // rrn|phone|email|account|card|name|address|...
	Label  string     `json:"label"` // 표시명(주민등록번호 등)
	Action MaskAction `json:"action"`
}

// DefaultMaskingPolicy — 금융 기본값: 입출력은 마스킹, 차단건은 감사용 원문 보존,
// 민감 식별자(주민/계좌/카드)는 해시, 연락처/이름/주소는 부분 마스킹.
func DefaultMaskingPolicy() MaskingPolicy {
	return MaskingPolicy{
		Version:        "v1",
		Enabled:        true,
		CaptureInput:   CaptureMasked,
		CaptureOutput:  CaptureMasked,
		BlockedCapture: CaptureFull,
		Rules: []MaskRule{
			{Type: "rrn", Label: "주민등록번호", Action: MaskHash},
			{Type: "account", Label: "계좌번호", Action: MaskHash},
			{Type: "card", Label: "카드번호", Action: MaskHash},
			{Type: "phone", Label: "전화번호", Action: MaskMask},
			{Type: "email", Label: "이메일", Action: MaskMask},
			{Type: "name", Label: "이름", Action: MaskMask},
			{Type: "address", Label: "주소", Action: MaskMask},
		},
	}
}
