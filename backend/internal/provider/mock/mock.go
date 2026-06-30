// Package mock 은 provider.Dashboard 의 mock 구현이다.
//
// 실제 Prometheus/ClickHouse 백엔드가 없는 동안, 문서(4-1 / 3-5 / 2-2) 스키마
// 형태의 그럴듯한 시드 데이터를 반환한다. 값은 현재 시각 기반으로 약간씩
// 출렁이도록 만들어, 새로고침 시 대시보드가 "살아있는" 느낌을 준다.
package mock

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// Provider 는 provider.Dashboard 를 만족하는 mock 데이터 소스.
type Provider struct{}

// New 는 mock 제공자를 만든다.
func New() *Provider { return &Provider{} }

// wave 는 [lo, hi] 범위에서 주기 period(초) 로 부드럽게 진동하는 값을 만든다.
// phase 로 신호별 위상을 다르게 줘서 카드마다 다르게 움직이게 한다.
func wave(now time.Time, lo, hi, periodSec, phase float64) float64 {
	t := float64(now.Unix())
	s := (math.Sin(2*math.Pi*t/periodSec+phase) + 1) / 2 // 0..1
	return lo + (hi-lo)*s
}

func (p *Provider) Overview(_ context.Context, rng domain.TimeRange) (domain.DashboardOverview, error) {
	now := time.Now().UTC()

	traffic := domain.TrafficCard{
		QPS:         round(wave(now, 8, 18, 90, 0), 1),
		Running:     int(wave(now, 110, 180, 70, 1.1)),
		Waiting:     int(wave(now, 0, 7, 50, 2.3)),
		SuccessRate: round(wave(now, 0.985, 0.999, 200, 0.5), 4),
	}

	quality := domain.QualityCard{
		TTFTp50ms:    round(wave(now, 95, 120, 110, 0.2), 0),
		TTFTp95ms:    round(wave(now, 120, 150, 110, 0.9), 0),
		ITLavgMs:     round(wave(now, 15, 22, 80, 1.7), 0),
		CacheHitRate: round(wave(now, 0.55, 0.72, 160, 2.1), 2),
	}

	// 가드레일 건수는 기간이 길수록 누적되므로 스케일을 키운다.
	gscale := guardScale(rng)
	guardrail := domain.GuardrailCard{
		Blocked:   int(wave(now, 28, 45, 130, 0.3) * gscale),
		PII:       int(wave(now, 18, 30, 130, 0.7) * gscale),
		Jailbreak: int(wave(now, 1, 4, 130, 1.3) * gscale),
		Flagged:   int(wave(now, 8, 15, 130, 2.0) * gscale),
	}

	gpu := domain.GPUCard{
		UsagePerc:     round(wave(now, 0.62, 0.82, 120, 0.4), 2),
		KVCachePerc:   round(wave(now, 0.50, 0.68, 100, 1.5), 2),
		MIGEfficiency: round(wave(now, 0.66, 0.76, 240, 2.6), 2),
	}

	// 추론 지연 3분할(P4-1) — TTFT < E2E, TPOT 은 토큰당 ms 단위.
	latency := domain.LatencyBreakdown{
		TTFTp50ms: quality.TTFTp50ms, TTFTp95ms: quality.TTFTp95ms,
		TTFTp99ms: round(quality.TTFTp95ms*1.25, 0),
		TPOTp50ms: round(wave(now, 12, 18, 80, 1.7), 0), TPOTp95ms: quality.ITLavgMs,
		TPOTp99ms: round(quality.ITLavgMs*1.3, 0),
		E2Ep50ms:  round(wave(now, 850, 1100, 140, 0.6), 0),
		E2Ep95ms:  round(wave(now, 1400, 1900, 140, 0.9), 0),
		E2Ep99ms:  round(wave(now, 2100, 2600, 140, 1.2), 0),
	}
	scheduler := domain.SchedulerState{
		Running:     traffic.Running,
		Waiting:     traffic.Waiting,
		QueueP95ms:  round(wave(now, 5, 40, 70, 2.0), 0),
		KVCachePerc: gpu.KVCachePerc,
	}
	gscaleTok := guardScale(rng)
	tokens := domain.TokenBreakdown{
		PromptTokens:     int64(wave(now, 180_000, 240_000, 300, 0.4) * gscaleTok),
		CachedTokens:     int64(wave(now, 90_000, 140_000, 300, 1.1) * gscaleTok),
		CompletionTokens: int64(wave(now, 60_000, 95_000, 300, 1.8) * gscaleTok),
	}
	topEndpoints := []domain.RankRow{
		{Key: "Qwen/Qwen3-30B-A3B", Label: "Qwen3-30B-A3B", Requests: int64(12403 * gscaleTok / 70), Tokens: int64(4_300_000 * gscaleTok / 70)},
		{Key: "google/gemma-4-31b", Label: "gemma-4-31b", Requests: int64(2910 * gscaleTok / 70), Tokens: int64(9_100_000 * gscaleTok / 70)},
		{Key: "openai/gpt-oss-120b", Label: "gpt-oss-120b", Requests: int64(1820 * gscaleTok / 70), Tokens: int64(2_400_000 * gscaleTok / 70)},
	}
	topKeys := []domain.RankRow{
		{Key: "key-001", Label: "wm-advisor-chatbot · fbx_…a91", Requests: int64(9021 * gscaleTok / 70), Tokens: int64(3_000_000 * gscaleTok / 70)},
		{Key: "key-002", Label: "batch-report · fbx_…7c2", Requests: int64(2910 * gscaleTok / 70), Tokens: int64(9_100_000 * gscaleTok / 70)},
		{Key: "key-003", Label: "research-assistant · fbx_…3de", Requests: int64(1503 * gscaleTok / 70), Tokens: int64(1_200_000 * gscaleTok / 70)},
	}

	deptUsage := []domain.DeptUsage{
		{DeptID: "D-IB", Name: "IB본부", Percent: 0.42},
		{DeptID: "D-RETAIL", Name: "리테일", Percent: 0.27},
		{DeptID: "D-RESEARCH", Name: "리서치", Percent: 0.18},
		{DeptID: "D-COMPLIANCE", Name: "컴플라이언스", Percent: 0.08},
		{DeptID: "D-ETC", Name: "기타", Percent: 0.05},
	}

	appUsage := []domain.AppUsage{
		{AppID: "wm-advisor-chatbot", Percent: 0.38},
		{AppID: "batch-report", Percent: 0.19},
		{AppID: "opencode", Percent: 0.14},
		{AppID: "agentic-ai", Percent: 0.09},
		{AppID: "research-assistant", Percent: 0.20},
	}

	alarms := []domain.Alarm{}
	if quality.TTFTp95ms > 140 {
		alarms = append(alarms, domain.Alarm{
			Severity: domain.SeverityWarning,
			Message:  fmt.Sprintf("IB본부 TTFT p95 임계치 근접 (%dms)", int(quality.TTFTp95ms)),
		})
	}
	alarms = append(alarms, domain.Alarm{
		Severity: domain.SeverityWarning,
		Message:  "agentic-ai 키 쿼터 90% 도달",
	})
	if gpu.MIGEfficiency < 0.68 {
		alarms = append(alarms, domain.Alarm{
			Severity: domain.SeverityInfo,
			Message:  fmt.Sprintf("GPU0 슬라이스 #2 과할당 의심 — MIG 효율 %.2f", gpu.MIGEfficiency),
		})
	}

	return domain.DashboardOverview{
		Range:        rng,
		GeneratedAt:  now.Format(time.RFC3339),
		Traffic:      traffic,
		Quality:      quality,
		Guardrail:    guardrail,
		GPU:          gpu,
		Latency:      latency,
		Scheduler:    scheduler,
		Tokens:       tokens,
		DeptUsage:    deptUsage,
		AppUsage:     appUsage,
		TopEndpoints: topEndpoints,
		TopKeys:      topKeys,
		Alarms:       alarms,
	}, nil
}

