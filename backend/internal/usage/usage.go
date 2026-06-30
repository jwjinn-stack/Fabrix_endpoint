// Package usage 는 추론 요청별 사용량을 ClickHouse fabrix.usage_rollup(SummingMergeTree)에
// 배치 적재(rollup-worker)하고, 부서/앱/키 축으로 집계 조회한다.
//
// 모든 추론이 우리 프록시를 통과하므로(catalog.Chat) 프록시가 곧 트레이스 지점이다.
// 메트릭 라벨로는 user_ref 카디널리티 때문에 부서/앱 축을 못 붙이므로(SSOT 3-1),
// 프록시 이벤트→배치 롤업이 부서·앱·키 귀속의 정답이다.
//
// SummingMergeTree 주의: ORDER BY 외 모든 숫자 컬럼이 머지 시 합산된다.
// → 가산 가능한 컬럼만 채운다(req_count·prompt/completion_tokens·error_count).
//
//	지연 분위수(ttft/itl)는 합산 불가 → 0(모델 축은 vmselect 가 담당).
package usage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// Event 는 단일 추론 요청의 사용량(프록시에서 생성).
type Event struct {
	Ts               time.Time
	DeptID           string
	AppID            string
	APIKeyID         string
	Model            string
	PromptTokens     int
	CompletionTokens int
	Errored          bool
}

// Sink 는 ClickHouse HTTP(:8123) 기반 usage_rollup 적재/조회기.
type Sink struct {
	endpoint string
	user     string
	password string
	http     *http.Client
	ch       chan Event
	enabled  bool
}

// New 는 ClickHouse URL(creds 포함)로 Sink 를 만들고 배치 worker 를 시작한다.
func New(raw string) *Sink {
	s := &Sink{http: &http.Client{Timeout: 8 * time.Second, Transport: httpx.Capturing(nil)}, ch: make(chan Event, 2048)}
	if raw == "" {
		return s
	}
	u, err := url.Parse(raw)
	if err != nil {
		slog.Warn("usage: ClickHouse URL 파싱 실패 — 비활성", "err", err)
		return s
	}
	if u.User != nil {
		s.user = u.User.Username()
		s.password, _ = u.User.Password()
		u.User = nil
	}
	s.endpoint = strings.TrimRight(u.String(), "/")
	s.enabled = true
	go s.loop()
	return s
}

// Enabled 는 롤업 적재 가능 여부.
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

// Enqueue 는 사용량 이벤트를 비동기 큐에 넣는다(핫패스 비차단).
func (s *Sink) Enqueue(e Event) {
	if !s.enabled {
		return
	}
	select {
	case s.ch <- e:
	default:
		slog.Warn("usage: 큐 가득 — 드롭")
	}
}

