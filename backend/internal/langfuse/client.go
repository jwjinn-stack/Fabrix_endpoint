// Package langfuse 는 Langfuse Public API(트레이스/관측/세션/가드레일 원문) 연동 클라이언트다.
//
// 설계(docs/langfuse-trace-정합-설계.md): BFF → langfuse-web ClusterIP /api/public/* (HTTP Basic,
// public=user / secret=pass, secret 은 서버에만 보관). 하이브리드(방식 B): LLM 토큰·비용·프롬프트·
// 가드레일/검색은 Langfuse, 서빙 내부(prefill/decode 등)는 victoria-traces(OTel) span.
//
// 서버 없는 현실: LANGFUSE_HOST 미설정이면 synthetic 폴백(synth.go)으로 동작한다. 실 Langfuse 가
// 구성되면 실연동 경로가 우선하고, 실연동 오류 시에는 synthetic 으로 graceful fallback 한다(대시보드 BFF).
package langfuse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// Filters 는 트레이스 목록 필터.
type Filters struct{ Decision, Status, Model, App string }

// Client 는 Langfuse Public API 클라이언트.
type Client struct {
	host   string // 예: http://langfuse-web.langfuse.svc.cluster.local:3000
	public string
	secret string
	hc     *http.Client
}

// New 는 설정으로 클라이언트를 만든다. host 가 비면 synthetic 모드.
func New(host, public, secret string) *Client {
	return &Client{host: host, public: public, secret: secret, hc: &http.Client{Timeout: 8 * time.Second, Transport: httpx.Capturing(nil)}}
}

// Configured 는 실 Langfuse 연동 가능 여부.
func (c *Client) Configured() bool {
	return c != nil && c.host != "" && c.public != "" && c.secret != ""
}

