package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/capability"
	"github.com/maymust/fabrix-endpoint/internal/diag"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// handleDiagnostics 는 GET /api/v1/diagnostics — 외부 의존성 9종에 능동 프로브를 동시 실행해
// "이 Pod 에서 무엇이 실제로 도달 가능한가"를 반환한다. 실사이트 연동·디버깅의 1차 도구.
//
// 각 의존성: configured(env 구성 여부) → reachable(실제 연결)·latency·error.
// 미구성(optional) 의존성은 프로브를 건너뛰고 폴백 동작을 note 로 안내한다.
func (s *Server) handleDiagnostics(w http.ResponseWriter, r *http.Request) {
	verbose := r.URL.Query().Get("verbose") == "1" // 심층 진단(Details 추가 왕복)

	rep := diag.Run(r.Context(), s.profile, time.Now(), verbose, s.buildProbers())
	// L4 — 파드 네트워크/설정 점검(이름 해석·resolv.conf·in-cluster·프록시·env→호스트).
	rep.Network = diag.BuildNetwork(r.Context(), s.diagDeps)
	// L4 — 최근 이력 적재 + 각 check 에 추세(sparkline) 부착.
	s.hist.Ingest(&rep)
	httpx.JSON(w, http.StatusOK, rep)
}

// handleProbeOne 은 GET /api/v1/diagnostics/{name} — 의존성 1개만 라이브 재프로브(verbose)한다.
// "지금 테스트"(Grafana Save&test / Stripe Send test 패턴) — read-only 라 양 프로파일 공통.
func (s *Server) handleProbeOne(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var target *diag.Prober
	probers := s.buildProbers()
	for i := range probers {
		if probers[i].Name == name {
			target = &probers[i]
			break
		}
	}
	if target == nil {
		httpx.Error(w, http.StatusNotFound, "알 수 없는 의존성: "+name)
		return
	}
	// 캡처 주입 — HTTP 프로브의 실제 요청/응답(헤더·본문)을 1회 기록(마스킹).
	ctx, rec := httpx.WithCapture(r.Context())
	rep := diag.Run(ctx, s.profile, time.Now(), true, []diag.Prober{*target})
	s.hist.Ingest(&rep) // 수동 테스트도 이력에 반영(sparkline)
	if len(rep.Checks) == 0 {
		httpx.Error(w, http.StatusInternalServerError, "프로브 결과 없음")
		return
	}
	st := rep.Checks[0]
	if rec.ReqURL != "" || rec.StatusCode != 0 { // HTTP 프로브였으면 캡처 부착
		st.Probe = &diag.ProbeTrace{
			ReqMethod: rec.ReqMethod, ReqURL: rec.ReqURL, ReqHeaders: rec.ReqHeaders, ReqBody: rec.ReqBody,
			StatusCode: rec.StatusCode, HTTPVersion: rec.HTTPVersion, RespHeaders: rec.RespHeaders, RespBody: rec.RespBody,
		}
	}
	httpx.JSON(w, http.StatusOK, st)
}

