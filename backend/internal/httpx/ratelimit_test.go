package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
}

// burst 초과 시 429 + Retry-After 헤더를 확인한다.
func TestRateLimit_OverLimitReturns429WithRetryAfter(t *testing.T) {
	mw := RateLimit(RateLimitConfig{RPS: 1, Burst: 2, IdleTTL: time.Minute})
	h := mw(okHandler())

	newReq := func() *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/traces", nil)
		r.RemoteAddr = "10.0.0.1:1234"
		return r
	}
	// burst=2 → 처음 2개 통과.
	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, newReq())
		if rec.Code != http.StatusOK {
			t.Fatalf("요청 %d: status=%d, want 200", i, rec.Code)
		}
	}
	// 3번째는 429 + Retry-After.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, newReq())
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("over-limit status=%d, want 429", rec.Code)
	}
	if ra := rec.Header().Get("Retry-After"); ra == "" {
		t.Fatal("Retry-After 헤더 누락")
	}
}

// 면제 경로(health/capabilities)는 한도와 무관하게 통과해야 한다.
func TestRateLimit_ExemptPaths(t *testing.T) {
	mw := RateLimit(RateLimitConfig{
		RPS: 1, Burst: 1, IdleTTL: time.Minute,
		ExemptPaths: []string{"/api/v1/healthz", "/api/v1/capabilities"},
	})
	h := mw(okHandler())
	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
		req.RemoteAddr = "10.0.0.2:1"
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("면제 경로가 막힘: 요청 %d status=%d", i, rec.Code)
		}
	}
}

// OPTIONS preflight 는 항상 면제.
func TestRateLimit_OptionsExempt(t *testing.T) {
	mw := RateLimit(RateLimitConfig{RPS: 1, Burst: 1, IdleTTL: time.Minute})
	h := mw(okHandler())
	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodOptions, "/api/v1/traces", nil)
		req.RemoteAddr = "10.0.0.3:1"
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("OPTIONS 가 막힘: 요청 %d status=%d", i, rec.Code)
		}
	}
}

// 신원이 있으면 키가 신원별로 분리돼 서로 다른 사용자는 독립 버킷을 가진다.
func TestRateLimit_PerIdentityBucket(t *testing.T) {
	mw := RateLimit(RateLimitConfig{RPS: 1, Burst: 1, IdleTTL: time.Minute})
	h := mw(okHandler())

	doFor := func(user string) int {
		ctx := WithIdentity(httptest.NewRequest(http.MethodGet, "/api/v1/traces", nil).Context(), Identity{UserID: user})
		req := httptest.NewRequest(http.MethodGet, "/api/v1/traces", nil).WithContext(ctx)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if c := doFor("alice"); c != http.StatusOK {
		t.Fatalf("alice 첫 요청 status=%d, want 200", c)
	}
	// 다른 사용자 bob 은 독립 버킷이므로 통과.
	if c := doFor("bob"); c != http.StatusOK {
		t.Fatalf("bob 첫 요청 status=%d, want 200 (버킷 분리 실패)", c)
	}
	// alice 두번째는 버킷 소진(burst=1) → 429.
	if c := doFor("alice"); c != http.StatusTooManyRequests {
		t.Fatalf("alice 두번째 status=%d, want 429", c)
	}
}

// RPS/Burst<=0 이면 레이트리밋 비활성(no-op) — 무제한 통과.
func TestRateLimit_DisabledWhenZero(t *testing.T) {
	mw := RateLimit(RateLimitConfig{RPS: 0, Burst: 0})
	h := mw(okHandler())
	for i := 0; i < 100; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/traces", nil)
		req.RemoteAddr = "10.0.0.4:1"
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("비활성인데 막힘: 요청 %d status=%d", i, rec.Code)
		}
	}
}

// idle TTL 경과 키가 cleanup(evictIdle)에 의해 map 에서 제거되는지 확인(메모리 bound).
func TestLimiterStore_EvictIdle(t *testing.T) {
	store := newLimiterStore(10, 10, 50*time.Millisecond)
	store.get("k1")
	store.get("k2")
	if store.len() != 2 {
		t.Fatalf("초기 키 수=%d, want 2", store.len())
	}
	// 미래 시점으로 evict → 두 키 모두 idle 초과.
	store.evictIdle(time.Now().Add(time.Second))
	if store.len() != 0 {
		t.Fatalf("evict 후 키 수=%d, want 0 (idle 키 미제거 — 메모리 누수)", store.len())
	}
}

// XFF 첫 IP 가 키로 쓰이는지(신원 부재 시) 확인.
func TestRateKey_XForwardedFor(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
	r.RemoteAddr = "10.0.0.1:5"
	if k := rateKey(r); k != "ip:203.0.113.7" {
		t.Fatalf("XFF 첫 IP 키 불일치: %q", k)
	}
}

// 신원이 있으면 신원 키가 IP 보다 우선.
func TestRateKey_IdentityWins(t *testing.T) {
	ctx := WithIdentity(httptest.NewRequest(http.MethodGet, "/x", nil).Context(), Identity{UserID: "carol"})
	r := httptest.NewRequest(http.MethodGet, "/x", nil).WithContext(ctx)
	r.Header.Set("X-Forwarded-For", "203.0.113.7")
	if k := rateKey(r); k != "u:carol" {
		t.Fatalf("신원 키 우선 실패: %q", k)
	}
}
