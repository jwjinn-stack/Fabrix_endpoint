package server

import (
	"context"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/usage"
)

// 데이터 소스 seam — 핸들러는 이 인터페이스에만 의존한다.
// 운영(live)에서는 PostgreSQL(*store.Store)·ClickHouse(*usage.Sink) 구현이,
// 로컬 기능테스트(mock)에서는 internal/mockstore 의 인메모리 구현이 주입된다.
// 실제 K8s/DB 연동 시 와이어링(cmd/api/main.go)만 바꾸면 되고 핸들러는 불변이다.

// DataStore 는 키·앱·사용자·조직·마스킹 마스터 데이터 접근(원래 *store.Store).
type DataStore interface {
	ListKeys(ctx context.Context) ([]domain.APIKeyView, error)
	IssueKey(ctx context.Context, req domain.IssueKeyRequest) (domain.IssuedKey, error)
	KeyQuota(ctx context.Context, keyID string) (domain.KeyQuota, error)
	RevokeKey(ctx context.Context, keyID string) error
	ListUsers(ctx context.Context) ([]domain.User, error)
	CreateUser(ctx context.Context, req domain.UserUpsertRequest) (domain.User, error)
	UpdateUser(ctx context.Context, id string, req domain.UserUpsertRequest) error
	DeleteUser(ctx context.Context, id string) error
	DeptForUser(ctx context.Context, email string) (string, bool)
	OrgTree(ctx context.Context) (domain.OrgTree, error)
	SetAppDept(ctx context.Context, appID, deptID string) error
	GetMaskingPolicy(ctx context.Context) (domain.MaskingPolicy, error)
	SetMaskingPolicy(ctx context.Context, p domain.MaskingPolicy) error
	Probe(ctx context.Context) error
}

// UsageSource 는 사용량 롤업(귀속·추세) 조회·적재(원래 *usage.Sink).
type UsageSource interface {
	Enabled() bool
	Enqueue(e usage.Event)
	QueryRollup(ctx context.Context, rng domain.TimeRange, group string) ([]domain.UsageRow, error)
	QueryTrend(ctx context.Context, rng domain.TimeRange) (domain.UsageTrend, error)
	Probe(ctx context.Context) error
}
