package domain

import (
	"errors"
	"fmt"
	"math"
	"strings"
)

// 지표 기반 알림 룰(IMP-36). Langfuse monitor / Datadog metric monitor 정합.
//
// phase 1: 정적 임계만(metric op threshold). anomaly(EMA±σ)·outlier 는 baseline store 가
// 필요하므로 phase 2 로 분리(미구현). 아웃바운드 발송은 기존 IMP-15 디스패처를 재사용한다
// (새 SSRF 표면·채널 신설 금지).

// AlertMetric 은 평가 대상 지표(화이트리스트 enum). 모두 overview/timeseries 가 이미 산출한다.
type AlertMetric string

const (
	MetricTTFTp95   AlertMetric = "ttft_p95"   // ms, Quality.TTFTp95ms
	MetricLatencyAvg AlertMetric = "latency_avg" // ms, Latency.E2Ep95ms (대표 지연)
	MetricErrorRate AlertMetric = "error_rate"  // 0..1, 1 - Traffic.SuccessRate
	MetricBlockRate AlertMetric = "block_rate"  // 0..1, Guardrail.Blocked / 요청 추정
	MetricThroughput AlertMetric = "throughput" // qps, Traffic.QPS
	MetricCount     AlertMetric = "count"       // 가드 차단 카운트 등 정수 카운트
)

// AlertOp 은 비교 연산자(화이트리스트).
type AlertOp string

const (
	OpGT  AlertOp = "gt"
	OpGTE AlertOp = "gte"
	OpLT  AlertOp = "lt"
	OpLTE AlertOp = "lte"
)

// AlertWindow 은 평가 윈도(enum). 5분/1시간/1일.
type AlertWindow string

const (
	Window5m AlertWindow = "5m"
	Window1h AlertWindow = "1h"
	Window1d AlertWindow = "1d"
)

// AlertState 는 룰 상태머신. bare boolean 대신(resolve/recovery 통지 가능).
type AlertState string

const (
	StateOK      AlertState = "OK"
	StateWarning AlertState = "WARNING"
	StateAlert   AlertState = "ALERT"
	StateNoData  AlertState = "NO_DATA"
	StatePaused  AlertState = "PAUSED"
)

// NoDataMode 는 빈/저샘플 window 처리(Datadog 정합). 기본 NoDataNoData — error_rate/block_rate 가
// 빈 window 에서 0 으로 읽혀 거짓 발화하지 않게 한다(조용한 발화 방지).
type NoDataMode string

const (
	NoDataNoData     NoDataMode = "no_data"       // 기본: 데이터 없으면 NO_DATA(발화 안 함)
	NoDataTreatZero  NoDataMode = "treat_as_zero" // 명시 선택 시에만 0 으로 평가
	NoDataHoldPrev   NoDataMode = "hold_previous" // 직전 상태 유지
)

// AlertSeverity 화이트리스트(대시보드 Alarm 과 동일 어휘).
var alertSeverities = map[string]bool{"info": true, "warning": true, "critical": true}

var alertMetrics = map[AlertMetric]bool{
	MetricTTFTp95: true, MetricLatencyAvg: true, MetricErrorRate: true,
	MetricBlockRate: true, MetricThroughput: true, MetricCount: true,
}
var alertOps = map[AlertOp]bool{OpGT: true, OpGTE: true, OpLT: true, OpLTE: true}
var alertWindows = map[AlertWindow]bool{Window5m: true, Window1h: true, Window1d: true}
var noDataModes = map[NoDataMode]bool{NoDataNoData: true, NoDataTreatZero: true, NoDataHoldPrev: true}

// AlertRule 은 단일 지표 임계 룰. 정적 임계가 phase 1 의 유일 타입.
type AlertRule struct {
	ID             string      `json:"id"`
	Name           string      `json:"name"`
	Metric         AlertMetric `json:"metric"`
	Op             AlertOp     `json:"op"`
	AlertThreshold float64     `json:"alert_threshold"`
	WarnThreshold  *float64    `json:"warn_threshold,omitempty"` // 옵션 2-tier
	Window         AlertWindow `json:"window"`
	Severity       string      `json:"severity"`
	NoDataMode     NoDataMode  `json:"no_data_mode"`
	RecoveryWindow int         `json:"recovery_window"`  // 연속 clear 횟수(히스테리시스). 기본 2.
	RenotifyMin    int         `json:"renotify_min"`     // elevated 지속 시 재통지 간격(분). 0=재통지 안 함.
	Enabled        bool        `json:"enabled"`

	// 평가 상태(서버 보유, 응답에 표시) — 입력 시 무시한다.
	State      AlertState `json:"state"`
	LastValue  *float64   `json:"last_value,omitempty"`
	LastEvalAt string     `json:"last_eval_at,omitempty"`
	CreatedAt  string     `json:"created_at,omitempty"`
}

