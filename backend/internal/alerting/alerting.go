// Package alerting 은 예산·임계 초과(quota 게이지가 이미 계산하는 threshold/budget 교차)를
// 외부로 능동 통지하는 아웃바운드 디스패처다. 신규 판정 경로는 만들지 않고, quota 의 교차
// 콜백에 디스패치만 hook 한다(LiteLLM 이벤트 모델).
//
// 채널: 제네릭 Webhook 우선(폐쇄망 마찰 최소). SMTP 는 인터페이스 스텁만(미구현). Slack 없음.
//
// SENSITIVE — 아웃바운드 네트워크. 핵심 방어:
//   - SSRF: ValidateWebhookURL 이 scheme 화이트리스트(http/https) + 메타데이터/루프백 타깃 거부.
//     폐쇄망에서는 URL 이 반드시 내부 relay 여야 한다(외부 SaaS 직결 금지).
//   - 비밀/PII 금지: 페이로드 token 은 평문 API 키가 아니라 salted hash. URL 은 로그에 redact.
//   - 비차단·bounded: go 디스패치 + http 타임아웃 + 재시도 1회. hot path 블록 금지, 실패는 감사만.
//   - dedup: 키×event 당 24h TTL. 교차 1회만 발송(같은 날 재교차 억제).
//   - profile 게이팅: observe(읽기 전용)는 enabled=false → 발송 안 함. manage 전용.
package alerting

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// budgetAlertTTL 은 키×event 당 dedup 윈도(LiteLLM budget_alert_ttl=86400s = 24h).
const budgetAlertTTL = 24 * time.Hour

// Event 는 외부 통지 페이로드(LiteLLM alerting 호환). 평문 키·PII 미포함.
type Event struct {
	Event        string  `json:"event"`         // threshold_crossed | budget_crossed
	EventGroup   string  `json:"event_group"`   // key | model | dept (MVP: key)
	Token        string  `json:"token"`         // salted hash (평문 API 키 아님)
	Spend        float64 `json:"spend"`         // 추정 KRW
	MaxBudget    float64 `json:"max_budget"`    // 추정 KRW
	EventMessage string  `json:"event_message"` // 사람용 요약(식별 정보 없음)
}

const (
	EventThresholdCrossed = "threshold_crossed"
	EventBudgetCrossed    = "budget_crossed"
)

// Channel 은 단일 아웃바운드 통지 채널.
type Channel interface {
	Name() string
	Send(ctx context.Context, e Event) error
}

// ── SSRF 방어: webhook URL 검증/정규화 ──

// ErrNotImplemented 는 미구현 채널(SMTP 스텁)이 반환한다.
var ErrNotImplemented = errors.New("미구현 채널")

// blockedHosts 는 명백한 internal-metadata/루프백 타깃(정확 일치). SSRF 1차 차단.
var blockedHosts = map[string]bool{
	"localhost": true, "metadata.google.internal": true,
}

// ValidateWebhookURL 은 outbound webhook URL 을 SSRF 관점에서 검증한다.
// 반환: warnings(저장 허용·안내), err(저장 차단). 빈 문자열은 "채널 해제"로 간주(err=nil).
//
// 차단(err): http/https 외 scheme, host 없음, 루프백/링크로컬/메타데이터 타깃.
// 경고(warnings): 사설망 대역·단일 라벨 호스트(폐쇄망 내부 relay 권장 안내).
func ValidateWebhookURL(raw string) (warnings []string, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil // 해제
	}
	u, perr := url.Parse(raw)
	if perr != nil {
		return nil, fmt.Errorf("URL 형식 오류: %w", perr)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("허용 scheme 은 http/https 뿐입니다(받음: %q)", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return nil, errors.New("host 가 없습니다 — scheme://host[:port]/path 형태로")
	}
	lh := strings.ToLower(host)
	if blockedHosts[lh] {
		return nil, fmt.Errorf("내부/메타데이터 호스트는 차단됩니다: %s", host)
	}
	// IP 리터럴: 루프백/링크로컬/메타데이터 거부, 사설 대역은 경고(폐쇄망 내부 relay 일 수 있음).
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return nil, fmt.Errorf("루프백/링크로컬 IP 는 차단됩니다: %s", host)
		}
		if ip.Equal(net.ParseIP("169.254.169.254")) {
			return nil, errors.New("클라우드 메타데이터 IP(169.254.169.254)는 차단됩니다")
		}
		if ip.IsPrivate() {
			warnings = append(warnings, "사설망 IP — 폐쇄망 내부 relay 가 맞는지 확인하세요(외부 SaaS 직결 금지).")
		}
	} else {
		// 호스트명: 쿠버 클러스터 내부 도메인·단일 라벨은 폐쇄망 relay 안내.
		if strings.HasSuffix(lh, ".svc.cluster.local") || !strings.Contains(lh, ".") {
			warnings = append(warnings, "클러스터/단일 라벨 호스트 — 폐쇄망 내부 relay 권장(외부 SaaS 직결 금지).")
		}
	}
	return warnings, nil
}

