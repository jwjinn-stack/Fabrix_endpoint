package glue

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// ingestEvent 는 Langfuse /api/public/ingestion 배치의 단일 이벤트.
type ingestEvent struct {
	ID        string `json:"id"`
	Type      string `json:"type"` // trace-create | generation-create | observation-create | score-create
	Timestamp string `json:"timestamp"`
	Body      any    `json:"body"`
}

// Langfuse 는 ingestion REST 비동기 배치 전송기(audit Sink 패턴 미러).
type Langfuse struct {
	url     string // {host}/api/public/ingestion
	auth    string // base64(public:secret)
	http    *http.Client
	ch      chan ingestEvent
	enabled bool
}

// NewLangfuse 는 ingestion 클라이언트를 만들고 백그라운드 flusher 를 띄운다.
// host/키 미설정 시 비활성(Enqueue 무시).
func NewLangfuse(host, public, secret string) *Langfuse {
	lf := &Langfuse{http: &http.Client{Timeout: 8 * time.Second}, ch: make(chan ingestEvent, 4096)}
	if host == "" || public == "" || secret == "" {
		return lf
	}
	lf.url = strings.TrimRight(host, "/") + "/api/public/ingestion"
	lf.auth = base64.StdEncoding.EncodeToString([]byte(public + ":" + secret))
	lf.enabled = true
	go lf.loop()
	return lf
}

// Enabled 는 전송 가능 여부.
func (lf *Langfuse) Enabled() bool { return lf.enabled }

// Enqueue 는 이벤트들을 비차단으로 큐에 넣는다(가득 차면 드롭+경고).
func (lf *Langfuse) Enqueue(events ...ingestEvent) {
	if !lf.enabled {
		return
	}
	for _, e := range events {
		select {
		case lf.ch <- e:
		default:
			slog.Warn("glue: ingestion 큐 가득 — 이벤트 드롭")
		}
	}
}

// loop 은 버퍼를 모아 배치 전송한다(최대 100건 / 1초).
func (lf *Langfuse) loop() {
	t := time.NewTicker(1 * time.Second)
	defer t.Stop()
	batch := make([]ingestEvent, 0, 100)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		lf.send(batch)
		batch = batch[:0]
	}
	for {
		select {
		case e := <-lf.ch:
			batch = append(batch, e)
			if len(batch) >= 100 {
				flush()
			}
		case <-t.C:
			flush()
		}
	}
}

func (lf *Langfuse) send(batch []ingestEvent) {
	body, err := json.Marshal(map[string]any{"batch": batch})
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, lf.url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Basic "+lf.auth)
	req.Header.Set("x-langfuse-ingestion-version", "4")
	resp, err := lf.http.Do(req)
	if err != nil {
		slog.Warn("glue: ingestion 전송 실패", "err", err, "events", len(batch))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		slog.Warn("glue: ingestion 응답 비정상", "status", resp.StatusCode, "events", len(batch))
	}
}
