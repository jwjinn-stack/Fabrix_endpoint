package domain

import "testing"

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// IMP-7: AnnotateWarnings — 절대 임계(TTFT>500, cache<0.5) 판정 + 정상 행 warn=false.
func TestAnnotateWarnings_Absolute(t *testing.T) {
	b := &MetricsBreakdown{Rows: []MetricsBreakdownRow{
		{Key: "ok", TTFTp95ms: 100, ITLavgMs: 10, CacheHitRate: 0.9},
		{Key: "ttft-abs", TTFTp95ms: 600, ITLavgMs: 10, CacheHitRate: 0.9},
		{Key: "cache-low", TTFTp95ms: 100, ITLavgMs: 10, CacheHitRate: 0.3},
	}}
	AnnotateWarnings(b)
	byKey := map[string]MetricsBreakdownRow{}
	for _, r := range b.Rows {
		byKey[r.Key] = r
	}
	if byKey["ok"].Warn {
		t.Errorf("정상 행은 warn=false 여야 하는데 keys=%v", byKey["ok"].WarnKeys)
	}
	if !byKey["ttft-abs"].Warn || !contains(byKey["ttft-abs"].WarnKeys, "ttft_p95_ms") {
		t.Errorf("ttft-abs 행은 ttft_p95_ms warn 이어야: %v", byKey["ttft-abs"].WarnKeys)
	}
	if !byKey["cache-low"].Warn || !contains(byKey["cache-low"].WarnKeys, "cache_hit_rate") {
		t.Errorf("cache-low 행은 cache_hit_rate warn 이어야: %v", byKey["cache-low"].WarnKeys)
	}
}

// IMP-7: 상대 편차(중앙값*1.6) — 절대 임계가 없는 e2e_p95_ms 도 컬럼 중앙값 대비 크면 warn.
func TestAnnotateWarnings_Relative(t *testing.T) {
	b := &MetricsBreakdown{Rows: []MetricsBreakdownRow{
		{Key: "a", E2Ep95ms: 100},
		{Key: "b", E2Ep95ms: 100},
		{Key: "c", E2Ep95ms: 100},
		{Key: "spike", E2Ep95ms: 1000}, // 중앙값 100 → 1.6배(160) 초과 → 상대 warn
	}}
	AnnotateWarnings(b)
	var spike MetricsBreakdownRow
	for _, r := range b.Rows {
		if r.Key == "spike" {
			spike = r
		}
	}
	if !spike.Warn || !contains(spike.WarnKeys, "e2e_p95_ms") {
		t.Errorf("spike 행은 상대편차로 e2e_p95_ms warn 이어야: keys=%v", spike.WarnKeys)
	}
}
