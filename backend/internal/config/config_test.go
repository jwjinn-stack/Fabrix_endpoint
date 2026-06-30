package config

import "testing"

// profile-aware 레이트리밋 기본값: observe(폴링 많음)가 manage 보다 넉넉해야 한다.
func TestLoad_ProfileAwareRateLimit(t *testing.T) {
	// 명시 env 가 기본값을 가리지 않도록 비운다.
	t.Setenv("FABRIX_RATELIMIT_RPS", "")
	t.Setenv("FABRIX_RATELIMIT_BURST", "")

	t.Setenv("FABRIX_PROFILE", "manage")
	manage := Load()

	t.Setenv("FABRIX_PROFILE", "observe")
	observe := Load()

	if !(observe.RateLimitRPS > manage.RateLimitRPS) {
		t.Fatalf("observe RPS(%v) 가 manage(%v) 보다 커야 함", observe.RateLimitRPS, manage.RateLimitRPS)
	}
	if !(observe.RateLimitBurst > manage.RateLimitBurst) {
		t.Fatalf("observe Burst(%d) 가 manage(%d) 보다 커야 함", observe.RateLimitBurst, manage.RateLimitBurst)
	}
	if manage.RateLimitRPS <= 0 || manage.RateLimitBurst <= 0 {
		t.Fatalf("manage 기본 레이트리밋이 비활성이면 안 됨: rps=%v burst=%d", manage.RateLimitRPS, manage.RateLimitBurst)
	}
}

// env 명시 오버라이드가 profile 기본값을 이긴다.
func TestLoad_RateLimitEnvOverride(t *testing.T) {
	t.Setenv("FABRIX_PROFILE", "observe")
	t.Setenv("FABRIX_RATELIMIT_RPS", "5")
	t.Setenv("FABRIX_RATELIMIT_BURST", "7")
	c := Load()
	if c.RateLimitRPS != 5 || c.RateLimitBurst != 7 {
		t.Fatalf("env 오버라이드 실패: rps=%v burst=%d", c.RateLimitRPS, c.RateLimitBurst)
	}
}