// redactURL 은 로그용으로 userinfo·query 를 가린다(토큰 임베드 URL 누설 방지).
func redactURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "(redacted)"
	}
	u.User = nil
	if u.RawQuery != "" {
		u.RawQuery = "***"
	}
	return u.Scheme + "://" + u.Host + u.Path
}

// ── Webhook 채널 ──

// WebhookChannel 은 제네릭 HTTP POST(JSON) 채널. 타임아웃 + 재시도 1회(bounded).
type WebhookChannel struct {
	url  string
	http *http.Client
}

// NewWebhookChannel 은 검증된 URL 로 채널을 만든다. URL 검증 실패 시 err.
func NewWebhookChannel(rawURL string) (*WebhookChannel, error) {
	if _, err := ValidateWebhookURL(rawURL); err != nil {
		return nil, err
	}
	if strings.TrimSpace(rawURL) == "" {
		return nil, errors.New("빈 webhook URL")
	}
	return &WebhookChannel{
		url:  rawURL,
		http: &http.Client{Timeout: 4 * time.Second},
	}, nil
}

// newWebhookChannelUnchecked 는 SSRF 검증을 건너뛰고 채널을 만든다(테스트 전용 — httptest
// 서버는 127.0.0.1 에 바인딩되므로 ValidateWebhookURL 에 걸린다).
func newWebhookChannelUnchecked(rawURL string) *WebhookChannel {
	return &WebhookChannel{url: rawURL, http: &http.Client{Timeout: 4 * time.Second}}
}

func (c *WebhookChannel) Name() string { return "webhook" }

// Send 는 페이로드를 POST 한다. 1회 재시도(짧은 backoff). non-2xx/네트워크 오류는 err 반환(감사용).
func (c *WebhookChannel) Send(ctx context.Context, e Event) error {
	body, err := json.Marshal(e)
	if err != nil {
		return err
	}
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(250 * time.Millisecond):
			}
		}
		req, rerr := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
		if rerr != nil {
			return rerr // URL 구성 오류는 재시도 무의미
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "fabrix-endpoint-alerting")
		resp, derr := c.http.Do(req)
		if derr != nil {
			// *url.Error 는 전체 URL(쿼리 임베드 토큰 포함)을 stringify 한다 → 누설 방지로
			// 사유만 추출하고 URL 은 버린다(감사/로그에 비밀 미노출).
			lastErr = sanitizeTransportErr(derr)
			continue
		}
		_ = resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}
		lastErr = fmt.Errorf("webhook %d", resp.StatusCode)
	}
	return lastErr
}

// sanitizeTransportErr 는 *url.Error 가 노출하는 전체 URL(토큰 임베드 가능)을 버리고
// 원인(timeout/네트워크)만 일반화한 에러로 바꾼다 — 감사·로그에 비밀/URL 미노출.
func sanitizeTransportErr(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		if ue.Timeout() {
			return errors.New("요청 시간 초과")
		}
		return fmt.Errorf("전송 실패: %s", ue.Op) // Op 는 "Post" 등 — URL 비포함
	}
	return errors.New("전송 실패")
}

// SMTPChannel 은 인터페이스 스텁만(이번 범위 외 — Webhook 우선). Send 는 미구현.
type SMTPChannel struct{}

func (SMTPChannel) Name() string { return "smtp" }

// Send 는 미구현(net/smtp 인터페이스 자리만 확보). 폐쇄망 2순위 채널.
func (SMTPChannel) Send(_ context.Context, _ Event) error { return ErrNotImplemented }

// ── dedup (키×event 당 TTL) ──

type dedup struct {
	mu   sync.Mutex
	seen map[string]time.Time
	ttl  time.Duration
	now  func() time.Time
}

func newDedup(ttl time.Duration) *dedup {
	return &dedup{seen: map[string]time.Time{}, ttl: ttl, now: time.Now}
}

// allow 는 TTL 내 재발생이면 false(억제), 아니면 발생 기록 후 true.
func (s *dedup) allow(k string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if last, ok := s.seen[k]; ok && now.Sub(last) < s.ttl {
		return false
	}
	s.seen[k] = now
	return true
}

// ── 발송 이력(audit) ──

// SendRecord 는 발송 1건의 결과(표시용). 평문 키·URL 미포함.
type SendRecord struct {
	Ts      string `json:"ts"`
	Channel string `json:"channel"`
	Event   string `json:"event"`
	Token   string `json:"token"` // 해시
	OK      bool   `json:"ok"`
	Reason  string `json:"reason,omitempty"`
}

// ── Dispatcher ──