// loop 는 이벤트를 모아 5분 버킷으로 usage_rollup 에 배치 적재(rollup-worker).
func (s *Sink) loop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	batch := make([]Event, 0, 200)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := s.insert(batch); err != nil {
			slog.Warn("usage_rollup 적재 실패", "err", err, "rows", len(batch))
		}
		batch = batch[:0]
	}
	for {
		select {
		case e := <-s.ch:
			batch = append(batch, e)
			if len(batch) >= 200 {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

type chRow struct {
	Bucket           string `json:"bucket"`
	DeptID           string `json:"dept_id"`
	AppID            string `json:"app_id"`
	APIKeyID         string `json:"api_key_id"`
	Model            string `json:"model"`
	ReqCount         int    `json:"req_count"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	ErrorCount       int    `json:"error_count"`
}

func (s *Sink) insert(events []Event) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	for _, e := range events {
		bucket := e.Ts.UTC().Truncate(5 * time.Minute).Format("2006-01-02 15:04:05")
		ec := 0
		if e.Errored {
			ec = 1
		}
		if err := enc.Encode(chRow{
			Bucket: bucket, DeptID: nz(e.DeptID), AppID: nz(e.AppID),
			APIKeyID: nz(e.APIKeyID), Model: nz(e.Model),
			ReqCount: 1, PromptTokens: e.PromptTokens, CompletionTokens: e.CompletionTokens, ErrorCount: ec,
		}); err != nil {
			return err
		}
	}
	q := "INSERT INTO fabrix.usage_rollup (bucket,dept_id,app_id,api_key_id,model,req_count,prompt_tokens,completion_tokens,error_count) FORMAT JSONEachRow"
	return s.exec(context.Background(), q, &buf)
}

// QueryRollup 은 group 축(dept_id|app_id|api_key_id|model)으로 집계 조회한다.
func (s *Sink) QueryRollup(ctx context.Context, rng domain.TimeRange, group string) ([]domain.UsageRow, error) {
	col := groupColumn(group)
	if col == "" || !s.enabled {
		return nil, nil
	}
	q := fmt.Sprintf(`SELECT
	  %s AS k,
	  sum(req_count) AS requests,
	  sum(prompt_tokens) AS prompt_tokens,
	  sum(completion_tokens) AS completion_tokens,
	  sum(error_count) AS errors
	FROM fabrix.usage_rollup
	WHERE bucket >= now() - INTERVAL %s
	GROUP BY k HAVING requests > 0 ORDER BY requests DESC LIMIT 200 FORMAT JSON`, col, chInterval(rng))
	var out struct {
		Data []struct {
			K                string `json:"k"`
			Requests         chInt  `json:"requests"`
			PromptTokens     chInt  `json:"prompt_tokens"`
			CompletionTokens chInt  `json:"completion_tokens"`
			Errors           chInt  `json:"errors"`
		} `json:"data"`
	}
	if err := s.queryJSON(ctx, q, &out); err != nil {
		return nil, err
	}
	rows := make([]domain.UsageRow, 0, len(out.Data))
	for _, d := range out.Data {
		r := domain.UsageRow{
			Requests:         int64(d.Requests),
			PromptTokens:     int64(d.PromptTokens),
			CompletionTokens: int64(d.CompletionTokens),
		}
		switch group {
		case "dept", "dept_id":
			r.DeptID = d.K
		case "app", "app_id":
			r.AppID = d.K
		case "api_key", "api_key_id":
			r.APIKeyID = d.K
		case "model":
			r.Model = d.K
		}
		rows = append(rows, r)
	}
	return rows, nil
}

// QueryTrend 는 시간 버킷별 총 요청/토큰 추세를 반환한다(P4-4 forecast 입력).
// 버킷 granularity 는 범위에 맞춰 ~12-24 포인트가 되도록 적응.
func (s *Sink) QueryTrend(ctx context.Context, rng domain.TimeRange) (domain.UsageTrend, error) {
	if !s.enabled {
		return domain.UsageTrend{Range: rng, Points: []domain.UsageTrendPoint{}}, nil
	}
	bucketFn, bucketSec := trendBucket(rng)
	q := fmt.Sprintf(`SELECT
	  toStartOfInterval(bucket, INTERVAL %s) AS t,
	  sum(req_count) AS requests,
	  sum(prompt_tokens + completion_tokens) AS tokens
	FROM fabrix.usage_rollup
	WHERE bucket >= now() - INTERVAL %s
	GROUP BY t ORDER BY t ASC FORMAT JSON`, bucketFn, chInterval(rng))
	var out struct {
		Data []struct {
			T        string `json:"t"`
			Requests chInt  `json:"requests"`
			Tokens   chInt  `json:"tokens"`
		} `json:"data"`
	}
	if err := s.queryJSON(ctx, q, &out); err != nil {
		return domain.UsageTrend{}, err
	}
	points := make([]domain.UsageTrendPoint, 0, len(out.Data))
	for _, d := range out.Data {
		// ClickHouse 는 "2006-01-02 15:04:05" 형식 → RFC3339(UTC)로 정규화.
		ts := strings.Replace(d.T, " ", "T", 1) + "Z"
		points = append(points, domain.UsageTrendPoint{
			Ts: ts, Requests: int64(d.Requests), Tokens: int64(d.Tokens),
		})
	}
	return domain.UsageTrend{
		Range: rng, GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		BucketSec: bucketSec, Points: points,
	}, nil
}

// trendBucket 은 범위별 추세 버킷(ClickHouse INTERVAL 문구, 초)을 반환한다.
func trendBucket(rng domain.TimeRange) (string, int) {
	switch rng {
	case domain.Range7d:
		return "6 HOUR", 6 * 3600
	case domain.Range24h:
		return "1 HOUR", 3600
	case domain.Range6h:
		return "30 MINUTE", 1800
	default: // 1h
		return "5 MINUTE", 300
	}
}

func groupColumn(g string) string {
	switch g {
	case "dept", "dept_id":
		return "dept_id"
	case "app", "app_id":
		return "app_id"
	case "api_key", "api_key_id":
		return "api_key_id"
	case "model":
		return "model"
	default:
		return ""
	}
}

// ── ClickHouse HTTP ──

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

func (s *Sink) auth(req *http.Request) {
	if s.user != "" {
		req.Header.Set("X-ClickHouse-User", s.user)
		req.Header.Set("X-ClickHouse-Key", s.password)
	}
}

func nz(s string) string {
	if s == "" {
		return "unknown"
	}
	return s
}

func chInterval(rng domain.TimeRange) string {
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
