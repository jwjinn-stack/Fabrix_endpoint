package domain

// 조직·귀속 트리 — 부서 → 앱 → 키, + 부서별 사용자.
// "이 앱/키가 어느 부서 소속인가"를 한 곳에서 보고 관리(app.dept_id 기준).

// OrgKey — 앱에 속한 API 키 요약.
type OrgKey struct {
	APIKeyID  string `json:"api_key_id"`
	Name      string `json:"name"`
	KeyPrefix string `json:"key_prefix"`
	Enabled   bool   `json:"enabled"`
}

// OrgApp — 부서에 속한 앱(+키 목록).
type OrgApp struct {
	AppID  string   `json:"app_id"`
	Name   string   `json:"name"`
	DeptID string   `json:"dept_id"` // "" = 미귀속
	Keys   []OrgKey `json:"keys"`
}

// OrgMember — 부서 소속 사용자 요약.
type OrgMember struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	Status string `json:"status"`
}

// OrgDept — 부서 1개(앱+사용자). DeptID "" 는 "미귀속" 버킷.
type OrgDept struct {
	DeptID  string      `json:"dept_id"`
	Apps    []OrgApp    `json:"apps"`
	Members []OrgMember `json:"members"`
}

// OrgTree — 전체 조직 트리 + 부서 후보 목록(셀렉트용).
type OrgTree struct {
	Depts      []OrgDept `json:"depts"`
	KnownDepts []string  `json:"known_depts"`
}