// buildProbers 는 외부 의존성 프로브 정의 목록을 만든다(전체 진단·단일 재프로브 공용).
// 각 Prober.Request 는 그 프로브가 API 에 실제로 보내는 요청 명세(표시용, 코드와 1:1).
func (s *Server) buildProbers() []diag.Prober {
	ep := s.diagEP
	return []diag.Prober{
		{
			Name: "victoriametrics", Title: "메트릭 (VictoriaMetrics/vmselect)", Category: "메트릭",
			Endpoint: ep["vm"], Configured: s.dataSource == "live", Optional: true,
			RequiredBy:   []string{capability.Dashboard},
			FallbackNote: "data_source=mock 면 합성 메트릭으로 동작(실연동 불필요). live 일 때만 vmselect 조회.",
			Request:      &diag.ProbeRequest{Method: "GET", Target: "/api/v1/query?query=1", Auth: "none", Expect: "200 · {status:\"success\"}"},
			Probe:        s.probeDashboard,
		},
		{
			Name: "dynamo_upstream", Title: "추론 업스트림 (Dynamo/vLLM OpenAI)", Category: "추론",
			Endpoint: ep["upstream"], Configured: true, Optional: true,
			RequiredBy:   []string{capability.Playground, capability.Models},
			FallbackNote: "도달 불가 시 모델 상태가 unreachable 로 표시. 모델별 상세는 모델 카탈로그 참고.",
			Request:      &diag.ProbeRequest{Method: "GET", Target: "/v1/models", Auth: "none", Expect: "200 · {data:[...]}"},
			Probe:        s.catalog.Probe,
		},
		{
			Name: "semantic_router", Title: "가드레일 (Semantic Router)", Category: "가드레일",
			Endpoint: ep["sr"], Configured: s.guard != nil && s.guard.Enabled(), Optional: true,
			RequiredBy:   []string{capability.Guard, capability.GuardWrite},
			FallbackNote: "미구성 시 모든 요청 통과(차단 없음). 한국어 PII 정규식 1차 보강은 유지.",
			Request:      &diag.ProbeRequest{Method: "POST", Target: "/api/v1/classify/pii", Auth: "none", Body: `{"text":"ping"}`, Expect: "200 · {category,confidence}"},
			Probe:        probeOrNil(s.guard != nil, s.guardProbe),
		},
		{
			Name: "clickhouse_audit", Title: "증적 (ClickHouse guard_audit)", Category: "증적",
			Endpoint: ep["clickhouse"], Configured: s.audit != nil && s.audit.Enabled(), Optional: true,
			RequiredBy:   []string{capability.Guard},
			FallbackNote: "미구성 시 증적 비적재(가드레일 판정 자체는 동작).",
			Request:      &diag.ProbeRequest{Method: "SQL", Target: "SELECT 1", Auth: "Basic", Expect: "1"},
			Probe:        probeOrNil(s.audit != nil, s.auditProbe),
		},
		{
			Name: "clickhouse_usage", Title: "사용량 롤업 (ClickHouse usage_rollup)", Category: "사용량",
			Endpoint: ep["clickhouse"], Configured: s.usage != nil && s.usage.Enabled(), Optional: true,
			RequiredBy:   []string{capability.Dashboard},
			FallbackNote: "미구성 시 사용량 롤업/추세 비적재. 대시보드 일부 위젯은 메트릭으로 대체.",
			Request:      &diag.ProbeRequest{Method: "SQL", Target: "SELECT 1", Auth: "Basic", Expect: "1"},
			Probe:        probeOrNil(s.usage != nil, s.usageProbe),
		},
		{
			Name: "worm", Title: "WORM 불변 보존 (MinIO/ObjectScale Object Lock)", Category: "보존",
			Endpoint: ep["worm"], Configured: s.audit != nil && s.audit.WORMEnabled(), Optional: true,
			RequiredBy:   []string{capability.Guard},
			FallbackNote: "미구성 시 ClickHouse 증적만(불변 보존 없음).",
			Request:      &diag.ProbeRequest{Method: "S3", Target: "HEAD bucket (BucketExists)", Auth: "AccessKey", Expect: "버킷 존재"},
			Probe:        probeOrNil(s.audit != nil, s.wormProbe),
		},
		{
			Name: "langfuse", Title: "트레이스/세션 (Langfuse Public API)", Category: "트레이스",
			Endpoint: ep["langfuse"], Configured: s.lf != nil && s.lf.Configured(), Optional: true,
			RequiredBy:   []string{capability.Traces},
			FallbackNote: "미구성 시 synthetic 트레이스/세션으로 동작(화면은 비지 않음).",
			Request:      &diag.ProbeRequest{Method: "GET", Target: "/api/public/traces?limit=1", Auth: "Basic", Expect: "200 · {data:[...]}"},
			Probe:        probeOrNil(s.lf != nil, s.langfuseProbe),
		},
		{
			Name: "postgresql", Title: "키 스토어 (PostgreSQL/CNPG)", Category: "키스토어",
			Endpoint: ep["postgres"], Configured: s.store != nil, Optional: true,
			RequiredBy:   []string{capability.Keys, capability.Users},
			FallbackNote: "미구성 시 키·앱·사용자(RBAC) 기능 비활성. 나머지 화면은 정상.",
			Request:      &diag.ProbeRequest{Method: "TCP", Target: "Ping (SELECT 1)", Auth: "password", Expect: "연결 OK"},
			Probe:        probeOrNil(s.store != nil, s.storeProbe),
		},
		{
			Name: "harbor", Title: "모델 레지스트리 (Harbor v2.0)", Category: "모델레지스트리",
			Endpoint: ep["harbor"], Configured: s.harbor != nil && s.harbor.Enabled(), Optional: true,
			RequiredBy:   []string{capability.Models, capability.ModelsWrite},
			FallbackNote: "미구성 시 모델 목록/임포트 비활성.",
			Request:      &diag.ProbeRequest{Method: "GET", Target: "/api/v2.0/projects?page_size=1", Auth: "Basic", Expect: "200 · JSON array"},
			Probe:        probeOrNil(s.harbor != nil, s.harborProbe),
			Details:      detailsOrNil(s.harbor != nil, s.harborDetails), // verbose: 레지스트리 버전·프로젝트 수
		},
		{
			Name: "kubernetes", Title: "엔드포인트 오케스트레이션 (kubectl → K8s API)", Category: "오케스트레이션",
			Endpoint: "kubectl → in-cluster API", Configured: s.k8s != nil && s.k8s.Enabled(), Optional: true,
			RequiredBy:   []string{capability.Endpoints, capability.EndpointsWrite},
			FallbackNote: "미구성 시 엔드포인트 조회/배포 비활성. RBAC 로 /healthz 접근 거부 시 에러 노출.",
			Request:      &diag.ProbeRequest{Method: "EXEC", Target: "kubectl get --raw=/healthz", Auth: "ServiceAccount", Expect: "ok"},
			Probe:        probeOrNil(s.k8s != nil, s.k8sProbe),
		},
	}
}

