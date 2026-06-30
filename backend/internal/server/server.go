// Package server 는 FABRIX Endpoint API(BFF)의 HTTP 라우팅과 핸들러를 구성한다.
package server

import (
	"net/http"

	"github.com/maymust/fabrix-endpoint/internal/audit"
	"github.com/maymust/fabrix-endpoint/internal/capability"
	"github.com/maymust/fabrix-endpoint/internal/catalog"
	"github.com/maymust/fabrix-endpoint/internal/config"
	"github.com/maymust/fabrix-endpoint/internal/diag"
	"github.com/maymust/fabrix-endpoint/internal/guard"
	"github.com/maymust/fabrix-endpoint/internal/harbor"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
	"github.com/maymust/fabrix-endpoint/internal/k8s"
	"github.com/maymust/fabrix-endpoint/internal/langfuse"
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
	lf         *langfuse.Client // 트레이스/세션/가드레일 원문 (Langfuse 정합; 미설정 시 synthetic)
	caps       capability.Set   // 배포 프로파일에서 해석된 기능 집합(라우트 조건부 등록의 기준)
	profile    string
	dataSource string
	allowed    []string
	cfg        config.Config      // 셀프-reconfigure(A1) — 편집 가능 설정 현재값·self-identity
	diagEP     map[string]string  // 진단 표시용(자격증명 제거된) 의존성 엔드포인트
	hist       *diag.History      // 진단 이력(추세 sparkline) — 인메모리
	diagDeps   []diag.DepEndpoint // 네트워크/설정 점검용(name+env+rawURL; 내부에서만 파싱)
}

// New 는 주입된 의존성으로 Server 를 만든다. st 는 nil 일 수 있다.
// caps 는 배포 프로파일(observe|manage)에서 해석된 기능 집합 — 어떤 라우트를 등록할지 결정한다.
func New(cfg config.Config, caps capability.Set, dashboard provider.Dashboard, cat *catalog.Catalog, st *store.Store, gc *guard.Client, as *audit.Sink, us *usage.Sink, kc *k8s.Client, hc *harbor.Client, lf *langfuse.Client) *Server {
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
		lf:         lf,
		caps:       caps,
		profile:    cfg.Profile,
		dataSource: cfg.DataSource,
		allowed:    cfg.AllowedOrigins,
		cfg:        cfg,
		diagEP: map[string]string{
			"vm":         diag.Redact(cfg.VMSelectURL),
			"upstream":   diag.Redact(cfg.GemmaUpstream),
			"clickhouse": diag.Redact(cfg.ClickHouseURL),
			"sr":         diag.Redact(cfg.SRURL),
			"langfuse":   diag.Redact(cfg.LangfuseHost),
			"postgres":   diag.Redact(cfg.DatabaseURL),
			"harbor":     diag.Redact(cfg.HarborURL),
			"worm":       diag.Redact(cfg.WORMURL),
		},
		hist: diag.NewHistory(50),
		// 네트워크/설정 점검 대상(원문 URL 은 BuildNetwork 내부에서만 파싱 → host 만 노출).
		// kubernetes 는 호스트 기반이 아니라(in-cluster API) Network.APIServer 로 별도 표시.
		diagDeps: []diag.DepEndpoint{
			{Name: "victoriametrics", EnvKey: "FABRIX_VMSELECT_URL", RawURL: cfg.VMSelectURL},
			{Name: "dynamo_upstream", EnvKey: "FABRIX_GEMMA_UPSTREAM", RawURL: cfg.GemmaUpstream},
			{Name: "semantic_router", EnvKey: "FABRIX_SR_URL", RawURL: cfg.SRURL},
			{Name: "clickhouse", EnvKey: "FABRIX_CLICKHOUSE_URL", RawURL: cfg.ClickHouseURL},
			{Name: "worm", EnvKey: "FABRIX_WORM_URL", RawURL: cfg.WORMURL},
			{Name: "langfuse", EnvKey: "FABRIX_LANGFUSE_HOST", RawURL: cfg.LangfuseHost},
			{Name: "postgresql", EnvKey: "FABRIX_DATABASE_URL", RawURL: cfg.DatabaseURL},
			{Name: "harbor", EnvKey: "FABRIX_HARBOR_URL", RawURL: cfg.HarborURL},
		},
	}
}

