// Package quota 는 API 키별 요청 한도(rpm)를 인메모리 고정창(fixed-window)으로 강제한다.
// dev 단일 인스턴스용. 분산 환경은 Redis 토큰버킷으로 교체(iteration). (SSOT R4, LiteLLM 패턴)
package quota

import (
	"sync"
	"time"
)

type window struct {
	minute int64
	count  int
}

type dayWindow struct {
	day    int64
	tokens int64
}

// Limiter 는 키별 분당 요청 카운터 + 일당 토큰 카운터(예산 하드캡용) + 경고 임계(인메모리).
// 경고 임계를 인메모리로 두는 이유: 앱 DB 롤이 api_key 테이블 owner 가 아니라 컬럼 ALTER 가
// 권한 거부됨(42501). 프로덕션 영속화는 owner 마이그레이션으로 컬럼 추가 후 전환.
type Limiter struct {
	mu    sync.Mutex
	m     map[string]*window
	dt    map[string]*dayWindow
	alert map[string]float64 // 키별 경고 임계(0..1). 미설정=0.8 기본.
}

// New 는 빈 리미터를 만든다.
func New() *Limiter {
	return &Limiter{m: map[string]*window{}, dt: map[string]*dayWindow{}, alert: map[string]float64{}}
}

// SetAlertThreshold 는 키의 예산 경고 임계(0..1)를 설정한다.
func (l *Limiter) SetAlertThreshold(key string, v float64) {
	if key == "" || key == "-" || v <= 0 || v > 1 {
		return
	}
	l.mu.Lock()
	l.alert[key] = v
	l.mu.Unlock()
}

// AlertThreshold 는 키의 경고 임계를 반환한다(미설정=0.8).
func (l *Limiter) AlertThreshold(key string) float64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	if v, ok := l.alert[key]; ok {
		return v
	}
	return 0.8
}

func today() int64 { return time.Now().UTC().Unix() / 86400 }

// AddTokens 는 키의 오늘 누적 토큰을 n 만큼 증가시킨다(응답 후 호출).
func (l *Limiter) AddTokens(key string, n int) {
	if key == "" || key == "-" || n <= 0 {
		return
	}
	d := today()
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.dt[key]
	if w == nil || w.day != d {
		w = &dayWindow{day: d}
		l.dt[key] = w
	}
	w.tokens += int64(n)
}

// TokensToday 는 키의 오늘 누적 토큰을 반환한다(예산 게이지 표시용).
func (l *Limiter) TokensToday(key string) int64 {
	if key == "" || key == "-" {
		return 0
	}
	d := today()
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.dt[key]
	if w == nil || w.day != d {
		return 0
	}
	return w.tokens
}

// OverTPD 는 일 토큰 한도(tpd>0)를 이미 초과했는지 반환한다(하드캡 429).
func (l *Limiter) OverTPD(key string, tpd int64) bool {
	if tpd <= 0 {
		return false
	}
	return l.TokensToday(key) >= tpd
}

// Allow 는 키의 이번 분 카운터를 1 증가시키고 rpm 한도 내인지 반환한다.
// rpm<=0 이면 무제한(항상 허용). now 는 테스트 주입용(0이면 현재 시각).
func (l *Limiter) Allow(key string, rpm int) bool {
	if rpm <= 0 {
		return true
	}
	min := time.Now().Unix() / 60
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.m[key]
	if w == nil || w.minute != min {
		w = &window{minute: min, count: 0}
		l.m[key] = w
	}
	if w.count >= rpm {
		return false
	}
	w.count++
	return true
}

// Remaining 은 이번 분 남은 허용 요청 수(표시용). rpm<=0 이면 -1(무제한).
func (l *Limiter) Remaining(key string, rpm int) int {
	if rpm <= 0 {
		return -1
	}
	min := time.Now().Unix() / 60
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.m[key]
	if w == nil || w.minute != min {
		return rpm
	}
	if r := rpm - w.count; r > 0 {
		return r
	}
	return 0
}
