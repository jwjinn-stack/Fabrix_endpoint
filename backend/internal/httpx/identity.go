package httpx

import (
	"context"
	"net/http"
	"strings"
)

// ─────────────────────────────────────────────────────────────────────────────
// 신뢰 경계 (THREAT MODEL — 보안 리뷰어 必読)
//
// 이 BFF 는 요청 신원을 HTTP 헤더에서 읽는다. HTTP 헤더는 본질적으로 위조 가능
// (SPOOFABLE)하다. 1순위 소스 x-auth-request-user 는 인증 프록시(oauth2-proxy /
// ingress auth)가 설정하는 헤더로, **엣지(ingress/proxy)가 클라이언트가 보낸 동일
// 이름의 헤더를 반드시 STRIP 해야만** 신뢰할 수 있다. 엣지가 strip 하지 않으면 임의
// 클라이언트가 x-auth-request-user 를 직접 보내 신원을 위조할 수 있다.
//
// 따라서 현 구현은 신원에 **인가(authorization) 결정을 걸지 않는다**. 신원은
//   (a) 증적 귀속(salted SHA-256 해시 — 보안 클레임 아님, 상관관계 핸들)
//   (b) 레이트리밋 버킷 키
// 에만 쓰인다. 위조의 영향은 "남의 핸들로 증적 기록 / 남의 버킷 소비"에 한정되며
// 권한 상승은 없다(라우트 인가는 capability/profile 미등록이 담당).
//
// SWAP POINT: 실제 IdP/JWT 검증으로 교체할 때는 이 파일의 Authn/IdentityFrom 한
// 곳만 바꾸면 된다(서명 검증된 클레임 → Identity). 핸들러는 IdentityFrom 만 쓰므로
// 변경 불요. 그 시점에 위 엣지-strip 가정은 "보안 필수 전제"로 승격되어야 한다.
// ─────────────────────────────────────────────────────────────────────────────

// Identity 는 한 요청의 해석된 신원이다. 모든 필드는 검증되지 않은(unverified)
// 헤더에서 왔다 — 보안 클레임으로 취급하지 말 것(위 신뢰 경계 참조).
type Identity struct {
	// UserID 는 프록시-set 신원(x-auth-request-user) 또는 레거시 x-user-id. raw 값.
	UserID string
	// Dept 는 부서 힌트(x-dept-id). 없을 수 있음.
	Dept string
	// AppID 는 앱 힌트(x-fabrix-app-id / x-app-id). 없을 수 있음.
	AppID string
}

// ctxKey 는 unexported — 외부 패키지가 동일 키로 ctx 에 신원을 위조 주입할 수 없다.
type ctxKey struct{}

// 신원 헤더 이름. 프록시-set(x-auth-request-user)이 1순위, 레거시(x-user-id)는 폴백.
// 엣지는 클라이언트가 보낸 이 헤더들을 STRIP 해야 한다(위 신뢰 경계).
const (
	hdrAuthUser = "x-auth-request-user" // oauth2-proxy 가 set 하는 표준 신원 헤더(프록시 신뢰)
	hdrUserID   = "x-user-id"           // 레거시 폴백
	hdrDept     = "x-dept-id"
	hdrAppID    = "x-fabrix-app-id"
	hdrAppIDAlt = "x-app-id"
)

// resolveIdentity 는 요청 헤더에서 신원을 해석한다(검증하지 않음 — 신뢰 경계 참조).
func resolveIdentity(r *http.Request) Identity {
	uid := strings.TrimSpace(r.Header.Get(hdrAuthUser))
	if uid == "" {
		uid = strings.TrimSpace(r.Header.Get(hdrUserID)) // 레거시 폴백
	}
	app := strings.TrimSpace(r.Header.Get(hdrAppID))
	if app == "" {
		app = strings.TrimSpace(r.Header.Get(hdrAppIDAlt))
	}
	return Identity{
		UserID: uid,
		Dept:   strings.TrimSpace(r.Header.Get(hdrDept)),
		AppID:  app,
	}
}

// Authn 은 요청 신원을 한 곳에서 해석해 ctx 에 싣는 미들웨어다.
//
// 현 단계는 인증을 거부하지 않는다(신원만 해석 — 위조 가능 헤더에 거부를 거는 것은
// 무의미). 라우트 인가는 server 의 capability/profile 게이팅이 담당한다. 인증은
// CORS 뒤에 배선되어 OPTIONS preflight 에는 영향을 주지 않는다.
func Authn(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := resolveIdentity(r)
		ctx := context.WithValue(r.Context(), ctxKey{}, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// IdentityFrom 은 ctx 에서 해석된 신원을 꺼낸다. 핸들러가 신원을 읽는 유일한 경로다.
// ok=false 면 Authn 이 적용되지 않았거나 신원이 없는 것(빈 Identity 반환).
func IdentityFrom(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(ctxKey{}).(Identity)
	return id, ok
}

// WithIdentity 는 ctx 에 신원을 심는다(테스트·내부 조립용). 프로덕션 경로는 Authn 을 쓴다.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}