// Handler 는 미들웨어가 적용된 최종 http.Handler 를 반환한다.
//
// 라우트는 배포 프로파일에서 해석된 기능 집합(s.caps)에 따라 조건부 등록된다.
// observe 프로파일은 mutating cap 이 전부 꺼져 있어 생성/변경/삭제 라우트가 아예
// 등록되지 않는다 → 호출 시 404(공격 표면 제거). 미등록이 실제 차단을 담당한다.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	can := s.caps.Can

	// 상태·기능 노출 — 항상 등록. 프론트가 /capabilities 로 메뉴·버튼을 토글하고,
	// /diagnostics 로 외부 의존성 실연동 상태(능동 프로브)를 보여준다(양쪽 프로파일 공통).
	mux.HandleFunc("GET /api/v1/healthz", s.handleHealthz)
	mux.HandleFunc("GET /api/v1/capabilities", s.handleCapabilities)
	mux.HandleFunc("GET /api/v1/diagnostics", s.handleDiagnostics)
	mux.HandleFunc("GET /api/v1/diagnostics/{name}", s.handleProbeOne) // 단일 라이브 재프로브("지금 테스트")

	// 관제 대시보드(4-1) + 트래픽/프록시 뷰(4-5) — dashboard cap.
	if can(capability.Dashboard) {
		mux.HandleFunc("GET /api/v1/dashboard/overview", s.handleOverview)
		mux.HandleFunc("GET /api/v1/dashboard/timeseries", s.handleTimeseries)
		mux.HandleFunc("GET /api/v1/usage", s.handleUsage)
		mux.HandleFunc("GET /api/v1/usage/trend", s.handleUsageTrend)
		mux.HandleFunc("GET /api/v1/gpu", s.handleGPU)
		mux.HandleFunc("GET /api/v1/gpu/timeseries", s.handleGPUTimeseries)
		mux.HandleFunc("GET /api/v1/proxy/stats", s.handleProxyStats)
		mux.HandleFunc("GET /api/v1/proxy/pipeline", s.handleEnginePipeline)
		mux.HandleFunc("GET /api/v1/metrics/breakdown", s.handleMetricsBreakdown) // L2 차원 groupby
		mux.HandleFunc("GET /api/v1/metrics/dimensions", s.handleMetricDimensions)

		// FABRIX MCP(C7, read-only) — AI 에이전트가 대시보드 메트릭·차원·인사이트를 질의(JSON-RPC 2.0).
		// 4개 tool 이 모두 s.dashboard 데이터를 쓰므로 Dashboard cap 게이트 안에 등록한다:
		// "대시보드를 못 보면 MCP 로도 못 본다"(observe 읽기전용 정합성 — 미등록이 실제 차단).
		mux.HandleFunc("POST /api/v1/mcp", s.handleMCP)
	}

	// 모델 카탈로그 + Harbor 레지스트리 조회 — models cap.
	if can(capability.Models) {
		mux.HandleFunc("GET /api/v1/models", s.handleModels)
		mux.HandleFunc("GET /api/v1/models/metrics", s.handleModelMetrics)
		mux.HandleFunc("GET /api/v1/harbor/models", s.handleHarborModels)
		mux.HandleFunc("GET /api/v1/harbor/status", s.handleHarborStatus)
	}
	// 모델 임포트(HF 다운로드 Job 생성) — models.write cap.
	if can(capability.ModelsWrite) {
		mux.HandleFunc("POST /api/v1/harbor/import", s.handleHarborImport)
	}

	// 플레이그라운드 / 평가 — 각각 업스트림 호출·증적을 일으키므로 별도 cap.
	if can(capability.Playground) {
		mux.HandleFunc("POST /api/v1/playground/chat", s.handlePlaygroundChat)
	}
	if can(capability.Eval) {
		mux.HandleFunc("POST /api/v1/eval/run", s.handleEvalRun)
	}

	// 가드레일 증적(4-3) — Semantic Router 판정 → ClickHouse guard_audit. 조회는 read cap.
	if can(capability.Guard) {
		mux.HandleFunc("GET /api/v1/guard/audit", s.handleGuardAudit)
		mux.HandleFunc("GET /api/v1/guard/status", s.handleGuardStatus)
		mux.HandleFunc("GET /api/v1/guard/policy", s.handleGetPolicy)
		// 차단 프롬프트 원문 (Langfuse GUARDRAIL observation.input — SR 은 원문 미보존)
		mux.HandleFunc("GET /api/v1/guard/content", s.handleGuardContent)
		// 마스킹 정책 조회 — 게이트웨이 글루가 폴링(ingestion 전 캡처/마스킹 적용).
		mux.HandleFunc("GET /api/v1/masking/policy", s.handleGetMaskingPolicy)
	}
	// 정책 변경(PUT)·분류 테스트(POST) — guard.write cap. observe 는 GET 만 노출.
	if can(capability.GuardWrite) {
		mux.HandleFunc("PUT /api/v1/guard/policy", s.handleSetPolicy)
		mux.HandleFunc("POST /api/v1/guard/classify", s.handleGuardClassify)
		// 마스킹 정책 편집(설정 화면).
		mux.HandleFunc("PUT /api/v1/masking/policy", s.handleSetMaskingPolicy)
	}

	// 트레이스 / 세션 (Langfuse 정합) — observe·manage 양쪽 핵심. traces cap.
	if can(capability.Traces) {
		mux.HandleFunc("GET /api/v1/traces", s.handleTraces)
		mux.HandleFunc("GET /api/v1/traces/{id}", s.handleTrace)
		mux.HandleFunc("GET /api/v1/sessions", s.handleSessions)
		mux.HandleFunc("GET /api/v1/sessions/{id}", s.handleSession)
	}

	// 키·앱 관리 (엔드포인트 발급 — Nutanix Create API Key 플로우).
	if can(capability.Keys) {
		mux.HandleFunc("GET /api/v1/keys", s.handleListKeys)
	}
	if can(capability.KeysWrite) {
		mux.HandleFunc("POST /api/v1/keys", s.handleIssueKey)
		mux.HandleFunc("DELETE /api/v1/keys/{id}", s.handleRevokeKey)
	}

	// 조직·귀속 + RBAC/Users (2-13) — 조회는 users(read), 변경은 users.write.
	if can(capability.Users) {
		mux.HandleFunc("GET /api/v1/org", s.handleOrg)
		mux.HandleFunc("GET /api/v1/users", s.handleListUsers)
	}
	if can(capability.UsersWrite) {
		mux.HandleFunc("PUT /api/v1/apps/{id}/dept", s.handleSetAppDept)
		mux.HandleFunc("POST /api/v1/users", s.handleCreateUser)
		mux.HandleFunc("PUT /api/v1/users/{id}", s.handleUpdateUser)
		mux.HandleFunc("DELETE /api/v1/users/{id}", s.handleDeleteUser)
	}

	// 엔드포인트(모델 배포) — DynamoGraphDeployment CR. 목록·로그는 read, 생성·삭제는 write.
	if can(capability.Endpoints) {
		mux.HandleFunc("GET /api/v1/endpoints", s.handleListEndpoints)
		mux.HandleFunc("GET /api/v1/endpoints/{ns}/{name}/logs", s.handleEndpointLogs)
	}
	if can(capability.EndpointsWrite) {
		mux.HandleFunc("POST /api/v1/endpoints/preview", s.handlePreviewEndpoint)
		mux.HandleFunc("POST /api/v1/endpoints", s.handleCreateEndpoint)
		mux.HandleFunc("DELETE /api/v1/endpoints/{ns}/{name}", s.handleDeleteEndpoint)
	}

	// 서드파티 자격증명 — HF Model Hub 토큰·NVIDIA NGC 키. 민감 정보라 단일 cap(조회·설정).
	if can(capability.Credentials) {
		mux.HandleFunc("GET /api/v1/credentials", s.handleGetCredentials)
		mux.HandleFunc("PUT /api/v1/credentials", s.handleSetCredential)
		// 셀프-reconfigure(A1) — 화면에서 연동 설정 편집 → ConfigMap patch + rollout restart.
		mux.HandleFunc("GET /api/v1/config", s.handleGetConfig)
		mux.HandleFunc("PUT /api/v1/config", s.handleSetConfig)
		mux.HandleFunc("GET /api/v1/config/status", s.handleConfigStatus)
	}

	return httpx.Chain(mux,
		httpx.Logger,
		httpx.CORS(s.allowed),
	)
}

// handleCapabilities 는 GET /api/v1/capabilities — 배포 프로파일·기능 집합·연동 상태를
// 반환한다. 프론트가 부팅 시 받아 NAV·버튼·페이지 접근을 토글한다.
func (s *Server) handleCapabilities(w http.ResponseWriter, _ *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"profile":      s.profile,
		"readonly":     s.caps.Readonly(),
		"capabilities": s.caps,
		"data_source":  s.dataSource,
		"integrations": map[string]bool{
			"k8s":      s.k8s != nil && s.k8s.Enabled(),
			"store":    s.store != nil,
			"langfuse": s.lf != nil && s.lf.Configured(),
			"guard":    s.guard != nil && s.guard.Enabled(),
			"audit":    s.audit != nil && s.audit.Enabled(),
			"harbor":   s.harbor != nil && s.harbor.Enabled(),
		},
	})
}
