// Package domain 은 FABRIX Endpoint 의 핵심 도메인 타입을 정의한다.
// 문서(Single Source of Truth)의 Part 1(귀속 모델)·Part 2(증적)·Part 3(메트릭)
// 스키마를 Go 타입으로 옮긴 것이다.
package domain

// 관통 식별자 (문서 Part 0) — 증적·메트릭·대시보드를 잇는 4개 축.
// 모든 집계/조회의 공통 차원이다.
type Attribution struct {
	// UserRef = x-user-id(sessionID) 의 salted SHA-256 해시. 보안 클레임 아님(상관관계 핸들).
	// 메트릭 라벨로는 금지(고카디널리티) — 트레이스/증적 경로에서만 사용한다.
	UserRef string `json:"user_ref,omitempty"`
	// EmployeeID 는 MVP 에선 NULL. 사내 DB 연동 후 sessionID→직원 매핑으로 소급 enrich.
	EmployeeID string `json:"employee_id,omitempty"`
	DeptID     string `json:"dept_id,omitempty"`
	// AppID 는 API 키→앱 매핑이 1순위, x-fabrix-app-id 헤더는 보조.
	AppID    string `json:"app_id,omitempty"`
	APIKeyID string `json:"api_key_id,omitempty"`
	Model    string `json:"model,omitempty"`
}

// TimeRange 는 대시보드/리포트의 조회 기간을 나타낸다.
type TimeRange string

const (
	Range1h  TimeRange = "1h"
	Range6h  TimeRange = "6h"
	Range24h TimeRange = "24h"
	Range7d  TimeRange = "7d"
)

// ParseRange 는 쿼리 파라미터를 검증된 TimeRange 로 변환한다. 미지정/불명은 1h.
func ParseRange(s string) TimeRange {
	switch TimeRange(s) {
	case Range6h:
		return Range6h
	case Range24h:
		return Range24h
	case Range7d:
		return Range7d
	default:
		return Range1h
	}
}

// Buckets 는 해당 기간을 시계열 차트에서 몇 개의 점으로 나눌지 반환한다.
func (r TimeRange) Buckets() int {
	switch r {
	case Range6h:
		return 72 // 5분 버킷
	case Range24h:
		return 96 // 15분 버킷
	case Range7d:
		return 168 // 1시간 버킷
	default: // 1h
		return 60 // 1분 버킷
	}
}

// StepSeconds 는 시계열 버킷 간격(초).
func (r TimeRange) StepSeconds() int {
	switch r {
	case Range6h:
		return 5 * 60
	case Range24h:
		return 15 * 60
	case Range7d:
		return 60 * 60
	default: // 1h
		return 60
	}
}
