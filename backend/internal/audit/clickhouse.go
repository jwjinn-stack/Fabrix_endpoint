// Package audit 는 가드레일 판정을 불변 증적으로 ClickHouse(fabrix.guard_audit)에
// 적재(audit-ingestor)하고, 증적 뷰(4-3)용으로 조회한다.
//
// 핫패스 비차단: 적재는 버퍼 채널 + 배치 flush 로 비동기 처리한다(추론 지연 무영향).
// 보안: user_ref = salted SHA-256(x-user-id), 원문/PII 미저장(마스킹 샘플만). (SSOT 2-2/2-6)
package audit

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// NewEventID 는 RFC4122 UUIDv4 문자열을 생성한다(ClickHouse UUID 컬럼용).
func NewEventID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// Sink 는 ClickHouse HTTP 인터페이스(:8123) 기반 증적 적재/조회기.
type Sink struct {
	endpoint string // scheme://host:port (creds 제거)
	user     string
	password string
	http     *http.Client
	salt     string
	ch       chan domain.GuardAuditRow
	enabled  bool
	worm     *WORM // 불변 보존(옵션, #20)
}

// AttachWORM 은 불변 보존(MinIO Object Lock)을 연결한다(#20).
func (s *Sink) AttachWORM(w *WORM) { s.worm = w }

// WORMEnabled 는 불변 보존 활성 여부.
func (s *Sink) WORMEnabled() bool { return s.worm != nil && s.worm.Enabled() }

// WORMStats 는 보존 객체 수/버킷을 반환한다.
func (s *Sink) WORMStats(ctx context.Context) (int, string) {
	if s.worm == nil {
		return 0, ""
	}
	return s.worm.Stats(ctx)
}

// New 는 ClickHouse URL(예: http://fabrix:fabrix_dev@localhost:18123)로 Sink 를 만들고
// 백그라운드 flusher 를 시작한다. raw 가 비면 비활성(증적 기능만 off).
func New(raw, salt string) *Sink {
	s := &Sink{
		http: &http.Client{Timeout: 8 * time.Second, Transport: httpx.Capturing(nil)},
		salt: salt,
		ch:   make(chan domain.GuardAuditRow, 1024),
	}
	if raw == "" {
		return s
	}
	u, err := url.Parse(raw)
	if err != nil {
		slog.Warn("ClickHouse URL 파싱 실패 — 증적 비활성", "err", err)
		return s
	}
	if u.User != nil {
		s.user = u.User.Username()
		s.password, _ = u.User.Password()
		u.User = nil
	}
	s.endpoint = strings.TrimRight(u.String(), "/")
	s.enabled = true
	s.migrate() // P4-9 컬럼 비파괴 보강(additive)
	go s.loop()
	return s
}

// Enabled 는 증적 적재 가능 여부.
func (s *Sink) Enabled() bool { return s.enabled }

