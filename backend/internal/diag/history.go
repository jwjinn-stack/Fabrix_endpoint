package diag

import "sync"

// History 는 의존성별 최근 N회 프로브 결과를 인메모리 ring buffer 로 보관한다.
// 외부 저장소 없이 "언제부터 느려졌나/끊겼나"(추세 sparkline)를 보여주기 위한 경량 구조.
// Pod 재시작 시 초기화된다(영속성 불필요 — 즉시성 진단 도구).
type History struct {
	mu  sync.Mutex
	max int
	buf map[string][]Sample
}

// NewHistory 는 의존성당 최대 max 개를 보관하는 History 를 만든다.
func NewHistory(max int) *History {
	if max <= 0 {
		max = 50
	}
	return &History{max: max, buf: make(map[string][]Sample)}
}

// Record 는 1건을 기록한다(가장 오래된 건 밀어냄).
func (h *History) Record(name string, s Sample) {
	h.mu.Lock()
	defer h.mu.Unlock()
	b := append(h.buf[name], s)
	if len(b) > h.max {
		b = b[len(b)-h.max:]
	}
	h.buf[name] = b
}

// Get 은 name 의 이력 복사본을 반환한다(오래된→최신).
func (h *History) Get(name string) []Sample {
	h.mu.Lock()
	defer h.mu.Unlock()
	src := h.buf[name]
	out := make([]Sample, len(src))
	copy(out, src)
	return out
}

// Ingest 는 Report 의 각 check 를 기록하고(configured 인 것만), 동시에 각 check 에
// 누적 이력을 붙인다. now 문자열은 Report.GeneratedAt 을 그대로 쓴다.
func (h *History) Ingest(rep *Report) {
	for i := range rep.Checks {
		c := &rep.Checks[i]
		if c.Configured {
			h.Record(c.Name, Sample{
				At:        rep.GeneratedAt,
				Reachable: c.Reachable,
				LatencyMs: c.LatencyMs,
				FailKind:  c.FailKind,
			})
		}
		c.History = h.Get(c.Name)
	}
}
