package domain

// RBAC/Users (문서 2-13). 역할: admin | user | super. Nutanix Admin·Backend.AI Credentials 패턴.

// User — 사용자 1행.
type User struct {
	UserID    string `json:"user_id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Role      string `json:"role"`    // admin | user | super
	DeptID    string `json:"dept_id"`
	Status    string `json:"status"`  // active | disabled
	CreatedAt string `json:"created_at"`
}

// UserUpsertRequest — 사용자 생성/수정 요청.
type UserUpsertRequest struct {
	Email  string `json:"email"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	DeptID string `json:"dept_id"`
	Status string `json:"status,omitempty"`
}
