package server

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

func nowTime() time.Time { return time.Now().UTC() }

func parseIntSafe(s string) (int, error) { return strconv.Atoi(s) }

func emptyUsageReport(rng domain.TimeRange, group string) domain.UsageReport {
	return domain.UsageReport{
		Range:       rng,
		GeneratedAt: nowRFC3339(),
		GroupBy:     group,
		Rows:        []domain.UsageRow{},
	}
}

// handleOverview 는 GET /api/v1/dashboard/overview (문서 4-1).
// 가드레일 카드는 증적(guard_audit) 요약으로 채운다(메트릭 소스와 분리된 증적 소스).
func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	rng := domain.ParseRange(r.URL.Query().Get("range"))
	data, err := s.dashboard.Overview(r.Context(), rng)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "overview 조회 실패")
		return
	}
	if s.audit != nil && s.audit.Enabled() {
		if rep, err := s.audit.Query(r.Context(), rng, "", ""); err == nil {
			data.Guardrail = domain.GuardrailCard{
				Blocked:   rep.Summary.Blocked,
				PII:       rep.Summary.PII,
				Jailbreak: rep.Summary.Jailbreak,
				Flagged:   rep.Summary.Flagged,
			}
		}
	}
	// 부서/앱 분포는 usage_rollup 귀속 집계로 채운다(메트릭 라벨로는 불가, #4).
	if s.usage != nil && s.usage.Enabled() {
		if dept, err := s.usage.QueryRollup(r.Context(), rng, "dept"); err == nil && len(dept) > 0 {
			data.DeptUsage = toDeptUsage(dept)
		}
		if app, err := s.usage.QueryRollup(r.Context(), rng, "app"); err == nil && len(app) > 0 {
			data.AppUsage = toAppUsage(app)
		}
		// Top5 엔드포인트(모델)·API 키 랭킹 (P4-1, Nutanix 패턴).
		if eps, err := s.usage.QueryRollup(r.Context(), rng, "model"); err == nil && len(eps) > 0 {
			data.TopEndpoints = toRankRows(eps, "model", nil)
		}
		if keys, err := s.usage.QueryRollup(r.Context(), rng, "api_key"); err == nil && len(keys) > 0 {
			data.TopKeys = toRankRows(keys, "api_key", s.keyLabels(r.Context()))
		}
	}
	if data.TopEndpoints == nil {
		data.TopEndpoints = []domain.RankRow{}
	}
	if data.TopKeys == nil {
		data.TopKeys = []domain.RankRow{}
	}
	httpx.JSON(w, http.StatusOK, data)
}

// toRankRows 는 rollup 상위 행을 Top-5 랭킹 카드로 변환한다(P4-1).
// kind=model → 엔드포인트(모델), kind=api_key → 키. labels 로 키 id 를 표시명으로 치환.
func toRankRows(rows []domain.UsageRow, kind string, labels map[string]string) []domain.RankRow {
	out := []domain.RankRow{}
	for i, row := range rows {
		if i >= 5 {
			break
		}
		var key, label string
		switch kind {
		case "model":
			key = row.Model
			label = shortModelName(row.Model)
		case "api_key":
			key = row.APIKeyID
			label = key
			if labels != nil {
				if l, ok := labels[key]; ok && l != "" {
					label = l
				}
			}
		}
		out = append(out, domain.RankRow{
			Key:      key,
			Label:    label,
			Requests: row.Requests,
			Tokens:   row.PromptTokens + row.CompletionTokens,
		})
	}
	return out
}

// shortModelName 은 "Qwen/Qwen3-30B-A3B" → "Qwen3-30B-A3B" 처럼 org prefix 를 제거한다.
func shortModelName(m string) string {
	if i := strings.LastIndex(m, "/"); i >= 0 && i+1 < len(m) {
		return m[i+1:]
	}
	return m
}

// keyLabels 는 api_key_id → 표시명(앱·키이름·prefix) 맵을 만든다(store 있으면).
func (s *Server) keyLabels(ctx context.Context) map[string]string {
	if s.store == nil {
		return nil
	}
	keys, err := s.store.ListKeys(ctx)
	if err != nil {
		return nil
	}
	m := make(map[string]string, len(keys))
	for _, k := range keys {
		label := k.Name
		if k.AppName != "" {
			label = k.AppName + " · " + k.Name
		}
		if k.KeyPrefix != "" {
			label += " (" + k.KeyPrefix + "…)"
		}
		m[k.APIKeyID] = label
	}
	return m
}

