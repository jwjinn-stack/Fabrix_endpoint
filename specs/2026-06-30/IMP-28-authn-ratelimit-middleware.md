# IMP-28 — BFF 인증·레이트리밋 미들웨어 (IdentityFrom + per-key RateLimit)

브랜치: `feature/evolve-sensitive-r3b` · 날짜: 2026-06-30 · **SENSITIVE(auth/identity + rate-limit)** — PR 라벨 `needs-security-signoff`.

## 목적

현재 미들웨어 체인은 `Logger → CORS` 뿐이고, 신원은 검증되지 않은 `x-user-id` 헤더에 의존한다(핸들러마다 `r.Header.Get` ad-hoc 파싱). 인증/인가/레이트리밋 미들웨어가 없어 (1) 신원 해석이 핸들러에 흩어지고, (2) 폴링형 콘솔이 레이트리밋 없이 백엔드를 두드린다.

본 작업은 신원 해석을 **한 곳(미들웨어)** 으로 모으고(`IdentityFrom(ctx)` 단일 스왑 지점), per-key 토큰버킷 레이트리밋을 추가한다. 실제 IdP/JWT 검증은 범위 밖 — 나중에 `IdentityFrom` 의 소스만 교체할 수 있도록 seam 을 만든다.

## 요구사항

### (A) Authn / identity 미들웨어
- 요청 신원을 한 곳에서 해석해 unexported `type ctxKey` 로 `context` 에 싣는다.
- `IdentityFrom(ctx) (Identity, bool)` 헬퍼를 노출 — 핸들러가 신원을 읽는 **유일한** 경로.
- 현 단계 소스는 헤더지만, raw `x-user-id` 대신 **프록시-set 이름 `x-auth-request-user`** 를 1순위로 읽는다(없으면 레거시 `x-user-id` 폴백). 부서/앱 보조 헤더도 함께 해석.
- 인증은 CORS **뒤**(OPTIONS preflight 는 토큰 불요).
- guard.go 의 ad-hoc `r.Header.Get("x-user-id")` 등을 `IdentityFrom(ctx)` 로 리팩터. salted-hash 귀속 동작은 유지(raw id 출처만 ctx 경유).

### (B) RateLimit 미들웨어
- `golang.org/x/time/rate` 토큰버킷. per-key limiter — key = ctx 신원(있으면), 없으면 `X-Forwarded-For` 의 첫 IP, 그래도 없으면 `RemoteAddr`.
- `sync.Mutex` 로 보호되는 `map[string]*entry` + 백그라운드 cleanup goroutine 이 idle 키를 evict(메모리 누수 가드 — 무한 증가 DoS 방지).
- `limiter.Allow()` 실패 시 `429 Too Many Requests` + `Retry-After` 헤더.
- limit 은 config 기반 + profile-aware: `observe`(읽기 관제, 폴링 많음 → 넉넉) vs `manage`. rps/burst 를 config 로 노출.
- `health`/`capabilities` 엔드포인트는 면제(프로브·부팅 토글이 막히면 안 됨).
- 멀티 레플리카 Redis 공유 store 는 **이번 범위 아님** — 주석으로 후속 표기(현 구현은 per-instance 인메모리).

### Chain 배선
`Logger → CORS → Authn → RateLimit → handlers`

## 함수 시그니처

```go
// httpx/identity.go
type Identity struct {
    UserID string // 프록시-set 신원(x-auth-request-user) 또는 레거시 x-user-id. raw — 보안 클레임 아님.
    Dept   string // x-dept-id (선택)
    AppID  string // x-fabrix-app-id / x-app-id (선택)
}
type ctxKey struct{}                          // unexported — 외부에서 ctx 키 위조 불가
func Authn(next http.Handler) http.Handler    // 신원 해석 → ctx 적재
func IdentityFrom(ctx context.Context) (Identity, bool)
func WithIdentity(ctx context.Context, id Identity) context.Context // 테스트/내부용

// httpx/ratelimit.go
type RateLimitConfig struct {
    RPS         float64       // 초당 토큰 보충률
    Burst       int           // 버킷 용량
    IdleTTL     time.Duration // 이 시간 미사용 키는 cleanup 이 evict
    ExemptPaths []string      // 정확 일치 면제 경로(health/capabilities)
}
func RateLimit(cfg RateLimitConfig) func(http.Handler) http.Handler

// config/config.go
RateLimitRPS   float64 // FABRIX_RATELIMIT_RPS
RateLimitBurst int     // FABRIX_RATELIMIT_BURST
```