// Dispatcher 는 채널·dedup·profile 게이트·감사 ring 을 들고 비동기 발송을 조율한다.
type Dispatcher struct {
	mu       sync.RWMutex
	enabled  bool // profile 게이트: manage=true, observe=false(발송 안 함)
	webhook  *WebhookChannel
	dd       *dedup
	salt     string
	audit    []SendRecord
	auditCap int
}

// NewDispatcher 는 디스패처를 만든다. enabled=false(observe) 면 Dispatch 가 발송하지 않는다.
func NewDispatcher(enabled bool, salt string) *Dispatcher {
	return &Dispatcher{
		enabled:  enabled,
		dd:       newDedup(budgetAlertTTL),
		salt:     salt,
		auditCap: 100,
	}
}

// Enabled 는 발송 가능(profile) 여부.
func (d *Dispatcher) Enabled() bool {
	if d == nil {
		return false
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.enabled
}

// SetWebhook 은 webhook URL 을 설정/해제한다(빈 문자열=해제). SSRF 검증 적용.
func (d *Dispatcher) SetWebhook(rawURL string) error {
	if strings.TrimSpace(rawURL) == "" {
		d.mu.Lock()
		d.webhook = nil
		d.mu.Unlock()
		return nil
	}
	ch, err := NewWebhookChannel(rawURL)
	if err != nil {
		return err
	}
	d.mu.Lock()
	d.webhook = ch
	d.mu.Unlock()
	return nil
}

// setWebhookUnchecked 는 SSRF 검증 없이 채널을 설정한다(테스트 전용).
func (d *Dispatcher) setWebhookUnchecked(rawURL string) {
	d.mu.Lock()
	d.webhook = newWebhookChannelUnchecked(rawURL)
	d.mu.Unlock()
}

// WebhookConfigured 는 webhook 채널 등록 여부.
func (d *Dispatcher) WebhookConfigured() bool {
	if d == nil {
		return false
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.webhook != nil
}

// hashToken 은 keyID 를 salted SHA-256(앞 16자)으로 비식별화한다(평문 미노출 — 기존 attribution 정합).
func (d *Dispatcher) hashToken(keyID string) string {
	sum := sha256.Sum256([]byte(d.salt + ":" + keyID))
	return "k_" + hex.EncodeToString(sum[:])[:16]
}

// Dispatch 는 임계/예산 교차 1건을 비동기·비차단으로 발송한다.
//   - profile 게이트(observe=발송 안 함), dedup(키×event 24h), 채널 미설정 시 no-op.
//   - keyID(평문)는 페이로드에 넣지 않고 해시로 치환한다.
//   - 발송은 별 goroutine 에서 수행하므로 호출자(quota hot path)를 절대 블록하지 않는다.
func (d *Dispatcher) Dispatch(keyID string, e Event) {
	if d == nil {
		return
	}
	d.mu.RLock()
	enabled, ch := d.enabled, d.webhook
	d.mu.RUnlock()
	if !enabled {
		return // observe: 읽기 전용 — 발송 안 함
	}
	// dedup: 키×event 당 24h. 교차 1회만.
	if !d.dd.allow(keyID + "|" + e.Event) {
		return
	}
	e.Token = d.hashToken(keyID) // 평문 키 절대 비노출
	if ch == nil {
		d.record(SendRecord{Channel: "none", Event: e.Event, Token: e.Token, OK: false, Reason: "채널 미설정"})
		return
	}
	go d.send(ch, e)
}

func (d *Dispatcher) send(ch Channel, e Event) {
	ctx, cancel := context.WithTimeout(context.Background(), 9*time.Second)
	defer cancel()
	err := ch.Send(ctx, e)
	rec := SendRecord{Channel: ch.Name(), Event: e.Event, Token: e.Token, OK: err == nil}
	if err != nil {
		rec.Reason = err.Error()
		// URL/비밀 누설 방지: 채널이 redact 된 식별자만 로깅.
		slog.Warn("아웃바운드 알림 발송 실패(비치명적)", "channel", ch.Name(), "event", e.Event, "err", err)
	}
	d.record(rec)
}

func (d *Dispatcher) record(r SendRecord) {
	r.Ts = time.Now().UTC().Format(time.RFC3339)
	d.mu.Lock()
	d.audit = append(d.audit, r)
	if len(d.audit) > d.auditCap {
		d.audit = d.audit[len(d.audit)-d.auditCap:]
	}
	d.mu.Unlock()
}

// Audit 는 최근 발송 이력(최신 우선)을 복사 반환한다(표시용).
func (d *Dispatcher) Audit() []SendRecord {
	if d == nil {
		return nil
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	out := make([]SendRecord, len(d.audit))
	for i, r := range d.audit {
		out[len(d.audit)-1-i] = r
	}
	return out
}

var _ = redactURL // redactURL 은 향후 채널별 진단 표시에 사용(현재 직접 호출 없음).