// toDeptUsage 는 rollup 행을 분포(percent)로 변환한다(Top 6).
func toDeptUsage(rows []domain.UsageRow) []domain.DeptUsage {
	total := int64(0)
	for _, r := range rows {
		total += r.Requests
	}
	out := []domain.DeptUsage{}
	for i, r := range rows {
		if i >= 6 {
			break
		}
		p := 0.0
		if total > 0 {
			p = float64(r.Requests) / float64(total)
		}
		out = append(out, domain.DeptUsage{DeptID: r.DeptID, Name: r.DeptID, Percent: round2(p)})
	}
	return out
}

func toAppUsage(rows []domain.UsageRow) []domain.AppUsage {
	total := int64(0)
	for _, r := range rows {
		total += r.Requests
	}
	out := []domain.AppUsage{}
	for i, r := range rows {
		if i >= 6 {
			break
		}
		p := 0.0
		if total > 0 {
			p = float64(r.Requests) / float64(total)
		}
		out = append(out, domain.AppUsage{AppID: r.AppID, Percent: round2(p)})
	}
	return out
}

func round2(v float64) float64 { return float64(int(v*1000+0.5)) / 1000 }

func round1(v float64) float64 { return float64(int(v*10+0.5)) / 10 }

// handleTimeseries 는 GET /api/v1/dashboard/timeseries (문서 4-1 하단 시계열).
func (s *Server) handleTimeseries(w http.ResponseWriter, r *http.Request) {
	rng := domain.ParseRange(r.URL.Query().Get("range"))
	data, err := s.dashboard.Timeseries(r.Context(), rng)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "timeseries 조회 실패")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

// handleUsage 는 GET /api/v1/usage?range=&group_by= (문서 4-2 사용량·귀속 리포트).
// group_by=model 은 vmselect 메트릭(기존), dept/app/api_key 는 usage_rollup(#4) 집계.
func (s *Server) handleUsage(w http.ResponseWriter, r *http.Request) {
	rng := domain.ParseRange(r.URL.Query().Get("range"))
	group := r.URL.Query().Get("group_by")
	if group == "" {
		group = "model"
	}

	if group != "model" {
		// 부서·앱·키 축 = usage_rollup 집계(#4 귀속).
		if s.usage == nil || !s.usage.Enabled() {
			httpx.JSON(w, http.StatusOK, emptyUsageReport(rng, group))
			return
		}
		rows, err := s.usage.QueryRollup(r.Context(), rng, group)
		if err != nil {
			slog.Warn("usage rollup 조회 실패 — 빈 리포트로 폴백", "err", err, "range", rng, "group", group)
			httpx.JSON(w, http.StatusOK, emptyUsageReport(rng, group))
			return
		}
		if rows == nil {
			rows = []domain.UsageRow{}
		}
		httpx.JSON(w, http.StatusOK, domain.UsageReport{
			Range: rng, GeneratedAt: nowRFC3339(), GroupBy: group, Rows: rows,
		})
		return
	}

	data, err := s.dashboard.Usage(r.Context(), rng)
	if err != nil {
		slog.Warn("usage 조회 실패 — 빈 리포트로 폴백", "err", err, "range", rng, "group", group)
		httpx.JSON(w, http.StatusOK, emptyUsageReport(rng, group))
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

// handleUsageTrend 는 GET /api/v1/usage/trend?range= (P4-4 추세+forecast 입력).
func (s *Server) handleUsageTrend(w http.ResponseWriter, r *http.Request) {
	rng := domain.ParseRange(r.URL.Query().Get("range"))
	empty := domain.UsageTrend{Range: rng, GeneratedAt: nowRFC3339(), Points: []domain.UsageTrendPoint{}}
	if s.usage == nil || !s.usage.Enabled() {
		httpx.JSON(w, http.StatusOK, empty)
		return
	}
	tr, err := s.usage.QueryTrend(r.Context(), rng)
	if err != nil {
		slog.Warn("usage trend 조회 실패 — 빈 추세로 폴백", "err", err, "range", rng)
		httpx.JSON(w, http.StatusOK, empty)
		return
	}
	if tr.Points == nil {
		tr.Points = []domain.UsageTrendPoint{}
	}
	httpx.JSON(w, http.StatusOK, tr)
}

// metricsBreakdownSource 는 차원별 메트릭 분해(L2 groupby) 능력(live·mock 모두 구현).
type metricsBreakdownSource interface {
	MetricsBreakdown(ctx context.Context, rng domain.TimeRange, dim string) (domain.MetricsBreakdown, error)
}

// handleMetricsBreakdown 는 GET /api/v1/metrics/breakdown?range=&dim= (L2 groupby).
// 동일 트래픽/품질 메트릭을 차원(model|endpoint|namespace)으로 쪼개 "어느 그룹이 튀나"를 본다.
func (s *Server) handleMetricsBreakdown(w http.ResponseWriter, r *http.Request) {
	rng := domain.ParseRange(r.URL.Query().Get("range"))
	dim := r.URL.Query().Get("dim")
	if dim == "" {
		dim = "model"
	}
	if _, ok := domain.DimensionLabel(dim); !ok {
		httpx.Error(w, http.StatusBadRequest, "지원하지 않는 차원: "+dim)
		return
	}
	src, ok := s.dashboard.(metricsBreakdownSource)
	if !ok {
		httpx.Error(w, http.StatusServiceUnavailable, "메트릭 분해 소스 미지원")
		return
	}
	rep, err := src.MetricsBreakdown(r.Context(), rng, dim)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "메트릭 분해 조회 실패: "+err.Error())
		return
	}
	domain.AnnotateWarnings(&rep) // 이상 판정 단일 출처(UI 셀 강조와 MCP top_outliers 가 공유)
	httpx.JSON(w, http.StatusOK, rep)
}