// harborDetails 는 verbose 모드 심층 진단(레지스트리 호스트·프로젝트·모델 수).
func (s *Server) harborDetails(ctx context.Context) map[string]any { return s.harbor.Status(ctx) }

// detailsOrNil 은 클라이언트 미존재 시 Details 를 비활성(nil)으로 둔다.
func detailsOrNil(present bool, fn func(context.Context) map[string]any) func(context.Context) map[string]any {
	if !present {
		return nil
	}
	return fn
}

// probeDashboard 는 dashboard provider 가 live 일 때만 Probe 를 위임한다(mock 은 프로브 불필요).
func (s *Server) probeDashboard(ctx context.Context) error {
	if p, ok := s.dashboard.(interface{ Probe(context.Context) error }); ok {
		return p.Probe(ctx)
	}
	return fmt.Errorf("live provider 아님(mock)")
}

// 아래 래퍼들은 nil 리시버 호출을 피하기 위한 얇은 어댑터(Configured=false 면 Run 이 건너뜀).
func (s *Server) guardProbe(ctx context.Context) error    { return s.guard.Probe(ctx) }
func (s *Server) auditProbe(ctx context.Context) error    { return s.audit.Probe(ctx) }
func (s *Server) usageProbe(ctx context.Context) error    { return s.usage.Probe(ctx) }
func (s *Server) wormProbe(ctx context.Context) error     { return s.audit.ProbeWORM(ctx) }
func (s *Server) langfuseProbe(ctx context.Context) error { return s.lf.Probe(ctx) }
func (s *Server) storeProbe(ctx context.Context) error    { return s.store.Probe(ctx) }
func (s *Server) harborProbe(ctx context.Context) error   { return s.harbor.Probe(ctx) }
func (s *Server) k8sProbe(ctx context.Context) error      { return s.k8s.Probe(ctx) }

// probeOrNil 은 클라이언트 포인터가 nil 이면 프로브를 비활성(nil)으로 둔다.
func probeOrNil(present bool, fn func(context.Context) error) func(context.Context) error {
	if !present {
		return nil
	}
	return fn
}
