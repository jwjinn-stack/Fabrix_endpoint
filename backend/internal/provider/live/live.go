// Package live 는 provider.Dashboard 의 실데이터 구현이다.
//
// VictoriaMetrics(vmselect)의 Prometheus 호환 쿼리 API로 클러스터 실측 메트릭을
// 조회해 대시보드 스키마로 매핑한다. (문서 §3 라벨/메트릭 설계)
//   - GPU 카드: DCGM_FI_DEV_* (실측 가능)
//   - 트래픽/품질: dynamo_frontend_* (Dynamo 프론트엔드)
//   - 모델별 분포: dynamo_frontend_requests_total 의 model 라벨
//   - 가드레일: Semantic Router 설치 후 (현재 0)
//
// 데이터가 없으면(트래픽 0 등) 각 값은 0으로 안전 폴백한다.
package live

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// Provider 는 vmselect PromQL 기반 실데이터 소스.
type Provider struct {
	base string
	http *http.Client
}

// New 는 vmselect Prometheus 베이스 URL로 live 제공자를 만든다.
func New(vmselectBase string) *Provider {
	return &Provider{
		base: vmselectBase,
		http: &http.Client{Timeout: 8 * time.Second, Transport: httpx.Capturing(nil)},
	}
}

// Probe 는 vmselect 도달성을 확인한다(상수 쿼리 query=1, read-only). 진단용.
func (p *Provider) Probe(ctx context.Context) error {
	_, err := p.query(ctx, "1")
	return err
}

// ── PromQL 클라이언트 ──

type promResp struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string `json:"metric"`
			Value  []any             `json:"value"`  // instant: [ts, "val"]
			Values [][]any           `json:"values"` // range: [[ts,"val"],...]
		} `json:"result"`
	} `json:"data"`
}

func (p *Provider) query(ctx context.Context, expr string) (promResp, error) {
	u := fmt.Sprintf("%s/api/v1/query?query=%s", p.base, url.QueryEscape(expr))
	return p.do(ctx, u)
}

func (p *Provider) queryRange(ctx context.Context, expr string, start, end time.Time, stepSec int) (promResp, error) {
	u := fmt.Sprintf("%s/api/v1/query_range?query=%s&start=%d&end=%d&step=%d",
		p.base, url.QueryEscape(expr), start.Unix(), end.Unix(), stepSec)
	return p.do(ctx, u)
}

func (p *Provider) do(ctx context.Context, u string) (promResp, error) {
	var out promResp
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return out, err
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("vmselect %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	if out.Status != "success" {
		return out, fmt.Errorf("query status=%s", out.Status)
	}
	return out, nil
}

// scalar 는 instant 쿼리의 첫 샘플 값을 반환한다. 결과 없으면 (0, false).
func (p *Provider) scalar(ctx context.Context, expr string) (float64, bool) {
	r, err := p.query(ctx, expr)
	if err != nil || len(r.Data.Result) == 0 || len(r.Data.Result[0].Value) < 2 {
		return 0, false
	}
	return parseVal(r.Data.Result[0].Value[1]), true
}

// histQuantileMs 는 히스토그램 분위수(q)를 ms 로 반환한다(없으면 0).
func (p *Provider) histQuantileMs(ctx context.Context, q float64, bucketMetric string) float64 {
	expr := fmt.Sprintf("histogram_quantile(%g, sum(rate(%s[5m])) by (le))", q, bucketMetric)
	v, _ := p.scalar(ctx, expr)
	return round(v*1000, 0)
}

// histAvgMs 는 히스토그램(_sum/_count)의 평균을 ms 로 반환한다(selector 옵션).
func (p *Provider) histAvgMs(ctx context.Context, metric, selector string) float64 {
	expr := fmt.Sprintf("sum(rate(%s_sum%s[5m]))/sum(rate(%s_count%s[5m]))", metric, selector, metric, selector)
	v, _ := p.scalar(ctx, expr)
	return round(v*1000, 1)
}