// handleMetricDimensions 는 GET /api/v1/metrics/dimensions (groupby 차원 + 메트릭 카탈로그).
// 동적 groupby UI(L2)·FABRIX MCP 가 가능한 차원/메트릭 의미를 발견하는 단일 출처.
func (s *Server) handleMetricDimensions(w http.ResponseWriter, _ *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"dimensions": domain.MetricDimensions,
		"metrics":    domain.MetricCatalog,
	})
}

// gpuSource 는 GPU/MIG 상세를 제공하는 옵셔널 능력(live·mock 모두 구현).
type gpuSource interface {
	GPU(ctx context.Context) (domain.GPUReport, error)
}

// gpuTimeseriesSource 는 per-GPU 드릴다운 시계열 능력(live·mock 모두 구현).
type gpuTimeseriesSource interface {
	GPUTimeseries(ctx context.Context, uuid string) (domain.GPUTimeseries, error)
}

// handleGPUTimeseries 는 GET /api/v1/gpu/timeseries?uuid= (3단 드릴다운 tier-3).
func (s *Server) handleGPUTimeseries(w http.ResponseWriter, r *http.Request) {
	uuid := r.URL.Query().Get("uuid")
	if uuid == "" {
		httpx.Error(w, http.StatusBadRequest, "uuid 필요")
		return
	}
	src, ok := s.dashboard.(gpuTimeseriesSource)
	if !ok {
		httpx.Error(w, http.StatusServiceUnavailable, "GPU 시계열 소스 미지원")
		return
	}
	ts, err := src.GPUTimeseries(r.Context(), uuid)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "GPU 시계열 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, ts)
}

// handleGPU 는 GET /api/v1/gpu (GPU/MIG 화면 4-4 + 효율 스코어 3-4).
func (s *Server) handleGPU(w http.ResponseWriter, r *http.Request) {
	src, ok := s.dashboard.(gpuSource)
	if !ok {
		httpx.Error(w, http.StatusServiceUnavailable, "GPU 소스 미지원")
		return
	}
	rep, err := src.GPU(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "GPU 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, rep)
}

// enginePipelineSource 는 평균 요청 단계별 지연 분해 능력(P4-3, live·mock 모두 구현).
type enginePipelineSource interface {
	EnginePipeline(ctx context.Context) (domain.EnginePipeline, error)
}

// handleEnginePipeline 은 GET /api/v1/proxy/pipeline (P4-3 queue→prefill→decode 분해).
func (s *Server) handleEnginePipeline(w http.ResponseWriter, r *http.Request) {
	src, ok := s.dashboard.(enginePipelineSource)
	if !ok {
		httpx.Error(w, http.StatusServiceUnavailable, "파이프라인 소스 미지원")
		return
	}
	ep, err := src.EnginePipeline(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "파이프라인 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, ep)
}

// handleProxyStats 는 GET /api/v1/proxy/stats?window= (트래픽/프록시 뷰 4-5).
func (s *Server) handleProxyStats(w http.ResponseWriter, r *http.Request) {
	window := 300
	if v := r.URL.Query().Get("window"); v != "" {
		if n, err := parseIntSafe(v); err == nil && n > 0 && n <= 86400 {
			window = n
		}
	}
	httpx.JSON(w, http.StatusOK, s.pstats.Snapshot(window))
}

// handleHealthz 는 GET /api/v1/healthz.
func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]string{
		"status":      "ok",
		"data_source": s.dataSource,
	})
}
