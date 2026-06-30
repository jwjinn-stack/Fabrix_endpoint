package glue

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// CaptureRequest 는 게이트웨이/어댑터가 글루에 보내는 1건 캡처 페이로드.
// 프롬프트/응답은 원문으로 보내고, 무엇을 보존할지는 글루가 마스킹 정책으로 결정한다.
type CaptureRequest struct {
	// 트레이스 병합 키 — 둘 중 하나. OTEL 스팬과 같은 trace 로 합치려면 동일 W3C trace-id 필수.
	TraceParent string `json:"traceparent,omitempty"` // "00-<trace-id>-<span-id>-01"
	TraceID     string `json:"trace_id,omitempty"`    // 32 hex (traceparent 없을 때)

	SessionID string `json:"session_id,omitempty"`
	UserID    string `json:"user_id,omitempty"` // 해시된 값 권장(원문 식별자 금지)
	AppID     string `json:"app_id,omitempty"`
	DeptID    string `json:"dept_id,omitempty"`
	Model     string `json:"model,omitempty"`

	Prompt   string `json:"prompt,omitempty"`   // 원문(글루가 정책대로 마스킹)
	Response string `json:"response,omitempty"` // 원문

	Decision     string      `json:"decision,omitempty"` // allowed | flagged | blocked
	GuardTypes   []string    `json:"guard_types,omitempty"`
	JBConfidence float64     `json:"jb_confidence,omitempty"`
	PIIEntities  []PIIEntity `json:"pii_entities,omitempty"`

	StartTime           time.Time `json:"start_time,omitempty"`
	CompletionStartTime time.Time `json:"completion_start_time,omitempty"` // TTFT 기준
	EndTime             time.Time `json:"end_time,omitempty"`
	PromptTokens        int       `json:"prompt_tokens,omitempty"`
	CompletionTokens    int       `json:"completion_tokens,omitempty"`
}

// Glue 는 정책·마스커·Langfuse 전송기를 묶는다.
type Glue struct {
	policy *PolicyStore
	mask   *Masker
	lf     *Langfuse
}

// New 는 글루를 만든다.
func New(policy *PolicyStore, mask *Masker, lf *Langfuse) *Glue {
	return &Glue{policy: policy, mask: mask, lf: lf}
}

// Capture 는 1건을 정책대로 마스킹해 Langfuse ingestion 배치로 비동기 전송한다.
func (g *Glue) Capture(req CaptureRequest) {
	p := g.policy.Get()
	traceID := normalizeTraceID(req.TraceParent, req.TraceID)
	blocked := req.Decision == string(domain.DecisionBlocked)

	inMode := p.CaptureInput
	outMode := p.CaptureOutput
	if blocked && p.BlockedCapture != "" {
		inMode, outMode = p.BlockedCapture, p.BlockedCapture
	}
	maskedPrompt := g.mask.Apply(req.Prompt, inMode, p, req.PIIEntities)
	maskedResp := g.mask.Apply(req.Response, outMode, p, req.PIIEntities)

	now := time.Now().UTC().Format(time.RFC3339)
	events := make([]ingestEvent, 0, 4)

	// 1) trace
	tags := []string{}
	if req.Decision != "" {
		tags = append(tags, req.Decision)
	}
	if req.DeptID != "" {
		tags = append(tags, "dept:"+req.DeptID)
	}
	events = append(events, ingestEvent{ID: newID(), Type: "trace-create", Timestamp: now, Body: traceBody{
		ID: traceID, Name: "inference", UserID: req.UserID, SessionID: req.SessionID, Tags: tags,
		Metadata: map[string]string{"app_id": req.AppID, "dept_id": req.DeptID},
	}})

	// 2) GUARDRAIL observation (판정 + 마스킹된 입력)
	level := "DEFAULT"
	if blocked {
		level = "ERROR"
	} else if req.Decision == string(domain.DecisionFlagged) {
		level = "WARNING"
	}
	events = append(events, ingestEvent{ID: newID(), Type: "observation-create", Timestamp: now, Body: obsBody{
		ID: newID(), TraceID: traceID, Type: "GUARDRAIL", Name: "semantic-router",
		Input: maskedPrompt, Output: map[string]any{"decision": req.Decision, "types": req.GuardTypes}, Level: level,
	}})

	// 3) GENERATION (프롬프트/응답 + 토큰/지연). 차단 시 응답 없음.
	gen := genBody{
		ID: newID(), TraceID: traceID, Name: "llm", Model: req.Model,
		Input: maskedPrompt, Output: maskedResp,
	}
	if !req.StartTime.IsZero() {
		gen.StartTime = req.StartTime.UTC().Format(time.RFC3339Nano)
	}
	if !req.CompletionStartTime.IsZero() {
		gen.CompletionStartTime = req.CompletionStartTime.UTC().Format(time.RFC3339Nano)
	}
	if !req.EndTime.IsZero() {
		gen.EndTime = req.EndTime.UTC().Format(time.RFC3339Nano)
	}
	if req.PromptTokens > 0 || req.CompletionTokens > 0 {
		gen.UsageDetails = map[string]int{"input": req.PromptTokens, "output": req.CompletionTokens}
	}
	events = append(events, ingestEvent{ID: newID(), Type: "generation-create", Timestamp: now, Body: gen})

	// 4) score (jailbreak confidence + 판정 카테고리)
	if req.JBConfidence > 0 {
		events = append(events, ingestEvent{ID: newID(), Type: "score-create", Timestamp: now, Body: scoreBody{
			TraceID: traceID, Name: "jb_confidence", Value: req.JBConfidence, DataType: "NUMERIC",
		}})
	}
	if req.Decision != "" {
		events = append(events, ingestEvent{ID: newID(), Type: "score-create", Timestamp: now, Body: scoreBody{
			TraceID: traceID, Name: "guard_decision", Value: req.Decision, DataType: "CATEGORICAL",
		}})
	}

	g.lf.Enqueue(events...)
}