// Validate 는 입력 룰을 화이트리스트·bounded 검증한다(SSRF 와 무관한 순수 입력 검증).
// metric/op/window/severity/noDataMode 는 enum 화이트리스트, threshold 는 유한·합리적 범위.
func (r AlertRule) Validate() error {
	if strings.TrimSpace(r.Name) == "" {
		return errors.New("룰 이름이 비었습니다")
	}
	if len(r.Name) > 120 {
		return errors.New("룰 이름이 너무 깁니다(최대 120자)")
	}
	if !alertMetrics[r.Metric] {
		return fmt.Errorf("허용되지 않은 지표: %q", r.Metric)
	}
	if !alertOps[r.Op] {
		return fmt.Errorf("허용되지 않은 연산자: %q", r.Op)
	}
	if !alertWindows[r.Window] {
		return fmt.Errorf("허용되지 않은 윈도: %q", r.Window)
	}
	if !alertSeverities[r.Severity] {
		return fmt.Errorf("허용되지 않은 심각도: %q", r.Severity)
	}
	if r.NoDataMode != "" && !noDataModes[r.NoDataMode] {
		return fmt.Errorf("허용되지 않은 no_data_mode: %q", r.NoDataMode)
	}
	if err := checkThreshold(r.Metric, r.AlertThreshold); err != nil {
		return err
	}
	if r.WarnThreshold != nil {
		if err := checkThreshold(r.Metric, *r.WarnThreshold); err != nil {
			return err
		}
	}
	if r.RecoveryWindow < 0 || r.RecoveryWindow > 100 {
		return errors.New("recovery_window 범위 오류(0..100)")
	}
	if r.RenotifyMin < 0 || r.RenotifyMin > 1440 {
		return errors.New("renotify_min 범위 오류(0..1440)")
	}
	return nil
}

// checkThreshold 는 threshold 가 유한(NaN/Inf 거부)하고 지표별 합리적 범위인지 본다.
func checkThreshold(m AlertMetric, v float64) error {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return errors.New("임계값이 유한한 숫자가 아닙니다")
	}
	switch m {
	case MetricErrorRate, MetricBlockRate:
		if v < 0 || v > 1 {
			return errors.New("비율 지표 임계는 0..1 이어야 합니다")
		}
	default:
		if v < 0 || v > 1e9 {
			return errors.New("임계값 범위 오류(0..1e9)")
		}
	}
	return nil
}

// WithDefaults 는 옵션 필드 기본값을 채운다(생성 시).
func (r AlertRule) WithDefaults() AlertRule {
	if r.NoDataMode == "" {
		r.NoDataMode = NoDataNoData
	}
	if r.RecoveryWindow == 0 {
		r.RecoveryWindow = 2
	}
	if r.Severity == "" {
		r.Severity = "warning"
	}
	return r
}

// AlertMetricCatalog 은 UI 가 선택지·단위·의미를 발견하는 단일 출처(메트릭 화이트리스트).
type AlertMetricMeta struct {
	Key         AlertMetric `json:"key"`
	Title       string      `json:"title"`
	Unit        string      `json:"unit"`
	LowerBetter bool        `json:"lower_better"`
}

var AlertMetricCatalog = []AlertMetricMeta{
	{MetricTTFTp95, "TTFT p95", "ms", true},
	{MetricLatencyAvg, "E2E 지연 p95", "ms", true},
	{MetricErrorRate, "에러율", "ratio", true},
	{MetricBlockRate, "가드 차단율", "ratio", true},
	{MetricThroughput, "처리량(QPS)", "qps", false},
	{MetricCount, "가드 차단 건수", "count", true},
}