// EnginePipeline 은 평균 요청의 단계별 지연 분해를 반환한다(P4-3).
// 전처리·라우팅·전송(stage_duration) + 큐(request_plane_queue) + prefill(TTFT) + decode(E2E-TTFT).
func (p *Provider) EnginePipeline(ctx context.Context) (domain.EnginePipeline, error) {
	preprocess := p.histAvgMs(ctx, "dynamo_frontend_stage_duration_seconds", `{stage="preprocess"}`)
	route := p.histAvgMs(ctx, "dynamo_frontend_stage_duration_seconds", `{stage="route"}`)
	network := p.histAvgMs(ctx, "dynamo_frontend_stage_duration_seconds", `{stage="transport_roundtrip"}`)
	queue := p.histAvgMs(ctx, "dynamo_request_plane_queue_seconds", "")
	ttft := p.histAvgMs(ctx, "dynamo_frontend_time_to_first_token_seconds", "")
	e2e := p.histAvgMs(ctx, "dynamo_frontend_request_duration_seconds", "")
	decode := e2e - ttft
	if decode < 0 {
		decode = 0
	}
	stages := []domain.PipelineStage{
		{Name: "전처리", AvgMs: preprocess, Kind: "proxy"},
		{Name: "라우팅", AvgMs: route, Kind: "route"},
		{Name: "큐 대기", AvgMs: queue, Kind: "queue"},
		{Name: "Prefill (TTFT)", AvgMs: round(ttft, 1), Kind: "prefill"},
		{Name: "Decode", AvgMs: round(decode, 1), Kind: "decode"},
		{Name: "전송", AvgMs: network, Kind: "network"},
	}
	total := 0.0
	for _, s := range stages {
		total += s.AvgMs
	}
	return domain.EnginePipeline{
		Stages:    stages,
		QueueMs:   queue,
		PrefillMs: round(ttft, 1),
		DecodeMs:  round(decode, 1),
		TotalMs:   round(total, 1),
		HasTraces: false, // victoria-traces 미수집 — 집계 분해로 표시
		Source:    "live",
	}, nil
}