func (p *Provider) Timeseries(_ context.Context, rng domain.TimeRange) (domain.Timeseries, error) {
	n := rng.Buckets()
	step := time.Duration(rng.StepSeconds()) * time.Second
	end := time.Now().UTC().Truncate(step)
	start := end.Add(-step * time.Duration(n-1))

	// 새로고침마다 곡선이 살짝 흐르도록 현재 시각 기반 위상 드리프트.
	drift := float64(time.Now().Unix()) / 600.0

	points := make([]domain.TimePoint, 0, n)
	for i := 0; i < n; i++ {
		ts := start.Add(step * time.Duration(i))
		// 버킷 인덱스 기준 부드러운 다중 하모닉 곡선 (창 전체에 완만하게 흐름).
		qps := curve(i, n, 8, 18, drift, 0.0)
		ttft := curve(i, n, 110, 150, drift, 1.2)
		tpot := curve(i, n, 15, 24, drift, 1.9)
		e2e := curve(i, n, 1300, 2000, drift, 0.6)
		// 차단은 드물게 튀는 막대: 임계 위로 올라온 부분만 양수.
		spike := curve(i, n, -3, 5, drift*1.7, 2.4)
		blocked := int(math.Max(0, math.Round(spike)))
		points = append(points, domain.TimePoint{
			Ts:        ts.Format(time.RFC3339),
			QPS:       round(qps, 1),
			TTFTp95ms: round(ttft, 0),
			TPOTp95ms: round(tpot, 0),
			E2Ep95ms:  round(e2e, 0),
			Running:   int(curve(i, n, 110, 180, drift, 1.1)),
			Waiting:   int(curve(i, n, 0, 7, drift, 2.3)),
			Blocked:   blocked,
		})
	}

	return domain.Timeseries{Range: rng, Points: points}, nil
}

