// Package server 는 FABRIX Endpoint API(BFF)의 HTTP 라우팅과 핸들러를 구성한다.
package server

import (
	"net/http"

	"github.com/maymust/fabrix-endpoint/internal/audit"
	"github.com/maymust/fabrix-endpoint/internal/catalog"
	"github.com/maymust/fabrix-endpoint/internal/config"
	"github.com/maymust/fabrix-endpoint/internal/guard"
	"github.com/maymust/fabrix-endpoint/internal/harbor"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
	"github.com/maymust/fabrix-endpoint/internal/k8s"
	"github.com/maymust/fabrix-endpoint/internal/provider"
	"github.com/maymust/fabrix-endpoint/internal/proxystats"
	"github.com/maymust/fabrix-endpoint/internal/quota"
	"github.com/maymust/fabrix-endpoint/internal/store"
	"github.com/maymust/fabrix-endpoint/internal/usage"
)

// Server 는 의존성(데이터 제공자·카탈로그·스토어·가드레일·증적·롤업·설정)을 들고 라우터를 만든다.
type Server struct {
	dashboard  provider.Dashboard
	catalog    *catalog.Catalog
	store      *store.Store // nil 가능(DB 미구성 시 키 기능 비활성)
	guard      *guard.Client
	audit      *audit.Sink
	usage      *usage.Sink
	quota      *quota.Limiter
	k8s        *k8s.Client
	harbor     *harbor.Client
	pstats     *proxystats.Collector
	dataSource string
	allowed    []string
}

// New 는 주입된 의존성으로 Server 를 만든다. st 는 nil 일 수 있다.
func New(cfg config.Config, dashboard provider.Dashboard, cat *catalog.Catalog, st *store.Store, gc *guard.Client, as *audit.Sink, us *usage.Sink, kc *k8s.Client, hc *harbor.Client) *Server {
	return &Server{
		dashboard:  dashboard,
		catalog:    cat,
		store:      st,
		guard:      gc,
		audit:      as,
		usage:      us,
		quota:      quota.New(),
		k8s:        kc,
		harbor:     hc,
		pstats:     proxystats.New(),
		dataSource: cfg.DataSource,
		allowed:    cfg.AllowedOrigins,
	}
}

// Handler 는 미들웨어가 적용된 최종 http.Handler 를 반환한다.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// MVP — 관제 대시보드(4-1)
	mux.HandleFunc("GET /api/v1/healthz", s.handleHealthz)
	mux.HandleFunc("GET /api/v1/dashboard/overview", s.handleOverview)
	mux.HandleFunc("GET /api/v1/dashboard/timeseries", s.handleTimeseries)
	mux.HandleFunc("GET /api/v1/usage", s.handleUsage)
	mux.HandleFunc("GET /api/v1/usage/trend", s.handleUsageTrend)
	mux.HandleFunc("GET /api/v1/gpu", s.handleGPU)
	mux.HandleFunc("GET /api/v1/gpu/timeseries", s.handleGPUTimeseries)

	// 모델 카탈로그 → 플레이그라운드 (Fireworks/Together 벤치마킹)
	mux.HandleFunc("GET /api/v1/models", s.handleModels)
	mux.HandleFunc("GET /api/v1/models/metrics", s.handleModelMetrics)
	mux.HandleFunc("POST /api/v1/playground/chat", s.handlePlaygroundChat)

	// 키·앱 관리 (엔드포인트 발급 — Nutanix Create API Key 플로우)
	mux.HandleFunc("GET /api/v1/keys", s.handleListKeys)
	mux.HandleFunc("POST /api/v1/keys", s.handleIssueKey)
	mux.HandleFunc("DELETE /api/v1/keys/{id}", s.handleRevokeKey)

	// 가드레일 증적 (4-3) — Semantic Router 판정 → ClickHouse guard_audit
	mux.HandleFunc("GET /api/v1/guard/audit", s.handleGuardAudit)
	mux.HandleFunc("GET /api/v1/guard/status", s.handleGuardStatus)
	mux.HandleFunc("POST /api/v1/guard/classify", s.handleGuardClassify)
	mux.HandleFunc("GET /api/v1/guard/policy", s.handleGetPolicy)
	mux.HandleFunc("PUT /api/v1/guard/policy", s.handleSetPolicy)

	// 트래픽/프록시 뷰 (4-5) — 프록시 실측 통계(가드레일/업스트림 지연·오버헤드·차단율)
	mux.HandleFunc("GET /api/v1/proxy/stats", s.handleProxyStats)
	mux.HandleFunc("GET /api/v1/proxy/pipeline", s.handleEnginePipeline)

	// 프롬프트/평가 (LLM-as-judge, #17)
	mux.HandleFunc("POST /api/v1/eval/run", s.handleEvalRun)

	// 조직·귀속 (부서→앱→키→사용자) + 앱 소속 부서 설정
	mux.HandleFunc("GET /api/v1/org", s.handleOrg)
	mux.HandleFunc("PUT /api/v1/apps/{id}/dept", s.handleSetAppDept)

	// RBAC/Users (2-13) — 사용자·역할·부서 매핑
	mux.HandleFunc("GET /api/v1/users", s.handleListUsers)
	mux.HandleFunc("POST /api/v1/users", s.handleCreateUser)
	mux.HandleFunc("PUT /api/v1/users/{id}", s.handleUpdateUser)
	mux.HandleFunc("DELETE /api/v1/users/{id}", s.handleDeleteUser)

	// 엔드포인트(모델 배포) — DynamoGraphDeployment CR (생성 위저드)
	mux.HandleFunc("GET /api/v1/endpoints", s.handleListEndpoints)
	mux.HandleFunc("POST /api/v1/endpoints/preview", s.handlePreviewEndpoint)
	mux.HandleFunc("POST /api/v1/endpoints", s.handleCreateEndpoint)
	mux.HandleFunc("DELETE /api/v1/endpoints/{ns}/{name}", s.handleDeleteEndpoint)
	mux.HandleFunc("GET /api/v1/endpoints/{ns}/{name}/logs", s.handleEndpointLogs)

	// Harbor 모델 레지스트리 — 모델 목록·상태·HF 임포트(Nutanix Models 패턴)
	mux.HandleFunc("GET /api/v1/harbor/models", s.handleHarborModels)
	mux.HandleFunc("GET /api/v1/harbor/status", s.handleHarborStatus)
	mux.HandleFunc("POST /api/v1/harbor/import", s.handleHarborImport)

	// 서드파티 자격증명 — HF Model Hub 토큰·NVIDIA NGC 키(모델 임포트 다운로드용). Nutanix Settings 패턴.
	mux.HandleFunc("GET /api/v1/credentials", s.handleGetCredentials)
	mux.HandleFunc("PUT /api/v1/credentials", s.handleSetCredential)

	return httpx.Chain(mux,
		httpx.Logger,
		httpx.CORS(s.allowed),
	)
}