func parseVal(v any) float64 {
	s, ok := v.(string)
	if !ok {
		return 0
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}

// ── Dashboard 구현 ──

func (p *Provider) Overview(ctx context.Context, rng domain.TimeRange) (domain.DashboardOverview, error) {
	now := time.Now().UTC()

	// GPU (DCGM 실측)
	gpuUtil, _ := p.scalar(ctx, "avg(DCGM_FI_DEV_GPU_UTIL)")
	fbUsed, _ := p.scalar(ctx, "sum(DCGM_FI_DEV_FB_USED)")
	fbFree, _ := p.scalar(ctx, "sum(DCGM_FI_DEV_FB_FREE)")
	migEff, _ := p.scalar(ctx, "avg(DCGM_FI_PROF_GR_ENGINE_ACTIVE)")
	kv := 0.0
	if fbUsed+fbFree > 0 {
		kv = fbUsed / (fbUsed + fbFree)
	}
	gpu := domain.GPUCard{
		UsagePerc:     round(gpuUtil/100, 2),
		KVCachePerc:   round(kv, 2),
		MIGEfficiency: round(migEff, 2),
	}

	// 트래픽 (dynamo_frontend)
	qps, _ := p.scalar(ctx, "sum(rate(dynamo_frontend_requests_total[2m]))")
	running, _ := p.scalar(ctx, "sum(dynamo_frontend_inflight_requests)")
	waiting, _ := p.scalar(ctx, "sum(dynamo_frontend_queued_requests)")
	// 성공률: 에러/상태 메트릭이 아직 없어 트래픽이 있으면 1.0(관측된 실패 0), 없으면 0.
	success := 0.0
	if qps > 0 {
		success = 1.0
	}
	traffic := domain.TrafficCard{
		QPS:         round(qps, 1),
		Running:     int(running),
		Waiting:     int(waiting),
		SuccessRate: success,
	}

	// 품질 (dynamo_frontend 히스토그램)
	ttftP50, _ := p.scalar(ctx, "histogram_quantile(0.5, sum(rate(dynamo_frontend_time_to_first_token_seconds_bucket[5m])) by (le))")
	ttftP95, _ := p.scalar(ctx, "histogram_quantile(0.95, sum(rate(dynamo_frontend_time_to_first_token_seconds_bucket[5m])) by (le))")
	itl, _ := p.scalar(ctx, "sum(rate(dynamo_frontend_inter_token_latency_seconds_sum[5m]))/sum(rate(dynamo_frontend_inter_token_latency_seconds_count[5m]))")
	cacheHit, _ := p.scalar(ctx, "sum(rate(dynamo_frontend_cached_tokens_sum[5m]))/sum(rate(dynamo_frontend_input_sequence_tokens_sum[5m]))")
	quality := domain.QualityCard{
		TTFTp50ms:    round(ttftP50*1000, 0),
		TTFTp95ms:    round(ttftP95*1000, 0),
		ITLavgMs:     round(itl*1000, 0),
		CacheHitRate: clamp01(round(cacheHit, 2)),
	}

	// 추론 지연 3분할 (P4-1) — TTFT/TPOT(=ITL)/E2E 의 p50/p95/p99 (dynamo_frontend 히스토그램).
	latency := domain.LatencyBreakdown{
		TTFTp50ms: p.histQuantileMs(ctx, 0.5, "dynamo_frontend_time_to_first_token_seconds_bucket"),
		TTFTp95ms: p.histQuantileMs(ctx, 0.95, "dynamo_frontend_time_to_first_token_seconds_bucket"),
		TTFTp99ms: p.histQuantileMs(ctx, 0.99, "dynamo_frontend_time_to_first_token_seconds_bucket"),
		TPOTp50ms: p.histQuantileMs(ctx, 0.5, "dynamo_frontend_inter_token_latency_seconds_bucket"),
		TPOTp95ms: p.histQuantileMs(ctx, 0.95, "dynamo_frontend_inter_token_latency_seconds_bucket"),
		TPOTp99ms: p.histQuantileMs(ctx, 0.99, "dynamo_frontend_inter_token_latency_seconds_bucket"),
		E2Ep50ms:  p.histQuantileMs(ctx, 0.5, "dynamo_frontend_request_duration_seconds_bucket"),
		E2Ep95ms:  p.histQuantileMs(ctx, 0.95, "dynamo_frontend_request_duration_seconds_bucket"),
		E2Ep99ms:  p.histQuantileMs(ctx, 0.99, "dynamo_frontend_request_duration_seconds_bucket"),
	}

	// 스케줄러 상태 (P4-1) — 엔진측 running/waiting + 큐 대기 p95 + 실 KV 캐시 점유.
	schedRunning, _ := p.scalar(ctx, "sum(vllm:num_requests_running)")
	schedWaiting, _ := p.scalar(ctx, "sum(vllm:num_requests_waiting)")
	if schedRunning == 0 && schedWaiting == 0 {
		// vllm 엔진 메트릭 미수집 시 dynamo 프론트엔드 값으로 폴백.
		schedRunning = running
		schedWaiting = waiting
	}
	queueP95, _ := p.scalar(ctx, "histogram_quantile(0.95, sum(rate(dynamo_request_plane_queue_seconds_bucket[5m])) by (le))")
	kvUsage, ok := p.scalar(ctx, "avg(vllm:kv_cache_usage_perc)")
	if !ok {
		kvUsage = kv // VRAM 비율 폴백
	}
	scheduler := domain.SchedulerState{
		Running:     int(schedRunning),
		Waiting:     int(schedWaiting),
		QueueP95ms:  round(queueP95*1000, 0),
		KVCachePerc: clamp01(round(kvUsage, 3)),
	}

	// 토큰 분해 (P4-1) — 기간 누적 입력/캐시/출력.
	dur := rng.PromDuration()
	promptTok, _ := p.scalar(ctx, "sum(increase(dynamo_frontend_input_sequence_tokens_sum["+dur+"]))")
	cachedTok, _ := p.scalar(ctx, "sum(increase(dynamo_frontend_cached_tokens_sum["+dur+"]))")
	complTok, _ := p.scalar(ctx, "sum(increase(dynamo_frontend_output_tokens_total["+dur+"]))")
	tokens := domain.TokenBreakdown{
		PromptTokens:     int64(promptTok + 0.5),
		CachedTokens:     int64(cachedTok + 0.5),
		CompletionTokens: int64(complTok + 0.5),
	}

	// 가드레일: Semantic Router 미설치 → 0 (설치 후 ClickHouse guard_audit 집계로 대체)
	guardrail := domain.GuardrailCard{}

	// 모델별 요청 분포 (model 라벨 실측) → app_usage 에 매핑
	appUsage := p.distribution(ctx, "sum by (model) (rate(dynamo_frontend_requests_total[5m]))", "model")

	alarms := []domain.Alarm{}
	if quality.TTFTp95ms > 500 {
		alarms = append(alarms, domain.Alarm{
			Severity: domain.SeverityWarning,
			Message:  fmt.Sprintf("TTFT p95 높음 (%.0fms)", quality.TTFTp95ms),
		})
	}

	return domain.DashboardOverview{
		Range:       rng,
		GeneratedAt: now.Format(time.RFC3339),
		Traffic:     traffic,
		Quality:     quality,
		Guardrail:   guardrail,
		GPU:         gpu,
		Latency:     latency,
		Scheduler:   scheduler,
		Tokens:      tokens,
		DeptUsage:   []domain.DeptUsage{}, // dept 라벨 부재 → 귀속 연동 후(§3-3)
		AppUsage:    appUsage,
		Alarms:      alarms,
	}, nil
}

// distribution 은 by-label 집계 쿼리 결과를 비율 분포로 변환한다.
func (p *Provider) distribution(ctx context.Context, expr, label string) []domain.AppUsage {
	r, err := p.query(ctx, expr)
	if err != nil {
		return []domain.AppUsage{}
	}
	type kv struct {
		name string
		v    float64
	}
	var items []kv
	total := 0.0
	for _, res := range r.Data.Result {
		if len(res.Value) < 2 {
			continue
		}
		v := parseVal(res.Value[1])
		name := res.Metric[label]
		if name == "" {
			name = "unknown"
		}
		items = append(items, kv{name, v})
		total += v
	}
	out := make([]domain.AppUsage, 0, len(items))
	for _, it := range items {
		pct := 0.0
		if total > 0 {
			pct = it.v / total
		}
		out = append(out, domain.AppUsage{AppID: it.name, Percent: round(pct, 3)})
	}
	return out
}

func (p *Provider) Timeseries(ctx context.Context, rng domain.TimeRange) (domain.Timeseries, error) {
	step := rng.StepSeconds()
	n := rng.Buckets()
	end := time.Now().UTC().Truncate(time.Duration(step) * time.Second)
	start := end.Add(-time.Duration(step*(n-1)) * time.Second)

	qpsSeries := p.rangeSeries(ctx, "sum(rate(dynamo_frontend_requests_total[2m]))", start, end, step)
	ttftSeries := p.rangeSeries(ctx, "histogram_quantile(0.95, sum(rate(dynamo_frontend_time_to_first_token_seconds_bucket[5m])) by (le))*1000", start, end, step)
	tpotSeries := p.rangeSeries(ctx, "histogram_quantile(0.95, sum(rate(dynamo_frontend_inter_token_latency_seconds_bucket[5m])) by (le))*1000", start, end, step)
	e2eSeries := p.rangeSeries(ctx, "histogram_quantile(0.95, sum(rate(dynamo_frontend_request_duration_seconds_bucket[5m])) by (le))*1000", start, end, step)
	runSeries := p.rangeSeries(ctx, "sum(vllm:num_requests_running)", start, end, step)
	waitSeries := p.rangeSeries(ctx, "sum(vllm:num_requests_waiting)", start, end, step)

	points := make([]domain.TimePoint, 0, n)
	for i := 0; i < n; i++ {
		ts := start.Add(time.Duration(step*i) * time.Second)
		key := ts.Unix()
		points = append(points, domain.TimePoint{
			Ts:        ts.Format(time.RFC3339),
			QPS:       round(qpsSeries[key], 1),
			TTFTp95ms: round(ttftSeries[key], 0),
			TPOTp95ms: round(tpotSeries[key], 0),
			E2Ep95ms:  round(e2eSeries[key], 0),
			Running:   int(runSeries[key]),
			Waiting:   int(waitSeries[key]),
			Blocked:   0, // 가드레일 설치 후
		})
	}
	return domain.Timeseries{Range: rng, Points: points}, nil
}

// rangeSeries 는 query_range 결과를 ts(unix)→value 맵으로 반환한다.
func (p *Provider) rangeSeries(ctx context.Context, expr string, start, end time.Time, stepSec int) map[int64]float64 {
	out := map[int64]float64{}
	r, err := p.queryRange(ctx, expr, start, end, stepSec)
	if err != nil || len(r.Data.Result) == 0 {
		return out
	}
	for _, vv := range r.Data.Result[0].Values {
		if len(vv) < 2 {
			continue
		}
		ts, _ := vv[0].(float64)
		out[int64(ts)] = parseVal(vv[1])
	}
	return out
}

// vectorByLabel 는 by-label 집계 결과를 label값→value 맵으로 반환한다.
func (p *Provider) vectorByLabel(ctx context.Context, expr, label string) map[string]float64 {
	out := map[string]float64{}
	r, err := p.query(ctx, expr)
	if err != nil {
		return out
	}
	for _, res := range r.Data.Result {
		if len(res.Value) < 2 {
			continue
		}
		name := res.Metric[label]
		if name == "" {
			name = "unknown"
		}
		out[name] = parseVal(res.Value[1])
	}
	return out
}

func (p *Provider) Usage(ctx context.Context, rng domain.TimeRange) (domain.UsageReport, error) {
	d := rng.PromDuration()
	reqs := p.vectorByLabel(ctx, "sum by (model)(increase(dynamo_frontend_requests_total["+d+"]))", "model")
	inTok := p.vectorByLabel(ctx, "sum by (model)(increase(dynamo_frontend_input_sequence_tokens_sum["+d+"]))", "model")
	outTok := p.vectorByLabel(ctx, "sum by (model)(increase(dynamo_frontend_output_tokens_total["+d+"]))", "model")
	ttft := p.vectorByLabel(ctx, "histogram_quantile(0.95, sum by (model,le)(rate(dynamo_frontend_time_to_first_token_seconds_bucket["+d+"])))", "model")
	itl := p.vectorByLabel(ctx, "sum by (model)(rate(dynamo_frontend_inter_token_latency_seconds_sum["+d+"]))/sum by (model)(rate(dynamo_frontend_inter_token_latency_seconds_count["+d+"]))", "model")

	rows := make([]domain.UsageRow, 0, len(reqs))
	for model, rc := range reqs {
		if rc <= 0 {
			continue
		}
		rows = append(rows, domain.UsageRow{
			Model:            model,
			Requests:         int64(rc + 0.5),
			PromptTokens:     int64(inTok[model] + 0.5),
			CompletionTokens: int64(outTok[model] + 0.5),
			TTFTp95ms:        round(ttft[model]*1000, 0),
			ITLavgMs:         round(itl[model]*1000, 0),
		})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Requests > rows[j].Requests })

	return domain.UsageReport{
		Range:       rng,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		GroupBy:     "model",
		Rows:        rows,
	}, nil
}

