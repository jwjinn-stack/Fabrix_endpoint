package domain

import "testing"

func TestParseRange(t *testing.T) {
	cases := map[string]TimeRange{
		"1h": Range1h, "6h": Range6h, "24h": Range24h, "7d": Range7d,
		"":      Range1h, // 미지정 → 1h
		"bogus": Range1h, // 불명 → 1h
		"30m":   Range1h,
	}
	for in, want := range cases {
		if got := ParseRange(in); got != want {
			t.Errorf("ParseRange(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRangeBucketsAndStep(t *testing.T) {
	// 버킷수 × 스텝(초) ≈ 기간. 시계열 길이 일관성 검증.
	cases := []struct {
		r          TimeRange
		wantPromD  string
		minSeconds int
	}{
		{Range1h, "1h", 3600},
		{Range6h, "6h", 6 * 3600},
		{Range24h, "24h", 24 * 3600},
		{Range7d, "7d", 7 * 24 * 3600},
	}
	for _, c := range cases {
		if c.r.PromDuration() != c.wantPromD {
			t.Errorf("%s PromDuration = %q, want %q", c.r, c.r.PromDuration(), c.wantPromD)
		}
		span := c.r.Buckets() * c.r.StepSeconds()
		// 창 길이가 기간의 90~110% 안인지 (버킷-1 오차 허용)
		if span < c.minSeconds*9/10 || span > c.minSeconds*11/10 {
			t.Errorf("%s span = %ds, want ≈ %ds", c.r, span, c.minSeconds)
		}
		if c.r.Buckets() <= 1 {
			t.Errorf("%s Buckets = %d, want > 1", c.r, c.r.Buckets())
		}
	}
}
