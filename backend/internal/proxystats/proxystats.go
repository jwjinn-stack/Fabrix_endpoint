// Package proxystats 는 우리 추론 프록시(트레이스 지점)의 실측 통계를 인메모리로 수집한다.
// victoria-traces 에 OTLP span 이 아직 없으므로(미수집), 프록시 자체가 측정 지점이다.
// 가드레일 지연·업스트림 지연·프록시 오버헤드·차단율을 최근 윈도우로 집계한다(트래픽/프록시 뷰 4-5).
package proxystats

import (
	"sort"
	"sync"
	"time"
)

type record struct {
	ts         time.Time
	guardMs    int64
	upstreamMs int64
	blocked    bool
	model      string
}

// Collector 는 최근 요청 기록 링버퍼.
type Collector struct {
	mu  sync.Mutex
	buf []record
	cap int
}

// New 는 수집기를 만든다(최근 2000건 유지).
func New() *Collector { return &Collector{cap: 2000} }

// Record 는 한 요청의 측정치를 기록한다.
func (c *Collector) Record(guardMs, upstreamMs int64, blocked bool, model string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.buf = append(c.buf, record{ts: time.Now(), guardMs: guardMs, upstreamMs: upstreamMs, blocked: blocked, model: model})
	if len(c.buf) > c.cap {
		c.buf = c.buf[len(c.buf)-c.cap:]
	}
}

// Stats 는 트래픽/프록시 뷰 응답.
type Stats struct {
	WindowSec     int            `json:"window_sec"`
	Total         int            `json:"total"`
	Blocked       int            `json:"blocked"`
	Allowed       int            `json:"allowed"`
	BlockRate     float64        `json:"block_rate"`      // 0..1
	AvgGuardMs    float64        `json:"avg_guard_ms"`    // 가드레일 처리 평균
	AvgUpstreamMs float64        `json:"avg_upstream_ms"` // 엔진 왕복 평균
	P95UpstreamMs float64        `json:"p95_upstream_ms"`
	OverheadPerc  float64        `json:"overhead_perc"` // guard/(guard+upstream)
	ByModel       map[string]int `json:"by_model"`
	QPM           float64        `json:"qpm"` // 분당 요청(윈도우 환산)
}

// Snapshot 은 최근 windowSec 초의 집계를 반환한다.
func (c *Collector) Snapshot(windowSec int) Stats {
	c.mu.Lock()
	defer c.mu.Unlock()
	cut := time.Now().Add(-time.Duration(windowSec) * time.Second)
	st := Stats{WindowSec: windowSec, ByModel: map[string]int{}}
	var sumG, sumU float64
	ups := make([]float64, 0, len(c.buf))
	for _, r := range c.buf {
		if r.ts.Before(cut) {
			continue
		}
		st.Total++
		if r.blocked {
			st.Blocked++
		} else {
			st.Allowed++
			sumU += float64(r.upstreamMs)
			ups = append(ups, float64(r.upstreamMs))
		}
		sumG += float64(r.guardMs)
		st.ByModel[r.model]++
	}
	if st.Total > 0 {
		st.BlockRate = round(float64(st.Blocked)/float64(st.Total), 3)
		st.AvgGuardMs = round(sumG/float64(st.Total), 1)
		st.QPM = round(float64(st.Total)/(float64(windowSec)/60.0), 2)
	}
	if st.Allowed > 0 {
		st.AvgUpstreamMs = round(sumU/float64(st.Allowed), 1)
	}
	st.P95UpstreamMs = round(p95(ups), 1)
	if st.AvgGuardMs+st.AvgUpstreamMs > 0 {
		st.OverheadPerc = round(st.AvgGuardMs/(st.AvgGuardMs+st.AvgUpstreamMs), 3)
	}
	return st
}

func p95(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	sort.Float64s(v)
	idx := int(0.95 * float64(len(v)-1))
	return v[idx]
}

func round(v float64, places int) float64 {
	p := 1.0
	for i := 0; i < places; i++ {
		p *= 10
	}
	return float64(int(v*p+0.5)) / p
}
