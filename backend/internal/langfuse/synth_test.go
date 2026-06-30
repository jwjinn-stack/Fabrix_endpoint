package langfuse

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// Score JSON 직렬화 — TS(web/src/api/types.ts)와 1:1 snake_case 키 + omitempty.
func TestScoreSerialization(t *testing.T) {
	sc := domain.Score{
		Name: "정확성", Value: 4, DataType: "numeric", Comment: "근거 명확",
		Source: "llm-judge", TraceID: "tr_abc", TS: "2026-06-30T00:00:00Z",
	}
	b, err := json.Marshal(sc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(b)
	for _, key := range []string{`"name"`, `"value"`, `"data_type"`, `"source"`, `"trace_id"`, `"ts"`} {
		if !strings.Contains(s, key) {
			t.Errorf("필수 키 누락: %s in %s", key, s)
		}
	}
	// omitempty: string_value/observation_id/session_id 는 빈값이면 생략.
	for _, key := range []string{`"string_value"`, `"observation_id"`, `"session_id"`} {
		if strings.Contains(s, key) {
			t.Errorf("빈값인데 직렬화됨(omitempty 위반): %s in %s", key, s)
		}
	}
	// 라운드트립.
	var back domain.Score
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back.Name != sc.Name || back.Value != sc.Value || back.DataType != sc.DataType {
		t.Errorf("라운드트립 불일치: %+v vs %+v", back, sc)
	}
}

// p50i nearest-rank 중앙값.
func TestP50i(t *testing.T) {
	cases := []struct {
		in   []int
		want int
	}{
		{[]int{100, 200, 300, 400}, 200}, // (4-1)/2 = idx1 = 200 (lower median, nearest-rank)
		{[]int{100, 200, 300}, 200},
		{[]int{42}, 42},
		{nil, 0},
	}
	for _, c := range cases {
		if got := p50i(c.in); got != c.want {
			t.Errorf("p50i(%v)=%d want %d", c.in, got, c.want)
		}
	}
}

func TestAvgi(t *testing.T) {
	if got := avgi([]int{100, 200, 300, 400}); got != 250 {
		t.Errorf("avgi=%d want 250", got)
	}
	if got := avgi(nil); got != 0 {
		t.Errorf("avgi(nil)=%d want 0", got)
	}
}

// 세션 지연 롤업 — synthSessionDetail 의 summary 가 p50/avg 를 채우고, turns 와 일관.
func TestSessionLatencyRollup(t *testing.T) {
	d := synthSessionDetail("sess_1")
	sum := d.Summary
	if len(d.Turns) == 0 {
		t.Fatal("턴이 없음")
	}
	if sum.TTFTP50Ms <= 0 || sum.TTFTAvgMs <= 0 || sum.LatencyP50Ms <= 0 {
		t.Errorf("지연 롤업 미채움: ttft_p50=%d ttft_avg=%d latency_p50=%d", sum.TTFTP50Ms, sum.TTFTAvgMs, sum.LatencyP50Ms)
	}
	// 직접 계산과 일치하는지 검증.
	ttfts, e2es := []int{}, []int{}
	for _, tn := range d.Turns {
		ttfts = append(ttfts, tn.TTFTMs)
		e2es = append(e2es, tn.TotalMs)
	}
	if sum.TTFTP50Ms != p50i(ttfts) || sum.TTFTAvgMs != avgi(ttfts) || sum.LatencyP50Ms != p50i(e2es) {
		t.Errorf("롤업이 turns 와 불일치")
	}
}

// 합성 점수 — 결정적이며, 부착 시 trace_id/source 채워짐.
func TestSynthScores(t *testing.T) {
	a := synthScores(12345, "tr_x", "sess_x", "")
	b := synthScores(12345, "tr_x", "sess_x", "")
	if len(a) != len(b) {
		t.Errorf("결정적이지 않음: %d vs %d", len(a), len(b))
	}
	for _, sc := range a {
		if sc.TraceID != "tr_x" || sc.Source != "llm-judge" {
			t.Errorf("부착 메타 불완전: %+v", sc)
		}
		if sc.DataType != "numeric" && sc.DataType != "categorical" && sc.DataType != "boolean" {
			t.Errorf("잘못된 data_type: %s", sc.DataType)
		}
	}
}