// Probe 는 Langfuse 도달성·자격증명을 확인한다(traces?limit=1, read-only). 진단용.
func (c *Client) Probe(ctx context.Context) error {
	if !c.Configured() {
		return fmt.Errorf("langfuse 미설정")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	q := url.Values{}
	q.Set("limit", "1")
	var out struct {
		Data []json.RawMessage `json:"data"`
	}
	return c.get(ctx, "/traces", q, &out)
}

// get 은 /api/public 하위 경로를 Basic auth 로 GET 해서 JSON 을 디코드한다.
func (c *Client) get(ctx context.Context, path string, q url.Values, dst any) error {
	u := c.host + "/api/public" + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.SetBasicAuth(c.public, c.secret)
	req.Header.Set("Accept", "application/json")
	res, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("langfuse %s -> %d", path, res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(dst)
}

// ───────────────────────── 공개 메서드 (실연동 우선, 실패 시 synthetic) ─────────────────────────

func (c *Client) Traces(ctx context.Context, rng domain.TimeRange, f Filters) (domain.TraceListReport, error) {
	if !c.Configured() {
		return synthTraceList(rng, f), nil
	}
	rep, err := c.tracesLive(ctx, rng, f)
	if err != nil {
		// graceful fallback — 대시보드는 비지 않게(소스로 합성 표시)
		return synthTraceList(rng, f), nil
	}
	return rep, nil
}

func (c *Client) Trace(ctx context.Context, id string) (domain.TraceDetail, error) {
	if !c.Configured() {
		return synthTraceDetail(id), nil
	}
	d, err := c.traceLive(ctx, id)
	if err != nil {
		return synthTraceDetail(id), nil
	}
	return d, nil
}

func (c *Client) Sessions(ctx context.Context, rng domain.TimeRange, app string) (domain.SessionListReport, error) {
	if !c.Configured() {
		return synthSessionList(rng, app), nil
	}
	rep, err := c.sessionsLive(ctx, rng, app)
	if err != nil {
		return synthSessionList(rng, app), nil
	}
	return rep, nil
}

func (c *Client) Session(ctx context.Context, id string) (domain.SessionDetail, error) {
	if !c.Configured() {
		return synthSessionDetail(id), nil
	}
	d, err := c.sessionLive(ctx, id)
	if err != nil {
		return synthSessionDetail(id), nil
	}
	return d, nil
}

// GuardContent 는 차단 프롬프트 원문을 Langfuse GUARDRAIL observation.input 에서 가져온다.
// Semantic Router 는 원문을 보존하지 않으므로(구현가능성-검증 §2-3), 앱/프록시가 input 을
// 계측한 경우에만 Captured=true. 미계측이면 graceful 안내(원문 없음).
func (c *Client) GuardContent(ctx context.Context, traceID string) (domain.GuardContent, error) {
	if !c.Configured() {
		return synthGuardContent(traceID), nil
	}
	gc, err := c.guardContentLive(ctx, traceID)
	if err != nil {
		return synthGuardContent(traceID), nil
	}
	return gc, nil
}

// ───────────────────────── 실연동 매핑 (Langfuse v2 → domain) ─────────────────────────
// Langfuse Public API 응답 형태(검증: langfuse.com/docs public-api, openapi). 셀프호스트 버전에 따라
// Observations/Metrics v2 가용성이 다를 수 있어, 실 인스턴스 도입 직전 현행 OpenAPI 와 재대조 필요.

type lfTrace struct {
	ID        string         `json:"id"`
	Timestamp string         `json:"timestamp"`
	Name      string         `json:"name"`
	Input     any            `json:"input"`
	Output    any            `json:"output"`
	UserID    string         `json:"userId"`
	SessionID string         `json:"sessionId"`
	Tags      []string       `json:"tags"`
	Metadata  map[string]any `json:"metadata"`
	Latency   float64        `json:"latency"`   // 초
	TotalCost float64        `json:"totalCost"` // USD/등록단가
}

type lfObservation struct {
	ID                  string         `json:"id"`
	TraceID             string         `json:"traceId"`
	ParentObservationID string         `json:"parentObservationId"`
	Type                string         `json:"type"`
	Name                string         `json:"name"`
	StartTime           string         `json:"startTime"`
	EndTime             string         `json:"endTime"`
	CompletionStartTime string         `json:"completionStartTime"`
	Model               string         `json:"model"`
	ProvidedModelName   string         `json:"providedModelName"`
	Level               string         `json:"level"`
	Input               any            `json:"input"`
	Output              any            `json:"output"`
	UsageDetails        map[string]any `json:"usageDetails"`
	CostDetails         map[string]any `json:"costDetails"`
	TotalCost           float64        `json:"totalCost"`
	Metadata            map[string]any `json:"metadata"`
}

func mapTraceSummary(t lfTrace) domain.TraceSummary {
	s := domain.TraceSummary{
		TraceID: t.ID, TS: t.Timestamp, Model: str(t.Metadata["model"]), AppID: str(t.Metadata["app_id"]),
		DeptID: str(t.Metadata["dept_id"]), APIKeyID: str(t.Metadata["api_key_id"]),
		UserID: t.UserID, SessionID: t.SessionID, Route: str(t.Metadata["route"]),
		TotalMs: int(t.Latency * 1000), TotalCostKRW: t.TotalCost, Status: "ok", Decision: "allowed",
	}
	return s
}

func (c *Client) tracesLive(ctx context.Context, rng domain.TimeRange, _ Filters) (domain.TraceListReport, error) {
	var body struct {
		Data []lfTrace `json:"data"`
	}
	q := url.Values{}
	q.Set("limit", "100")
	if err := c.get(ctx, "/traces", q, &body); err != nil {
		return domain.TraceListReport{}, err
	}
	out := make([]domain.TraceSummary, 0, len(body.Data))
	for _, t := range body.Data {
		out = append(out, mapTraceSummary(t))
	}
	return domain.TraceListReport{Range: rng, GeneratedAt: nowRFC(), Traces: out, Source: "langfuse"}, nil
}

func (c *Client) traceLive(ctx context.Context, id string) (domain.TraceDetail, error) {
	var t lfTrace
	if err := c.get(ctx, "/traces/"+url.PathEscape(id), nil, &t); err != nil {
		return domain.TraceDetail{}, err
	}
	// observations → spans (parentObservationId 로 트리 구성, type → kind)
	var obs struct {
		Data []lfObservation `json:"data"`
	}
	q := url.Values{}
	q.Set("traceId", id)
	if err := c.get(ctx, "/observations", q, &obs); err != nil {
		return domain.TraceDetail{}, err
	}
	spans := make([]domain.TraceSpan, 0, len(obs.Data))
	for _, o := range obs.Data {
		spans = append(spans, mapObservation(o))
	}
	return domain.TraceDetail{
		Summary: mapTraceSummary(t), Spans: spans,
		InputPreview: str(t.Input), OutputPreview: str(t.Output),
	}, nil
}

func mapObservation(o lfObservation) domain.TraceSpan {
	kind := domain.SpanKind("span")
	switch o.Type {
	case "GENERATION":
		kind = "generation"
	case "GUARDRAIL":
		kind = "guardrail"
	case "RETRIEVER":
		kind = "retriever"
	case "EMBEDDING":
		kind = "embedding"
	case "TOOL":
		kind = "tool"
	case "AGENT":
		kind = "agent"
	case "EVENT":
		kind = "event"
	}
	return domain.TraceSpan{
		SpanID: o.ID, ParentID: o.ParentObservationID, Name: o.Name, Kind: kind, Source: "langfuse",
		Status: ternS(o.Level == "ERROR", "error", "ok"), Level: o.Level, Model: o.ProvidedModelName, CostKRW: o.TotalCost,
		Attributes: map[string]any{"usageDetails": o.UsageDetails, "costDetails": o.CostDetails, "completionStartTime": o.CompletionStartTime},
	}
}

func (c *Client) sessionsLive(ctx context.Context, rng domain.TimeRange, _ string) (domain.SessionListReport, error) {
	var body struct {
		Data []struct {
			ID        string `json:"id"`
			CreatedAt string `json:"createdAt"`
		} `json:"data"`
	}
	if err := c.get(ctx, "/sessions", url.Values{"limit": {"60"}}, &body); err != nil {
		return domain.SessionListReport{}, err
	}
	out := make([]domain.SessionSummary, 0, len(body.Data))
	for _, s := range body.Data {
		out = append(out, domain.SessionSummary{SessionID: s.ID, StartedAt: s.CreatedAt, LastAt: s.CreatedAt})
	}
	return domain.SessionListReport{Range: rng, GeneratedAt: nowRFC(), Sessions: out, Source: "langfuse"}, nil
}

func (c *Client) sessionLive(ctx context.Context, id string) (domain.SessionDetail, error) {
	var s struct {
		ID        string    `json:"id"`
		CreatedAt string    `json:"createdAt"`
		Traces    []lfTrace `json:"traces"`
	}
	if err := c.get(ctx, "/sessions/"+url.PathEscape(id), nil, &s); err != nil {
		return domain.SessionDetail{}, err
	}
	turns := make([]domain.SessionTurn, 0, len(s.Traces))
	for _, t := range s.Traces {
		turns = append(turns, domain.SessionTurn{TraceID: t.ID, TS: t.Timestamp, Model: str(t.Metadata["model"]), TotalMs: int(t.Latency * 1000), CostKRW: t.TotalCost, Decision: "allowed", Status: "ok", UserPreview: str(t.Input)})
	}
	return domain.SessionDetail{Summary: domain.SessionSummary{SessionID: s.ID, StartedAt: s.CreatedAt, Turns: len(turns)}, Turns: turns}, nil
}

func (c *Client) guardContentLive(ctx context.Context, traceID string) (domain.GuardContent, error) {
	// 해당 trace 의 GUARDRAIL observation 을 찾아 input(원문)·output(차단결정) 매핑.
	var obs struct {
		Data []lfObservation `json:"data"`
	}
	q := url.Values{"traceId": {traceID}, "type": {"GUARDRAIL"}}
	if err := c.get(ctx, "/observations", q, &obs); err != nil {
		return domain.GuardContent{}, err
	}
	gc := domain.GuardContent{TraceID: traceID, Source: "langfuse"}
	if len(obs.Data) == 0 {
		return gc, nil // 미계측 → Captured=false
	}
	o := obs.Data[0]
	in := str(o.Input)
	gc.Captured = in != ""
	gc.Input = in
	if m, ok := o.Output.(map[string]any); ok {
		gc.Output.Blocked, _ = m["blocked"].(bool)
		gc.Output.Reason = str(m["reason"])
		gc.Output.Category = str(m["category"])
	}
	return gc, nil
}

func str(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return ""
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}