// Probe 는 ClickHouse 도달성을 확인한다(SELECT 1, read-only). 진단용.
func (s *Sink) Probe(ctx context.Context) error {
	if !s.enabled {
		return fmt.Errorf("clickhouse 미구성")
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return s.exec(ctx, "SELECT 1", nil)
}

// ProbeWORM 은 WORM(MinIO Object Lock) 버킷 도달성을 확인한다(read-only). 진단용.
func (s *Sink) ProbeWORM(ctx context.Context) error {
	if s.worm == nil || !s.worm.Enabled() {
		return fmt.Errorf("worm 미구성")
	}
	return s.worm.Probe(ctx)
}

// loop 는 버퍼에서 행을 모아 배치 적재한다(최대 100건 / 1초).
func (s *Sink) loop() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	batch := make([]domain.GuardAuditRow, 0, 100)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := s.insert(batch); err != nil {
			slog.Warn("guard_audit 적재 실패", "err", err, "rows", len(batch))
		}
		// 불변 보존(WORM) — 건별 객체. 실패해도 ClickHouse 적재는 유지.
		if s.worm != nil && s.worm.Enabled() {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			for _, row := range batch {
				if err := s.worm.Put(ctx, row); err != nil {
					slog.Warn("WORM 보존 실패", "err", err)
					break
				}
			}
			cancel()
		}
		batch = batch[:0]
	}
	for {
		select {
		case row := <-s.ch:
			batch = append(batch, row)
			if len(batch) >= 100 {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

// Enqueue 는 증적 행을 비동기 큐에 넣는다(핫패스 비차단). 큐가 가득 차면 드롭(로그).
func (s *Sink) Enqueue(row domain.GuardAuditRow) {
	if !s.enabled {
		return
	}
	select {
	case s.ch <- row:
	default:
		slog.Warn("guard_audit 큐 가득 — 드롭")
	}
}

// chRow 는 ClickHouse JSONEachRow 적재용(컬럼명 정합).
type chRow struct {
	EventID       string   `json:"event_id"`
	Ts            string   `json:"ts"`
	TraceID       string   `json:"trace_id"`
	UserRef       string   `json:"user_ref"`
	DeptID        string   `json:"dept_id"`
	AppID         string   `json:"app_id"`
	APIKeyID      string   `json:"api_key_id"`
	Model         string   `json:"model"`
	Decision      string   `json:"decision"`
	GuardTypes    []string `json:"guard_types"`
	PIISubtypes   []string `json:"pii_subtypes"`
	JBConfidence  float64  `json:"jb_confidence"`
	PolicyVersion string   `json:"policy_version"`
	HTTPStatus    int      `json:"http_status"`
	LatencyMs     int64    `json:"latency_ms"`
}

func (s *Sink) insert(rows []domain.GuardAuditRow) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	for _, r := range rows {
		cr := chRow{
			EventID: r.EventID, Ts: r.Ts, TraceID: r.TraceID, UserRef: r.UserRef,
			DeptID: r.DeptID, AppID: r.AppID, APIKeyID: r.APIKeyID, Model: r.Model,
			Decision: string(r.Decision), GuardTypes: nz(r.GuardTypes), PIISubtypes: nz(r.PIISubtypes),
			JBConfidence: r.JBConfidence, PolicyVersion: r.PolicyVersion,
			HTTPStatus: r.HTTPStatus, LatencyMs: r.LatencyMs,
		}
		if err := enc.Encode(cr); err != nil {
			return err
		}
	}
	q := "INSERT INTO fabrix.guard_audit (event_id,ts,trace_id,user_ref,dept_id,app_id,api_key_id,model,decision,guard_types,pii_subtypes,jb_confidence,policy_version,http_status,latency_ms) FORMAT JSONEachRow"
	return s.exec(context.Background(), q, &buf)
}

// migrate 는 guard_audit 에 P4-9 컬럼(http_status·latency_ms)을 비파괴 보강한다.
// 우리 소유 증적 테이블의 additive ALTER(IF NOT EXISTS) — 기존 행/스키마 영향 없음.
func (s *Sink) migrate() {
	if !s.enabled {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	stmts := []string{
		"ALTER TABLE fabrix.guard_audit ADD COLUMN IF NOT EXISTS http_status UInt16 DEFAULT 0",
		"ALTER TABLE fabrix.guard_audit ADD COLUMN IF NOT EXISTS latency_ms UInt32 DEFAULT 0",
	}
	for _, q := range stmts {
		if err := s.exec(ctx, q, nil); err != nil {
			slog.Warn("guard_audit 컬럼 보강 실패(무시·후속 재시도)", "err", err, "stmt", q)
		}
	}
}

func (s *Sink) exec(ctx context.Context, query string, body io.Reader) error {
	u := fmt.Sprintf("%s/?query=%s", s.endpoint, url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, body)
	if err != nil {
		return err
	}
	s.auth(req)
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("clickhouse %d: %s", resp.StatusCode, b)
	}
	return nil
}

func (s *Sink) auth(req *http.Request) {
	if s.user != "" {
		req.Header.Set("X-ClickHouse-User", s.user)
		req.Header.Set("X-ClickHouse-Key", s.password)
	}
}

// ── 조회(증적 뷰 4-3) ──

// Query 는 기간/판정/유형 필터로 증적 요약 + 행 목록을 조회한다.
func (s *Sink) Query(ctx context.Context, rng domain.TimeRange, decision, gtype string) (domain.GuardAuditReport, error) {
	rep := domain.GuardAuditReport{
		Range:       rng,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Rows:        []domain.GuardAuditRow{},
		Source:      "unavailable",
	}
	if !s.enabled {
		return rep, nil
	}
	dur := promInterval(rng)
	where := []string{fmt.Sprintf("ts >= now() - INTERVAL %s", dur)}
	if decision != "" && decision != "all" {
		where = append(where, fmt.Sprintf("decision = %s", chQuote(decision)))
	}
	if gtype != "" && gtype != "all" {
		where = append(where, fmt.Sprintf("has(guard_types, %s)", chQuote(gtype)))
	}
	whereSQL := strings.Join(where, " AND ")

	// 요약
	sum, err := s.querySummary(ctx, whereSQL)
	if err != nil {
		return rep, err
	}
	rep.Summary = sum

	// 행 목록(최신순 200)
	rows, err := s.queryRows(ctx, whereSQL)
	if err != nil {
		return rep, err
	}
	rep.Rows = rows
	rep.Source = "clickhouse"
	return rep, nil
}

func (s *Sink) querySummary(ctx context.Context, where string) (domain.GuardSummary, error) {
	q := fmt.Sprintf(`SELECT
	  count() AS checked,
	  countIf(decision='blocked') AS blocked,
	  countIf(has(guard_types,'pii')) AS pii,
	  countIf(has(guard_types,'jailbreak')) AS jailbreak,
	  countIf(decision='flagged') AS flagged
	FROM fabrix.guard_audit WHERE %s FORMAT JSON`, where)
	var out struct {
		Data []struct {
			Checked   chInt `json:"checked"`
			Blocked   chInt `json:"blocked"`
			PII       chInt `json:"pii"`
			Jailbreak chInt `json:"jailbreak"`
			Flagged   chInt `json:"flagged"`
		} `json:"data"`
	}
	if err := s.queryJSON(ctx, q, &out); err != nil {
		return domain.GuardSummary{}, err
	}
	if len(out.Data) == 0 {
		return domain.GuardSummary{}, nil
	}
	d := out.Data[0]
	return domain.GuardSummary{
		Checked: int(d.Checked), Blocked: int(d.Blocked), PII: int(d.PII),
		Jailbreak: int(d.Jailbreak), Flagged: int(d.Flagged),
	}, nil
}

func (s *Sink) queryRows(ctx context.Context, where string) ([]domain.GuardAuditRow, error) {
	q := fmt.Sprintf(`SELECT
	  toString(event_id) AS event_id,
	  formatDateTime(ts, '%%Y-%%m-%%dT%%H:%%i:%%SZ') AS event_ts,
	  trace_id, user_ref, dept_id, app_id, api_key_id, model,
	  decision, guard_types, pii_subtypes, jb_confidence, policy_version,
	  http_status, latency_ms
	FROM fabrix.guard_audit WHERE %s ORDER BY ts DESC LIMIT 200 FORMAT JSON`, where)
	var out struct {
		Data []struct {
			EventID       string   `json:"event_id"`
			Ts            string   `json:"event_ts"`
			TraceID       string   `json:"trace_id"`
			UserRef       string   `json:"user_ref"`
			DeptID        string   `json:"dept_id"`
			AppID         string   `json:"app_id"`
			APIKeyID      string   `json:"api_key_id"`
			Model         string   `json:"model"`
			Decision      string   `json:"decision"`
			GuardTypes    []string `json:"guard_types"`
			PIISubtypes   []string `json:"pii_subtypes"`
			JBConfidence  chFloat  `json:"jb_confidence"`
			PolicyVersion string   `json:"policy_version"`
			HTTPStatus    chInt    `json:"http_status"`
			LatencyMs     chInt    `json:"latency_ms"`
		} `json:"data"`
	}
	if err := s.queryJSON(ctx, q, &out); err != nil {
		return nil, err
	}
	rows := make([]domain.GuardAuditRow, 0, len(out.Data))
	for _, d := range out.Data {
		rows = append(rows, domain.GuardAuditRow{
			EventID: d.EventID, Ts: d.Ts, TraceID: d.TraceID, UserRef: d.UserRef,
			DeptID: d.DeptID, AppID: d.AppID, APIKeyID: d.APIKeyID, Model: d.Model,
			Decision: domain.GuardDecision(d.Decision), GuardTypes: nz(d.GuardTypes),
			PIISubtypes: nz(d.PIISubtypes), JBConfidence: float64(d.JBConfidence),
			PolicyVersion: d.PolicyVersion,
			HTTPStatus:    int(d.HTTPStatus), LatencyMs: int64(d.LatencyMs),
		})
	}
	return rows, nil
}

func (s *Sink) queryJSON(ctx context.Context, query string, out any) error {
	u := fmt.Sprintf("%s/?query=%s", s.endpoint, url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	s.auth(req)
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("clickhouse %d: %s", resp.StatusCode, b)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// ── helpers ──

// UserRef 는 x-user-id 를 salted SHA-256 으로 비식별화한다(원문 미저장).
func (s *Sink) UserRef(userID string) string {
	if userID == "" {
		userID = "anonymous"
	}
	sum := sha256.Sum256([]byte(s.salt + ":" + userID))
	return "u_" + hex.EncodeToString(sum[:])[:16]
}

func nz(a []string) []string {
	if a == nil {
		return []string{}
	}
	return a
}

func chQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// promInterval 은 TimeRange → ClickHouse INTERVAL 구문.
func promInterval(rng domain.TimeRange) string {
	switch rng {
	case "1h":
		return "1 HOUR"
	case "6h":
		return "6 HOUR"
	case "7d":
		return "7 DAY"
	default:
		return "24 HOUR"
	}
}

var maskDigits = regexp.MustCompile(`\d`)

// MaskSample 은 프롬프트에서 숫자/이메일을 가리고 80자로 절단한다(원문/PII 비저장).
func MaskSample(text string) string {
	t := maskEmail(text)
	t = maskDigits.ReplaceAllString(t, "•")
	t = strings.TrimSpace(t)
	r := []rune(t)
	if len(r) > 80 {
		return string(r[:80]) + "…"
	}
	return t
}

var emailRe = regexp.MustCompile(`[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}`)

func maskEmail(s string) string {
	return emailRe.ReplaceAllString(s, "•••@•••")
}

// chInt/chFloat 는 ClickHouse JSON 의 숫자(문자열로 올 수 있음) 유연 파싱.
type chInt int64

func (c *chInt) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		*c = 0
		return nil
	}
	var f float64
	if err := json.Unmarshal([]byte(s), &f); err != nil {
		return err
	}
	*c = chInt(int64(f))
	return nil
}

type chFloat float64

func (c *chFloat) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		*c = 0
		return nil
	}
	var f float64
	if err := json.Unmarshal([]byte(s), &f); err != nil {
		return err
	}
	*c = chFloat(f)
	return nil
}
