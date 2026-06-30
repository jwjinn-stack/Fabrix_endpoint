package httpx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Authn 이 x-auth-request-user(프록시-set)를 신원으로 해석해 ctx 에 싣고,
// IdentityFrom 으로 읽히는지 확인한다.
func TestAuthn_ProxyHeaderFlowsToContext(t *testing.T) {
	var got Identity
	var ok bool
	h := Authn(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got, ok = IdentityFrom(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("x-auth-request-user", "alice@corp")
	req.Header.Set("x-dept-id", "trading")
	req.Header.Set("x-fabrix-app-id", "console")
	h.ServeHTTP(httptest.NewRecorder(), req)

	if !ok {
		t.Fatal("IdentityFrom ok=false; 신원이 ctx 에 실리지 않음")
	}
	if got.UserID != "alice@corp" || got.Dept != "trading" || got.AppID != "console" {
		t.Fatalf("신원 해석 불일치: %+v", got)
	}
}

// 레거시 x-user-id 폴백(프록시 헤더 부재 시)을 확인한다.
func TestAuthn_LegacyUserIDFallback(t *testing.T) {
	var got Identity
	h := Authn(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got, _ = IdentityFrom(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("x-user-id", "legacy@corp")
	req.Header.Set("x-app-id", "alt")
	h.ServeHTTP(httptest.NewRecorder(), req)

	if got.UserID != "legacy@corp" {
		t.Fatalf("레거시 폴백 실패: UserID=%q", got.UserID)
	}
	if got.AppID != "alt" {
		t.Fatalf("x-app-id alt 폴백 실패: AppID=%q", got.AppID)
	}
}

// 헤더가 전혀 없으면 빈 신원이 실리고 패닉/거부가 없어야 한다(현 단계 인증은 거부 안 함).
func TestAuthn_MissingHeaderNoPanic(t *testing.T) {
	var got Identity
	var ok bool
	h := Authn(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok = IdentityFrom(r.Context())
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("거부됨: status=%d (현 단계 인증은 거부하면 안 됨)", rec.Code)
	}
	// Authn 이 적용되었으므로 ok=true 이되 UserID 는 빈 문자열.
	if !ok || got.UserID != "" {
		t.Fatalf("빈 신원 기대, got ok=%v id=%+v", ok, got)
	}
}

// Authn 미적용 ctx 에서 IdentityFrom 은 ok=false 를 반환해야 한다.
func TestIdentityFrom_NoMiddleware(t *testing.T) {
	if _, ok := IdentityFrom(context.Background()); ok {
		t.Fatal("미적용 ctx 에서 ok=true 면 안 됨")
	}
}

// WithIdentity(테스트/내부 조립용)로 심은 신원이 IdentityFrom 으로 읽혀야 한다.
func TestWithIdentity_RoundTrip(t *testing.T) {
	ctx := WithIdentity(context.Background(), Identity{UserID: "bob"})
	id, ok := IdentityFrom(ctx)
	if !ok || id.UserID != "bob" {
		t.Fatalf("WithIdentity 왕복 실패: ok=%v id=%+v", ok, id)
	}
}
