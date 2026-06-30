package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
	"github.com/maymust/fabrix-endpoint/internal/langfuse"
)

// handleTraces 는 GET /api/v1/traces?range=&decision=&status=&model=&app=&q= (Langfuse 정합 트레이스 목록).
// q(IMP-32) 는 가산적 자유 텍스트 전문검색 — 화이트리스트 필드만 대상(마스킹/가드 원문 제외).
func (s *Server) handleTraces(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rng := domain.ParseRange(q.Get("range"))
	f := langfuse.Filters{Decision: q.Get("decision"), Status: q.Get("status"), Model: q.Get("model"), App: q.Get("app"), Q: strings.TrimSpace(q.Get("q"))}
	rep, err := s.lf.Traces(r.Context(), rng, f)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "트레이스 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, rep)
}

// handleTrace 는 GET /api/v1/traces/{id} (span waterfall — Dynamo/vLLM OTel + Langfuse observation).
func (s *Server) handleTrace(w http.ResponseWriter, r *http.Request) {
	d, err := s.lf.Trace(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "트레이스 상세 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

// handleSessions 는 GET /api/v1/sessions?range=&app= (Langfuse Sessions — 멀티턴 대화).
func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	rng := domain.ParseRange(r.URL.Query().Get("range"))
	rep, err := s.lf.Sessions(r.Context(), rng, r.URL.Query().Get("app"))
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "세션 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, rep)
}

// handleSession 은 GET /api/v1/sessions/{id} (세션 턴 타임라인).
func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	d, err := s.lf.Session(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "세션 상세 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

// recordScoreRequest 는 라이브 trace/session 에 평가 점수를 기록하는 본문(Langfuse scores 정합).
type recordScoreRequest struct {
	Name          string  `json:"name"`
	Value         float64 `json:"value"`
	StringValue   string  `json:"string_value"`
	DataType      string  `json:"data_type"` // numeric|categorical|boolean
	Comment       string  `json:"comment"`
	Source        string  `json:"source"` // human|llm-judge|api
	ObservationID string  `json:"observation_id"`
	SessionID     string  `json:"session_id"`
}

// handleRecordScore 는 POST /api/v1/traces/{id}/scores — 선택 trace 에 평가 점수를 부착(mock).
// eval.go 의 LLM-as-judge 결과(또는 사람 평가)를 라이브 trace 에 기록하는 경로. mock-stage 에서는
// 영속 저장 없이 정규화된 Score 를 echo 한다(스키마/흐름 잠금). 실연동 시 Langfuse ingestion 으로 대체.
func (s *Server) handleRecordScore(w http.ResponseWriter, r *http.Request) {
	traceID := r.PathValue("id")
	if traceID == "" {
		httpx.Error(w, http.StatusBadRequest, "trace_id 누락")
		return
	}
	var req recordScoreRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	if req.Name == "" {
		httpx.Error(w, http.StatusBadRequest, "name 은 필수입니다")
		return
	}
	dt := domain.ScoreDataType(req.DataType)
	if dt != "numeric" && dt != "categorical" && dt != "boolean" {
		dt = "numeric"
	}
	src := domain.ScoreSource(req.Source)
	if src != "human" && src != "llm-judge" && src != "api" {
		src = "api"
	}
	sc := domain.Score{
		Name: req.Name, Value: req.Value, StringValue: req.StringValue, DataType: dt,
		Comment: req.Comment, Source: src, TraceID: traceID,
		ObservationID: req.ObservationID, SessionID: req.SessionID, TS: time.Now().UTC().Format(time.RFC3339),
	}
	httpx.JSON(w, http.StatusOK, sc)
}

// handleGuardContent 는 GET /api/v1/guard/content?trace_id= (차단 프롬프트 원문 — Langfuse GUARDRAIL observation.input).
// Semantic Router 는 원문을 보존하지 않으므로(구현가능성-검증 §2-3), Langfuse 계측분에서만 원문 확보.
func (s *Server) handleGuardContent(w http.ResponseWriter, r *http.Request) {
	traceID := r.URL.Query().Get("trace_id")
	if traceID == "" {
		httpx.Error(w, http.StatusBadRequest, "trace_id 누락")
		return
	}
	gc, err := s.lf.GuardContent(r.Context(), traceID)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "원문 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, gc)
}