// MetricsBreakdown 는 동일 트래픽/품질 메트릭을 한 차원(model|endpoint|namespace)으로
// 쪼개 반환한다(L2 groupby). dim 은 domain.MetricDimensions 의 친화명 → Prometheus 라벨.
// Overview(전역)·Usage(model 고정)와 달리 임의 공통 차원으로 분해해 "어느 그룹이 튀나"를 본다.
func (p *Provider) MetricsBreakdown(ctx context.Context, rng domain.TimeRange, dim string) (domain.MetricsBreakdown, error) {
	label, ok := domain.DimensionLabel(dim)
	if !ok {
		return domain.MetricsBreakdown{}, fmt.Errorf("지원하지 않는 차원: %s", dim)
	}
	d := rng.PromDuration()
	by := func(agg, metric string) map[string]float64 {
		return p.vectorByLabel(ctx, fmt.Sprintf("sum by (%s)(%s(%s[%s]))", label, agg, metric, d), label)
	}
	reqs := by("increase", "dynamo_frontend_requests_total")
	qps := by("rate", "dynamo_frontend_requests_total")
	inTok := by("increase", "dynamo_frontend_input_sequence_tokens_sum")
	cachedTok := by("increase", "dynamo_frontend_cached_tokens_sum")
	outTok := by("increase", "dynamo_frontend_output_tokens_total")
	ttft := p.vectorByLabel(ctx, fmt.Sprintf("histogram_quantile(0.95, sum by (%s,le)(rate(dynamo_frontend_time_to_first_token_seconds_bucket[%s])))", label, d), label)
	itl := p.vectorByLabel(ctx, fmt.Sprintf("sum by (%s)(rate(dynamo_frontend_inter_token_latency_seconds_sum[%s]))/sum by (%s)(rate(dynamo_frontend_inter_token_latency_seconds_count[%s]))", label, d, label, d), label)
	e2e := p.vectorByLabel(ctx, fmt.Sprintf("histogram_quantile(0.95, sum by (%s,le)(rate(dynamo_frontend_request_duration_seconds_bucket[%s])))", label, d), label)

	rows := make([]domain.MetricsBreakdownRow, 0, len(reqs))
	for key, rc := range reqs {
		if rc <= 0 {
			continue
		}
		cacheHit := 0.0
		if inTok[key] > 0 {
			cacheHit = clamp01(cachedTok[key] / inTok[key])
		}
		rows = append(rows, domain.MetricsBreakdownRow{
			Key:              key,
			Requests:         int64(rc + 0.5),
			QPS:              round(qps[key], 2),
			TTFTp95ms:        round(ttft[key]*1000, 0),
			ITLavgMs:         round(itl[key]*1000, 0),
			E2Ep95ms:         round(e2e[key]*1000, 0),
			CacheHitRate:     round(cacheHit, 3),
			PromptTokens:     int64(inTok[key] + 0.5),
			CompletionTokens: int64(outTok[key] + 0.5),
		})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Requests > rows[j].Requests })

	return domain.MetricsBreakdown{
		Range:       rng,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Dimension:   dim,
		Label:       label,
		Rows:        rows,
	}, nil
}

