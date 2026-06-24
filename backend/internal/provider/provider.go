// Package provider 는 대시보드/리포트 데이터의 소스를 추상화한다.
//
// MVP 는 mock 구현(internal/provider/mock)을 주입한다. 실제 환경에서는
// Prometheus(메트릭)·ClickHouse(증적/롤업 미러) 클라이언트를 구현한 live 제공자로
// 교체하면 핸들러·프론트는 불변이다. (문서 §3 스크레이프 타깃 / §2-4 조회 미러)
package provider

import (
	"context"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// Dashboard 는 관제 대시보드(문서 4-1) 화면이 필요로 하는 데이터를 제공한다.
type Dashboard interface {
	// Overview 는 4카드 + 부서/앱 분포 + 알람을 반환한다.
	Overview(ctx context.Context, rng domain.TimeRange) (domain.DashboardOverview, error)
	// Timeseries 는 QPS / TTFT p95 / 차단 시계열을 반환한다.
	Timeseries(ctx context.Context, rng domain.TimeRange) (domain.Timeseries, error)
	// Usage 는 사용량·귀속 리포트(4-2)를 반환한다. (현재 그룹 = model)
	Usage(ctx context.Context, rng domain.TimeRange) (domain.UsageReport, error)
}