// Handler 는 게이트웨이/어댑터가 호출하는 캡처 HTTP 핸들러를 반환한다.
//
//	POST /v1/capture  (JSON CaptureRequest) → 202 Accepted (비동기 적재)
//	GET  /healthz
func (g *Glue) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "langfuse": g.lf.Enabled()})
	})
	mux.HandleFunc("POST /v1/capture", func(w http.ResponseWriter, r *http.Request) {
		var req CaptureRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
			http.Error(w, `{"error":"잘못된 본문"}`, http.StatusBadRequest)
			return
		}
		g.Capture(req)
		w.WriteHeader(http.StatusAccepted)
	})
	return mux
}

// ── ingestion body 타입 ──

type traceBody struct {
	ID        string            `json:"id"`
	Name      string            `json:"name,omitempty"`
	UserID    string            `json:"userId,omitempty"`
	SessionID string            `json:"sessionId,omitempty"`
	Tags      []string          `json:"tags,omitempty"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

type genBody struct {
	ID                  string         `json:"id"`
	TraceID             string         `json:"traceId"`
	Name                string         `json:"name,omitempty"`
	Model               string         `json:"model,omitempty"`
	Input               string         `json:"input,omitempty"`
	Output              string         `json:"output,omitempty"`
	StartTime           string         `json:"startTime,omitempty"`
	CompletionStartTime string         `json:"completionStartTime,omitempty"`
	EndTime             string         `json:"endTime,omitempty"`
	UsageDetails        map[string]int `json:"usageDetails,omitempty"`
}

type obsBody struct {
	ID      string `json:"id"`
	TraceID string `json:"traceId"`
	Type    string `json:"type"`
	Name    string `json:"name,omitempty"`
	Input   string `json:"input,omitempty"`
	Output  any    `json:"output,omitempty"`
	Level   string `json:"level,omitempty"`
}

type scoreBody struct {
	TraceID  string `json:"traceId"`
	Name     string `json:"name"`
	Value    any    `json:"value"`
	DataType string `json:"dataType"`
	Comment  string `json:"comment,omitempty"`
}

// normalizeTraceID 는 traceparent(2번째 필드) 또는 trace_id 를 쓰고, 없으면 16바이트 hex 생성.
func normalizeTraceID(traceparent, traceID string) string {
	if traceparent != "" {
		parts := strings.Split(traceparent, "-")
		if len(parts) >= 2 && len(parts[1]) == 32 {
			return strings.ToLower(parts[1])
		}
	}
	if len(traceID) == 32 {
		return strings.ToLower(traceID)
	}
	return randomHex(16)
}

func newID() string { return randomHex(16) }
func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