## 테스트 케이스
- identity in ctx: `x-auth-request-user` → `IdentityFrom` 으로 읽힘. 레거시 `x-user-id` 폴백.
- missing header: 헤더 없으면 `IdentityFrom` 의 `ok=false`(또는 빈 UserID) — 패닉/거부 없음(현 단계 인증은 거부하지 않고 신원만 해석).
- ratelimit 429 + Retry-After: burst 초과 시 429 와 `Retry-After` 헤더.
- health exempt: 면제 경로는 limit 0 이어도 200.
- cleanup evicts idle: idle TTL 경과 후 키가 map 에서 제거됨.
- profile-aware limit: observe vs manage 의 rps/burst 가 config 로 달라짐(또는 명시 cfg 반영).
- ctx 키 위조 불가: unexported `ctxKey` 라 외부 패키지가 동일 키로 신원 주입 불가.

## 출력 위치
- `backend/internal/httpx/identity.go` (신규)
- `backend/internal/httpx/ratelimit.go` (신규)
- `backend/internal/httpx/identity_test.go`, `ratelimit_test.go` (신규)
- `backend/internal/server/server.go` (Chain 배선 + RateLimitConfig 구성)
- `backend/internal/server/guard.go` (ad-hoc x-user-id → IdentityFrom)
- `backend/internal/config/config.go` (rps/burst)
- `go.mod`/`go.sum` (golang.org/x/time/rate)

## 의존성
- `golang.org/x/time/rate` (golang.org/x — std-adjacent, 승인됨). 다른 신규 deps 없음.
- 폐쇄망: 외부 호출 없음.

## 위협 모델 / 신뢰 경계 (HUMAN SECURITY REVIEWER 必読)

### TB-1: 신원 헤더는 본질적으로 위조 가능(spoofable)
- 본 BFF 는 신원을 HTTP 헤더(`x-auth-request-user`)에서 읽는다. **이 헤더는 인증 프록시(oauth2-proxy / ingress auth)가 설정하고, 엣지가 클라이언트가 보낸 동일 이름 헤더를 반드시 STRIP 해야만** 신뢰할 수 있다.
- 엣지가 strip 하지 않으면 임의 클라이언트가 `x-auth-request-user: ceo@corp` 를 직접 보내 신원을 위조할 수 있다. **이것이 핵심 신뢰 가정이며 코드 주석(`identity.go`)에 명시되어 있다.**
- 현 구현은 **인가 결정을 신원에 걸지 않는다** — 신원은 (a) 증적 귀속(salted hash)과 (b) 레이트리밋 키에만 쓰인다. 위조의 영향은 "남의 증적 핸들로 기록 / 남의 레이트리밋 버킷 소비"에 한정되며, 권한 상승은 없다(라우트 인가는 여전히 capability/profile 미등록으로 차단). 신원에 권한을 거는 순간 엣지-strip 가정이 보안 필수 전제가 된다.
- **swap point**: 실제 IdP/JWT 검증은 `IdentityFrom`/`Authn` 한 곳만 교체하면 됨(서명 검증된 클레임으로). 핸들러는 변경 불요.

### TB-2: 레이트리밋 우회 / DoS
- key = 신원 → 없으면 `X-Forwarded-For` 첫 IP → `RemoteAddr`. XFF 도 위조 가능하나(엣지 미정규화 시) per-key 격리이므로 영향은 자기 버킷에 한정.
- limiter map 무한 증가 = 메모리 DoS 벡터 → 백그라운드 cleanup 이 idle 키 evict 로 가드.
- per-instance 인메모리이므로 **N 레플리카면 실효 한도 ≈ N배**. 정확한 글로벌 한도는 후속 Redis 공유 store 필요(주석 표기).

### TB-3: 민감정보 로깅 없음
- 신원/IP 를 평문 로깅하지 않는다. 증적 경로는 기존 salted SHA-256 비식별 유지.

### HUMAN REVIEWER 가 머지 전 확인할 것
1. **엣지가 클라이언트發 `x-auth-request-user`(및 `x-user-id`, `x-dept-id`, `x-app-id`)를 STRIP 하는지** — ingress/oauth2-proxy 설정 실물 확인. (가장 중요)
2. 신원에 인가를 걸 계획이면 TB-1 가정을 보안 필수 전제로 승격하고 IdP 검증으로 교체.
3. 멀티 레플리카 운영 시 글로벌 레이트리밋이 필요한지(현 per-instance 한도 × N).
4. config 기본 rps/burst 가 정상 폴링 트래픽을 막지 않는지(observe 폴링 주기 대비).
