package glue

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// PolicyStore 는 FABRIX BFF 의 마스킹 정책을 주기적으로 폴링·캐시한다.
// 폴링 실패 시 마지막 양호 값(없으면 기본값)을 유지해 글루가 항상 정책을 쓸 수 있게 한다.
type PolicyStore struct {
	url      string // {bff}/api/v1/masking/policy
	interval time.Duration
	http     *http.Client

	mu      sync.RWMutex
	current domain.MaskingPolicy
}

// NewPolicyStore 는 기본 정책으로 초기화한 스토어를 만든다(폴링 전에도 사용 가능).
func NewPolicyStore(bffURL string, interval time.Duration) *PolicyStore {
	return &PolicyStore{
		url:      trimSlash(bffURL) + "/api/v1/masking/policy",
		interval: interval,
		http:     &http.Client{Timeout: 5 * time.Second},
		current:  domain.DefaultMaskingPolicy(),
	}
}

// Get 은 캐시된 현재 정책을 반환한다.
func (s *PolicyStore) Get() domain.MaskingPolicy {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.current
}

// Run 은 컨텍스트가 끝날 때까지 주기 폴링한다(시작 시 1회 즉시).
func (s *PolicyStore) Run(ctx context.Context) {
	s.refresh(ctx)
	t := time.NewTicker(s.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.refresh(ctx)
		}
	}
}

func (s *PolicyStore) refresh(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return
	}
	resp, err := s.http.Do(req)
	if err != nil {
		slog.Warn("glue: 마스킹 정책 폴링 실패 — 이전 값 유지", "err", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		slog.Warn("glue: 마스킹 정책 응답 비정상 — 이전 값 유지", "status", resp.StatusCode)
		return
	}
	var p domain.MaskingPolicy
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		slog.Warn("glue: 마스킹 정책 디코드 실패 — 이전 값 유지", "err", err)
		return
	}
	s.mu.Lock()
	s.current = p
	s.mu.Unlock()
}

func trimSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}