// ── GPU/MIG (문서 4-4, 효율 스코어 3-4) — DCGM 실측 ──

// seriesByUUID 는 GPU UUID → (라벨, 값) 맵을 만든다(per-GPU 조인 키).
func (p *Provider) seriesByUUID(ctx context.Context, expr string) map[string]struct {
	labels map[string]string
	val    float64
} {
	out := map[string]struct {
		labels map[string]string
		val    float64
	}{}
	r, err := p.query(ctx, expr)
	if err != nil {
		return out
	}
	for _, res := range r.Data.Result {
		if len(res.Value) < 2 {
			continue
		}
		uuid := res.Metric["UUID"]
		if uuid == "" {
			uuid = res.Metric["Hostname"] + "/" + res.Metric["gpu"]
		}
		out[uuid] = struct {
			labels map[string]string
			val    float64
		}{res.Metric, parseVal(res.Value[1])}
	}
	return out
}

// GPU 는 per-GPU DCGM 실측 + MIG 효율 스코어를 반환한다.
func (p *Provider) GPU(ctx context.Context) (domain.GPUReport, error) {
	util := p.seriesByUUID(ctx, "DCGM_FI_DEV_GPU_UTIL")
	fbUsed := p.seriesByUUID(ctx, "DCGM_FI_DEV_FB_USED")
	fbFree := p.seriesByUUID(ctx, "DCGM_FI_DEV_FB_FREE")
	temp := p.seriesByUUID(ctx, "DCGM_FI_DEV_GPU_TEMP")
	power := p.seriesByUUID(ctx, "DCGM_FI_DEV_POWER_USAGE")
	smAct := p.seriesByUUID(ctx, "DCGM_FI_PROF_SM_ACTIVE")
	tensor := p.seriesByUUID(ctx, "DCGM_FI_PROF_PIPE_TENSOR_ACTIVE")
	grEng := p.seriesByUUID(ctx, "DCGM_FI_PROF_GR_ENGINE_ACTIVE")

	devices := make([]domain.GPUDevice, 0, len(util))
	hosts := map[string]bool{}
	var sumUtil, sumMem, sumPower, sumEff float64
	idleGap := 0 // VRAM 점유인데 연산 유휴 = 할당 갭
	migEnabled := false
	for uuid, u := range util {
		if u.labels["GPU_I_PROFILE"] != "" || u.labels["GPU_I_ID"] != "" {
			migEnabled = true // DCGM 이 MIG 슬라이스 라벨을 붙이면 파티션 활성
		}
		used := fbUsed[uuid].val
		free := fbFree[uuid].val
		total := used + free
		memPerc := 0.0
		if total > 0 {
			memPerc = used / total
		}
		if memPerc >= 0.5 && u.val/100 < 0.1 {
			idleGap++
		}
		hosts[u.labels["Hostname"]] = true
		d := domain.GPUDevice{
			Hostname:      u.labels["Hostname"],
			Index:         u.labels["gpu"],
			UUID:          uuid,
			Model:         u.labels["modelName"],
			UtilPerc:      round(u.val/100, 3),
			MemUsedMB:     round(used, 0),
			MemTotalMB:    round(total, 0),
			MemPerc:       round(memPerc, 3),
			TempC:         round(temp[uuid].val, 0),
			PowerW:        round(power[uuid].val, 0),
			SMActive:      round(smAct[uuid].val, 3),
			TensorActive:  round(tensor[uuid].val, 3),
			MIGEfficiency: round(grEng[uuid].val, 3),
		}
		devices = append(devices, d)
		sumUtil += d.UtilPerc
		sumMem += d.MemPerc
		sumPower += d.PowerW
		sumEff += d.MIGEfficiency
	}
	sort.Slice(devices, func(i, j int) bool {
		if devices[i].Hostname != devices[j].Hostname {
			return devices[i].Hostname < devices[j].Hostname
		}
		return devices[i].Index < devices[j].Index
	})

	n := float64(len(devices))
	sum := domain.GPUSummary{
		TotalGPUs: len(devices), TotalPower: round(sumPower, 0), Hosts: len(hosts),
		IdleAllocGap: idleGap, MIGEnabled: migEnabled,
	}
	if n > 0 {
		sum.AvgUtil = round(sumUtil/n, 3)
		sum.AvgMem = round(sumMem/n, 3)
		sum.AvgMIGEff = round(sumEff/n, 3)
	}
	return domain.GPUReport{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Summary:     sum,
		Devices:     devices,
		Source:      "live",
	}, nil
}

