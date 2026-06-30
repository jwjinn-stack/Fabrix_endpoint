package httpx

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ─────────────────────────────────────────────────────────────────────────────
// RateLimit — per-key 토큰버킷 (THREAT MODEL — 보안 리뷰어 必読)
//
// 키 산정: ctx 신원(IdentityFrom) UserID 우선 → 없으면 X-Forwarded-For 첫 IP →
// 그래도 없으면 RemoteAddr. 신원/XFF 모두 위조 가능하나(엣지 미정규화 시) per-key
// 격리이므로 위조의 영향은 "자기(또는 위조한 키의) 버킷 소비"에 한정 — 권한 상승 없음.
//
// 메모리 DoS 가드: 키별 limiter 를 map 에 보관하므로 무한 증가가 메모리 DoS 벡터다.
// 백그라운드 cleanup goroutine 이 IdleTTL 미사용 키를 evict 해 map 크기를 bound 한다.
//
// 멀티 레플리카: 본 구현은 per-instance 인메모리다. N 레플리카면 실효 한도 ≈ N배.
// 정확한 글로벌 한도는 후속 Redis 공유 store 가 필요(이번 범위 아님).
//
// 민감정보 로깅: 키(신원/IP)를 평문 로깅하지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

// RateLimitConfig 는 RateLimit 미들웨어 설정. 미들웨어 생성자에 주입되므로 테스트 가능하다.
type RateLimitConfig struct {
	// RPS 는 초당 토큰 보충률(키별).
	RPS float64
	// Burst 는 버킷 용량(순간 허용량). RPS<=0 또는 Burst<=0 이면 레이트리밋 비활성(통과).
	Burst int
	// IdleTTL 은 이 시간 동안 미사용된 키를 cleanup 이 evict 하는 임계. 0 이면 기본 10분.
	IdleTTL time.Duration
	// ExemptPaths 는 정확 일치로 면제할 경로(health/capabilities). OPTIONS 는 항상 면제.
	ExemptPaths []string
}

// entry 는 한 키의 limiter 와 마지막 사용 시각(idle eviction 용)이다.
type entry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// limiterStore 는 키별 limiter 를 mutex 로 보호하며 보관하고, idle 키를 주기적으로 evict 한다.
type limiterStore struct {
	mu      sync.Mutex
	keys    map[string]*entry
	rps     rate.Limit
	burst   int
	idleTTL time.Duration
}

func newLimiterStore(rps float64, burst int, idleTTL time.Duration) *limiterStore {
	s := &limiterStore{
		keys:    make(map[string]*entry),
		rps:     rate.Limit(rps),
		burst:   burst,
		idleTTL: idleTTL,
	}
	go s.cleanupLoop()
	return s
}

// get 은 키의 limiter 를 반환한다(없으면 생성). lastSeen 을 갱신한다.
func (s *limiterStore) get(key string) *rate.Limiter {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.keys[key]
	if !ok {
		e = &entry{limiter: rate.NewLimiter(s.rps, s.burst)}
		s.keys[key] = e
	}
	e.lastSeen = time.Now()
	return e.limiter
}

// len 은 현재 보관 중인 키 수를 반환한다(테스트용).
func (s *limiterStore) len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.keys)
}

// evictIdle 은 idleTTL 이 지난 키를 제거한다(메모리 bound). 테스트가 직접 호출할 수 있다.
func (s *limiterStore) evictIdle(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, e := range s.keys {
		if now.Sub(e.lastSeen) > s.idleTTL {
			delete(s.keys, k)
		}
	}
}

// cleanupLoop 는 idleTTL 주기로 idle 키를 evict 하는 백그라운드 goroutine 이다.
// 프로세스 수명과 동기화 — 서버가 살아있는 동안 동작(데몬). 의도적으로 종료 채널 없음
// (서버 종료 시 프로세스와 함께 회수). interval 은 IdleTTL(최소 30s 로 클램프).
func (s *limiterStore) cleanupLoop() {
	interval := s.idleTTL
	if interval < 30*time.Second {
		interval = 30 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for range t.C {
		s.evictIdle(time.Now())
	}
}

// RateLimit 은 per-key 토큰버킷 레이트리밋 미들웨어를 만든다. cfg 를 주입받아 테스트 가능.
// cfg.RPS<=0 또는 cfg.Burst<=0 이면 no-op(통과) — 레이트리밋 비활성 구성.
func RateLimit(cfg RateLimitConfig) func(http.Handler) http.Handler {
	if cfg.RPS <= 0 || cfg.Burst <= 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	idleTTL := cfg.IdleTTL
	if idleTTL <= 0 {
		idleTTL = 10 * time.Minute
	}
	exempt := make(map[string]bool, len(cfg.ExemptPaths))
	for _, p := range cfg.ExemptPaths {
		exempt[p] = true
	}
	store := newLimiterStore(cfg.RPS, cfg.Burst, idleTTL)

	// retryAfter 는 토큰 1개 보충에 걸리는 시간을 올림 초 단위로(최소 1초).
	retryAfter := "1"
	if cfg.RPS > 0 {
		if secs := int(1.0/cfg.RPS + 0.999); secs > 1 {
			retryAfter = strconv.Itoa(secs)
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// OPTIONS preflight 와 면제 경로(health/capabilities)는 통과.
			if r.Method == http.MethodOptions || exempt[r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}
			key := rateKey(r)
			if !store.get(key).Allow() {
				w.Header().Set("Retry-After", retryAfter)
				Error(w, http.StatusTooManyRequests, "요청이 너무 많습니다. 잠시 후 다시 시도하세요.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// rateKey 는 레이트리밋 버킷 키를 산정한다: 신원 UserID → XFF 첫 IP → RemoteAddr.
func rateKey(r *http.Request) string {
	if id, ok := IdentityFrom(r.Context()); ok && id.UserID != "" {
		return "u:" + id.UserID
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if ip := strings.TrimSpace(strings.Split(xff, ",")[0]); ip != "" {
			return "ip:" + ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return "ip:" + host
}