// curve 는 버킷 인덱스 i(0..n-1) 위에서 [lo,hi] 범위로 진동하는 부드러운 곡선이다.
// 저주파(창 전체 ~2.5주기) + 고조파를 합쳐 자연스러운 모양을 만들고, drift 로 흐른다.
func curve(i, n int, lo, hi, drift, phase float64) float64 {
	t := float64(i) / float64(maxInt(n-1, 1))
	base := math.Sin(2*math.Pi*2.5*t + phase + drift)
	harm := 0.35 * math.Sin(2*math.Pi*6.0*t+phase*1.7)
	s := (base + harm + 1.35) / 2.7 // 대략 0..1 로 정규화
	if s < 0 {
		s = 0
	} else if s > 1 {
		s = 1
	}
	return lo + (hi-lo)*s
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (p *Provider) Usage(_ context.Context, rng domain.TimeRange) (domain.UsageReport, error) {
	now := time.Now().UTC()
	scale := guardScale(rng) // 기간 길수록 누적 증가 재사용
	// GroupBy=model 이므로 모델 단위로 고유해야 한다(중복 시 프론트 키 충돌). 모델별 합산값.
	rows := []domain.UsageRow{
		{Model: "Qwen/Qwen3-30B-A3B",
			Requests: int64(21424 * scale / 70), PromptTokens: int64(5_300_000 * scale / 70), CompletionTokens: int64(2_000_000 * scale / 70), TTFTp95ms: 124, ITLavgMs: 17},
		{Model: "google/gemma-4-31b",
			Requests: int64(2910 * scale / 70), PromptTokens: int64(8_700_000 * scale / 70), CompletionTokens: int64(400_000 * scale / 70), TTFTp95ms: 540, ITLavgMs: 22},
		{Model: "openai/gpt-oss-120b",
			Requests: int64(1820 * scale / 70), PromptTokens: int64(1_400_000 * scale / 70), CompletionTokens: int64(820_000 * scale / 70), TTFTp95ms: 310, ITLavgMs: 26},
	}
	return domain.UsageReport{
		Range:       rng,
		GeneratedAt: now.Format(time.RFC3339),
		GroupBy:     "model",
		Rows:        rows,
	}, nil
}

// MetricsBreakdown 는 차원별(model|endpoint|namespace) 합성 분해를 반환한다(L2 groupby 패리티).
func (p *Provider) MetricsBreakdown(_ context.Context, rng domain.TimeRange, dim string) (domain.MetricsBreakdown, error) {
	label, ok := domain.DimensionLabel(dim)
	if !ok {
		return domain.MetricsBreakdown{}, fmt.Errorf("지원하지 않는 차원: %s", dim)
	}
	now := time.Now().UTC()
	scale := guardScale(rng)
	type seed struct {
		key    string
		weight float64 // 요청 비중
		ttft   float64 // TTFT p95 기준(ms)
		cache  float64 // 캐시 적중률
	}
	var seeds []seed
	switch dim {
	case "endpoint":
		seeds = []seed{
			{"/v1/chat/completions", 1.0, 130, 0.66},
			{"/v1/completions", 0.35, 180, 0.41},
			{"/v1/embeddings", 0.5, 40, 0.0},
		}
	case "namespace":
		seeds = []seed{
			{"wm-prod", 1.0, 132, 0.68},
			{"wm-staging", 0.3, 156, 0.52},
			{"research-sandbox", 0.18, 240, 0.33},
		}
	default: // model
		seeds = []seed{
			{"Qwen/Qwen3-30B-A3B", 1.0, 124, 0.70},
			{"google/gemma-4-31b", 0.45, 520, 0.38},
			{"meta-llama/Llama-4-8B", 0.6, 96, 0.55},
		}
	}
	rows := make([]domain.MetricsBreakdownRow, 0, len(seeds))
	for i, s := range seeds {
		reqs := wave(now, 6000, 14000, 120, float64(i)) * s.weight * scale / 70
		inTok := reqs * 280
		outTok := reqs * 110
		rows = append(rows, domain.MetricsBreakdownRow{
			Key:              s.key,
			Requests:         int64(reqs + 0.5),
			QPS:              round(wave(now, 4, 16, 90, float64(i))*s.weight, 2),
			TTFTp95ms:        round(s.ttft+wave(now, -8, 8, 70, float64(i)), 0),
			ITLavgMs:         round(wave(now, 15, 24, 80, float64(i)*1.2), 0),
			E2Ep95ms:         round(s.ttft*3+wave(now, 100, 400, 110, float64(i)), 0),
			CacheHitRate:     round(s.cache, 3),
			PromptTokens:     int64(inTok + 0.5),
			CompletionTokens: int64(outTok + 0.5),
		})
	}
	return domain.MetricsBreakdown{
		Range:       rng,
		GeneratedAt: now.Format(time.RFC3339),
		Dimension:   dim,
		Label:       label,
		Rows:        rows,
	}, nil
}

// GPU 는 합성 per-GPU 데이터를 반환한다(8장, 2호스트).
func (p *Provider) GPU(_ context.Context) (domain.GPUReport, error) {
	now := time.Now().UTC()
	devices := make([]domain.GPUDevice, 0, 8)
	var sumU, sumM, sumP, sumE float64
	for i := 0; i < 8; i++ {
		host := "gpu-worker-02"
		if i >= 4 {
			host = "gpu-worker-03"
		}
		util := wave(now, 0.3, 0.92, 90, float64(i))
		mem := wave(now, 0.4, 0.85, 120, float64(i)*1.3)
		eff := wave(now, 0.55, 0.85, 150, float64(i)*0.7)
		d := domain.GPUDevice{
			Hostname: host, Index: strconv.Itoa(i % 4), UUID: fmt.Sprintf("GPU-mock-%02d", i),
			Model: "NVIDIA RTX PRO 6000 Blackwell", UtilPerc: round(util, 3),
			MemUsedMB: round(mem*98304, 0), MemTotalMB: 98304, MemPerc: round(mem, 3),
			TempC: round(wave(now, 42, 78, 100, float64(i)), 0), PowerW: round(wave(now, 120, 480, 80, float64(i)), 0),
			SMActive: round(util*0.9, 3), TensorActive: round(util*0.7, 3), MIGEfficiency: round(eff, 3),
		}
		devices = append(devices, d)
		sumU += d.UtilPerc
		sumM += d.MemPerc
		sumP += d.PowerW
		sumE += d.MIGEfficiency
	}
	idleGap := 0
	for _, d := range devices {
		if d.MemPerc >= 0.5 && d.UtilPerc < 0.1 {
			idleGap++
		}
	}
	n := float64(len(devices))
	return domain.GPUReport{
		GeneratedAt: now.Format(time.RFC3339),
		Summary: domain.GPUSummary{
			TotalGPUs: 8, Hosts: 2, TotalPower: round(sumP, 0),
			AvgUtil: round(sumU/n, 3), AvgMem: round(sumM/n, 3), AvgMIGEff: round(sumE/n, 3),
			IdleAllocGap: idleGap, MIGEnabled: false,
		},
		Devices: devices,
		Source:  "mock",
	}, nil
}

// GPUTimeseries 는 합성 per-GPU 시계열을 반환한다(드릴다운 tier-3).
func (p *Provider) GPUTimeseries(_ context.Context, uuid string) (domain.GPUTimeseries, error) {
	n := 60
	step := time.Minute
	end := time.Now().UTC().Truncate(step)
	start := end.Add(-step * time.Duration(n-1))
	// UUID 문자열로 위상 시드(GPU 마다 다른 곡선).
	phase := float64(len(uuid) % 7)
	points := make([]domain.GPUPoint, 0, n)
	for i := 0; i < n; i++ {
		ts := start.Add(step * time.Duration(i))
		points = append(points, domain.GPUPoint{
			Ts:     ts.Format(time.RFC3339),
			Util:   round(curve(i, n, 0.3, 0.92, 0.5, phase), 3),
			Mem:    round(curve(i, n, 0.45, 0.85, 0.5, phase*1.3), 3),
			TempC:  round(curve(i, n, 46, 78, 0.5, phase), 0),
			PowerW: round(curve(i, n, 140, 480, 0.5, phase*0.7), 0),
		})
	}
	return domain.GPUTimeseries{UUID: uuid, Points: points, MIGPartitioned: false, Source: "mock"}, nil
}

// EnginePipeline 은 합성 단계별 지연 분해를 반환한다(P4-3).
func (p *Provider) EnginePipeline(_ context.Context) (domain.EnginePipeline, error) {
	now := time.Now().UTC()
	preprocess := round(wave(now, 2, 6, 90, 0.2), 1)
	route := round(wave(now, 1, 4, 90, 0.5), 1)
	queue := round(wave(now, 5, 30, 70, 2.0), 1)
	ttft := round(wave(now, 95, 140, 110, 0.9), 1)
	decode := round(wave(now, 900, 1500, 140, 0.6), 1)
	network := round(wave(now, 3, 9, 90, 1.4), 1)
	stages := []domain.PipelineStage{
		{Name: "전처리", AvgMs: preprocess, Kind: "proxy"},
		{Name: "라우팅", AvgMs: route, Kind: "route"},
		{Name: "큐 대기", AvgMs: queue, Kind: "queue"},
		{Name: "Prefill (TTFT)", AvgMs: ttft, Kind: "prefill"},
		{Name: "Decode", AvgMs: decode, Kind: "decode"},
		{Name: "전송", AvgMs: network, Kind: "network"},
	}
	total := 0.0
	for _, s := range stages {
		total += s.AvgMs
	}
	return domain.EnginePipeline{
		Stages:    stages,
		QueueMs:   queue,
		PrefillMs: ttft,
		DecodeMs:  decode,
		TotalMs:   round(total, 1),
		HasTraces: false,
		Source:    "mock",
	}, nil
}

// ModelMetrics 는 합성 모델별 운영 메트릭을 반환한다(P4-6).
func (p *Provider) ModelMetrics(_ context.Context, ids []string) map[string]domain.ModelLive {
	now := time.Now().UTC()
	out := make(map[string]domain.ModelLive, len(ids))
	for i, id := range ids {
		ph := float64(i)
		out[id] = domain.ModelLive{
			TokS:      round(wave(now, 28, 62, 90, ph), 1),
			TTFTp95ms: round(wave(now, 110, 240, 110, ph), 0),
			E2Ep95ms:  round(wave(now, 1200, 2200, 140, ph), 0),
			Requests:  int64(wave(now, 200, 4000, 300, ph)),
			Deployed:  i < 2, // 앞 2개만 배포된 것으로
		}
	}
	return out
}

func guardScale(rng domain.TimeRange) float64 {
	switch rng {
	case domain.Range6h:
		return 4
	case domain.Range24h:
		return 12
	case domain.Range7d:
		return 70
	default:
		return 1
	}
}

func round(v float64, places int) float64 {
	r, _ := strconv.ParseFloat(strconv.FormatFloat(v, 'f', places, 64), 64)
	return r
}
