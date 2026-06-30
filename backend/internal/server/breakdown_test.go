package server

import (
	"testing"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// IMP-6: outliers 는 카탈로그 임계치를 위반한 행만 사유와 함께, 사유 많은 순으로 반환한다.
// 양방향 검증: TTFT/ITL(LowerBetter, WarnAbove) 과 cache_hit_rate(!LowerBetter, WarnBelow).
func TestOutliers(t *testing.T) {
	rows := []domain.MetricsBreakdownRow{
		{Key: "healthy", TTFTp95ms: 100, ITLavgMs: 10, E2Ep95ms: 200, CacheHitRate: 0.9},   // 위반 0 → 제외
		{Key: "slow-ttft", TTFTp95ms: 600, ITLavgMs: 10, E2Ep95ms: 200, CacheHitRate: 0.9}, // TTFT>500 → 1
		{Key: "low-cache", TTFTp95ms: 100, ITLavgMs: 10, E2Ep95ms: 200, CacheHitRate: 0.3}, // cache<0.5 → 1
		{Key: "triple", TTFTp95ms: 700, ITLavgMs: 60, E2Ep95ms: 200, CacheHitRate: 0.2},    // TTFT·ITL·cache → 3
	}
	got := outliers(rows)

	if len(got) != 3 {
		t.Fatalf("위반 행 3개여야 하는데 %d개: %v", len(got), got)
	}
	if got[0]["key"] != "triple" {
		t.Errorf("사유 최다 행(triple)이 먼저 와야 하는데 첫 행=%v", got[0]["key"])
	}
	reasons0, _ := got[0]["reasons"].([]string)
	if len(reasons0) != 3 {
		t.Errorf("triple 행은 사유 3개여야 하는데 %d개: %v", len(reasons0), reasons0)
	}
	for _, r := range got {
		if r["key"] == "healthy" {
			t.Errorf("위반 없는 healthy 행이 결과에 포함됨")
		}
	}
}

// IMP-6: cache_hit_rate=0(데이터 없음)은 WarnBelow 위반으로 치지 않는다(v>0 가드).
func TestOutliers_ZeroCacheNotFlagged(t *testing.T) {
	rows := []domain.MetricsBreakdownRow{
		{Key: "no-cache-data", TTFTp95ms: 100, ITLavgMs: 10, CacheHitRate: 0},
	}
	if got := outliers(rows); len(got) != 0 {
		t.Errorf("cache=0(무데이터)은 위반 아님 — 결과 0개여야 하는데 %v", got)
	}
}
