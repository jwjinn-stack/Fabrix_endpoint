package domain

// 차원별 메트릭 분해(L2 groupby) 타입 + 차원 레지스트리.
//
// 리서치(docs/research/2026-06-29-계층적대시보드-MCP해석-리서치.md §종합)의
// "공통 차원 groupby"를 메트릭 경로에 도입한 것. Overview/Usage 가 전역·model 고정인 데 반해,
// 여기서는 동일 메트릭을 model/endpoint/namespace 로 쪼개 L2(Group) 화면을 채운다.
//
// MetricDimensions 는 친화명 → Prometheus 라벨의 단일 출처다. 동적 groupby UI(L2)와
// 향후 FABRIX MCP 의 메트릭 카탈로그가 이 한 곳을 공유한다(차원 정의 중복 방지).

import (
	"fmt"
	"sort"
)

// MetricDimension — groupby 가능한 한 차원의 정의(카탈로그 시드).
type MetricDimension struct {
	Key   string `json:"key"`   // 친화명: model|endpoint|namespace
	Label string `json:"label"` // 실제 Prometheus 라벨: model|dynamo_endpoint|dynamo_namespace
	Title string `json:"title"` // 화면 표시명
}

// MetricDimensions 는 메트릭 groupby 가능 차원의 단일 출처(친화명 순서 보존용 슬라이스).
// Dynamo frontend 메트릭의 라벨(model / dynamo_endpoint / dynamo_namespace)에 대응한다.
var MetricDimensions = []MetricDimension{
	{Key: "model", Label: "model", Title: "모델"},
	{Key: "endpoint", Label: "dynamo_endpoint", Title: "엔드포인트"},
	{Key: "namespace", Label: "dynamo_namespace", Title: "네임스페이스"},
}

// DimensionLabel 은 친화 차원명을 Prometheus 라벨로 해석한다. 미지원이면 (\"\", false).
func DimensionLabel(dim string) (string, bool) {
	for _, d := range MetricDimensions {
		if d.Key == dim {
			return d.Label, true
		}
	}
	return "", false
}

// ── 메트릭 카탈로그(C2) — AI grounding + UI 툴팁의 단일 출처 ──
//
// 자유 PromQL 생성은 GPT-4 도 ~69%(리서치 R3-5)라 위험하다. 대신 메트릭마다
// 의미·단위·방향·임계치·관련메트릭을 명시한 카탈로그를 제공해, AI(FABRIX MCP)는
// "검증된 메트릭+차원 조합 선택"만 하고 UI 는 동일 메타로 툴팁·이상강조를 그린다.

// MetricMeta — breakdown 행의 한 측정값에 대한 시맨틱 메타데이터.
type MetricMeta struct {
	Key         string   `json:"key"`                  // MetricsBreakdownRow 필드 키(json)
	Title       string   `json:"title"`                // 화면 표시명
	Unit        string   `json:"unit"`                 // ms | req/s | ratio | tokens | count
	LowerBetter bool     `json:"lower_better"`         // 낮을수록 좋음(latency 류) — 이상강조 방향
	Desc        string   `json:"desc"`                 // 한 줄 의미(맥락 포함)
	Related     []string `json:"related,omitempty"`    // 함께 봐야 할 메트릭 키(오독 방지)
	WarnAbove   float64  `json:"warn_above,omitempty"` // 이 값 초과면 주의(LowerBetter 메트릭)
	WarnBelow   float64  `json:"warn_below,omitempty"` // 이 값 미만이면 주의(높을수록 좋은 메트릭)
}

// MetricCatalog 는 breakdown 측정값의 카탈로그(단일 출처). 임계치는 리서치 R1-1/R1-2 근거.
var MetricCatalog = []MetricMeta{
	{Key: "requests", Title: "요청 수", Unit: "count", Desc: "기간 누적 요청 수"},
	{Key: "qps", Title: "QPS", Unit: "req/s", Desc: "초당 요청 수(트래픽 규모)"},
	{Key: "ttft_p95_ms", Title: "TTFT p95", Unit: "ms", LowerBetter: true, WarnAbove: 500,
		Desc: "첫 토큰까지 지연 p95. 큐 적체·prefix cache 적중률에 강하게 의존", Related: []string{"qps", "cache_hit_rate"}},
	{Key: "itl_avg_ms", Title: "ITL 평균", Unit: "ms", LowerBetter: true, WarnAbove: 50,
		Desc: "토큰 간 지연(=TPOT) 평균. 생성 속도", Related: []string{"e2e_p95_ms"}},
	{Key: "e2e_p95_ms", Title: "E2E p95", Unit: "ms", LowerBetter: true,
		Desc: "요청 전체 지연 p95(=TTFT+생성). 출력 토큰 수에 비례하므로 길다고 비정상 아님", Related: []string{"ttft_p95_ms", "itl_avg_ms"}},
	{Key: "cache_hit_rate", Title: "캐시 적중률", Unit: "ratio", LowerBetter: false, WarnBelow: 0.5,
		Desc: "prefix/KV 캐시 적중률(cached/input tokens). 비용·TTFT의 숨은 드라이버", Related: []string{"ttft_p95_ms", "prompt_tokens"}},
	{Key: "prompt_tokens", Title: "입력 토큰", Unit: "tokens", Desc: "기간 누적 입력 토큰(비용 드라이버)"},
	{Key: "completion_tokens", Title: "출력 토큰", Unit: "tokens", Desc: "기간 누적 출력 토큰(비용 드라이버)"},
}