// GPUTimeseries 는 단일 GPU(UUID)의 util/mem/temp/power 시계열을 반환한다(드릴다운 tier-3).
func (p *Provider) GPUTimeseries(ctx context.Context, uuid string) (domain.GPUTimeseries, error) {
	step := 60
	n := 60 // 최근 60분
	end := time.Now().UTC().Truncate(time.Duration(step) * time.Second)
	start := end.Add(-time.Duration(step*(n-1)) * time.Second)
	sel := fmt.Sprintf(`{UUID="%s"}`, uuid)

	utilS := p.rangeSeries(ctx, "DCGM_FI_DEV_GPU_UTIL"+sel, start, end, step)
	usedS := p.rangeSeries(ctx, "DCGM_FI_DEV_FB_USED"+sel, start, end, step)
	freeS := p.rangeSeries(ctx, "DCGM_FI_DEV_FB_FREE"+sel, start, end, step)
	tempS := p.rangeSeries(ctx, "DCGM_FI_DEV_GPU_TEMP"+sel, start, end, step)
	powerS := p.rangeSeries(ctx, "DCGM_FI_DEV_POWER_USAGE"+sel, start, end, step)
	// MIG 파티션 여부 — 해당 UUID 에 GPU_I_PROFILE 라벨이 붙은 시리즈가 있는지.
	migPart := false
	if r, err := p.query(ctx, "DCGM_FI_DEV_GPU_UTIL"+sel); err == nil {
		for _, res := range r.Data.Result {
			if res.Metric["GPU_I_PROFILE"] != "" || res.Metric["GPU_I_ID"] != "" {
				migPart = true
			}
		}
	}

	points := make([]domain.GPUPoint, 0, n)
	for i := 0; i < n; i++ {
		ts := start.Add(time.Duration(step*i) * time.Second)
		key := ts.Unix()
		used := usedS[key]
		free := freeS[key]
		mem := 0.0
		if used+free > 0 {
			mem = used / (used + free)
		}
		points = append(points, domain.GPUPoint{
			Ts:     ts.Format(time.RFC3339),
			Util:   round(utilS[key]/100, 3),
			Mem:    round(mem, 3),
			TempC:  round(tempS[key], 0),
			PowerW: round(powerS[key], 0),
		})
	}
	return domain.GPUTimeseries{UUID: uuid, Points: points, MIGPartitioned: migPart, Source: "live"}, nil
}

