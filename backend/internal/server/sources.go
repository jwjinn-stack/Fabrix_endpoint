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

// EvalStore 는 평가 데이터셋·실험(배치 채점 레코드) 영속(IMP-39). DataStore 와 동일한 seam 식 —
// mock 은 internal/mockstore 인메모리, live 는 후속에서 PostgreSQL 구현으로 교체. 핸들러는 불변.
// v1 은 소량 동기 배치라 단순 CRUD; SaveExperiment 는 이전 run 을 보존(append)해 run-vs-run 비교를 가능케 한다.
type EvalStore interface {
	ListDatasets(ctx context.Context) ([]EvalDataset, error)
	CreateDataset(ctx context.Context, d EvalDataset) (EvalDataset, error)
	GetDataset(ctx context.Context, id string) (EvalDataset, bool)
	ListExperiments(ctx context.Context) ([]Experiment, error)
	SaveExperiment(ctx context.Context, e Experiment) (Experiment, error)
}

// UsageSource 는 사용량 롤업(귀속·추세) 조회·적재(원래 *usage.Sink).
type UsageSource interface {
	Enabled() bool
	Enqueue(e usage.Event)
	QueryRollup(ctx context.Context, rng domain.TimeRange, group string) ([]domain.UsageRow, error)
	QueryTrend(ctx context.Context, rng domain.TimeRange) (domain.UsageTrend, error)
	Probe(ctx context.Context) error
}