// MetricsBreakdownRow — 차원 한 값(모델명/엔드포인트/네임스페이스)에 대한 메트릭 한 행.
type MetricsBreakdownRow struct {
	Key              string  `json:"key"` // 차원 값
	Requests         int64   `json:"requests"`
	QPS              float64 `json:"qps"`
	TTFTp95ms        float64 `json:"ttft_p95_ms"`
	ITLavgMs         float64 `json:"itl_avg_ms"`
	E2Ep95ms         float64 `json:"e2e_p95_ms"`
	CacheHitRate     float64 `json:"cache_hit_rate"`
	PromptTokens     int64   `json:"prompt_tokens"`
	CompletionTokens int64   `json:"completion_tokens"`

	// 이상 판정(C6) — AnnotateWarnings 가 채움. UI 셀 강조와 MCP top_outliers 의 단일 출처.
	Warn        bool     `json:"warn"`
	WarnKeys    []string `json:"warn_keys,omitempty"`
	WarnReasons []string `json:"warn_reasons,omitempty"`
}

// MetricsBreakdown — GET /api/v1/metrics/breakdown?range=&dim= 응답.
type MetricsBreakdown struct {
	Range       TimeRange             `json:"range"`
	GeneratedAt string                `json:"generated_at"`
	Dimension   string                `json:"dimension"` // model|endpoint|namespace
	Label       string                `json:"label"`     // 실제 Prometheus 라벨
	Rows        []MetricsBreakdownRow `json:"rows"`
}

// ── 이상 판정(C6) — 단일 출처 ──
// 이전: 프론트 isWarn 은 절대+상대(중앙값*1.6), 백엔드 outliers 는 절대만 → UI·MCP 불일치.
// 이제 규칙을 여기(Go) 한 곳에 두고, 프론트는 결과(warn_keys)를 그대로 그린다.

// metricWarn 은 한 메트릭 값이 카탈로그 임계치(절대) 또는 컬럼 중앙값 대비(상대, lower_better)
// 이상인지와 사유를 반환한다.
func metricWarn(m MetricMeta, v, med float64) (bool, string) {
	if m.LowerBetter {
		if m.WarnAbove > 0 && v > m.WarnAbove {
			return true, fmt.Sprintf("%s %.0f > 임계 %.0f", m.Title, v, m.WarnAbove)
		}
		if med > 0 && v > med*1.6 {
			return true, fmt.Sprintf("%s %.0f 중앙값(%.0f) 대비 높음", m.Title, v, med)
		}
		return false, ""
	}
	if m.WarnBelow > 0 && v > 0 && v < m.WarnBelow {
		return true, fmt.Sprintf("%s %.0f%% < 임계 %.0f%%", m.Title, v*100, m.WarnBelow*100)
	}
	return false, ""
}

func rowValue(r MetricsBreakdownRow, key string) float64 {
	switch key {
	case "requests":
		return float64(r.Requests)
	case "qps":
		return r.QPS
	case "ttft_p95_ms":
		return r.TTFTp95ms
	case "itl_avg_ms":
		return r.ITLavgMs
	case "e2e_p95_ms":
		return r.E2Ep95ms
	case "cache_hit_rate":
		return r.CacheHitRate
	case "prompt_tokens":
		return float64(r.PromptTokens)
	case "completion_tokens":
		return float64(r.CompletionTokens)
	}
	return 0
}

func medianOf(vals []float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	s := append([]float64(nil), vals...)
	sort.Float64s(s)
	m := len(s) / 2
	if len(s)%2 == 1 {
		return s[m]
	}
	return (s[m-1] + s[m]) / 2
}

// AnnotateWarnings 는 breakdown 각 행에 warn/warn_keys/warn_reasons 를 채운다(이상 판정 단일 출처).
// 절대 임계(WarnAbove/WarnBelow) + 컬럼 중앙값 대비 상대 편차(lower_better, *1.6)를 함께 본다.
func AnnotateWarnings(b *MetricsBreakdown) {
	if b == nil || len(b.Rows) == 0 {
		return
	}
	meds := make(map[string]float64, len(MetricCatalog))
	for _, m := range MetricCatalog {
		vals := make([]float64, 0, len(b.Rows))
		for i := range b.Rows {
			vals = append(vals, rowValue(b.Rows[i], m.Key))
		}
		meds[m.Key] = medianOf(vals)
	}
	for i := range b.Rows {
		r := &b.Rows[i]
		keys := []string{}
		reasons := []string{}
		for _, m := range MetricCatalog {
			if ok, reason := metricWarn(m, rowValue(*r, m.Key), meds[m.Key]); ok {
				keys = append(keys, m.Key)
				reasons = append(reasons, reason)
			}
		}
		r.WarnKeys = keys
		r.WarnReasons = reasons
		r.Warn = len(keys) > 0
	}
}