// ModelMetrics 는 모델 id 별 실시간 운영 메트릭을 반환한다(P4-6).
// dynamo_frontend 히스토그램의 model 라벨로 조인(라벨=catalog id 와 동일).
func (p *Provider) ModelMetrics(ctx context.Context, ids []string) map[string]domain.ModelLive {
	out := make(map[string]domain.ModelLive, len(ids))
	for _, id := range ids {
		sel := fmt.Sprintf(`{model="%s"}`, id)
		ttft := p.histQuantileMs(ctx, 0.95, "dynamo_frontend_time_to_first_token_seconds_bucket"+sel)
		e2e := p.histQuantileMs(ctx, 0.95, "dynamo_frontend_request_duration_seconds_bucket"+sel)
		tpotMs := p.histAvgMs(ctx, "dynamo_frontend_inter_token_latency_seconds", sel)
		reqs, _ := p.scalar(ctx, "sum(increase(dynamo_frontend_requests_total"+sel+"[24h]))")
		tokS := 0.0
		if tpotMs > 0 {
			tokS = round(1000.0/tpotMs, 1) // 토큰당 ms → 토큰/초
		}
		out[id] = domain.ModelLive{
			TokS:      tokS,
			TTFTp95ms: ttft,
			E2Ep95ms:  e2e,
			Requests:  int64(reqs + 0.5),
			Deployed:  reqs > 0 || ttft > 0, // 메트릭 관측되면 서빙 중으로 간주
		}
	}
	return out
}

func round(v float64, places int) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	r, _ := strconv.ParseFloat(strconv.FormatFloat(v, 'f', places, 64), 64)
	return r
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
