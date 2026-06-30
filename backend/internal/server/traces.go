package server

import (
	"net/http"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
	"github.com/maymust/fabrix-endpoint/internal/langfuse"
)

// handleTraces 는 GET /api/v1/traces?range=&decision=&status=&model=&app= (Langfuse 정합 트레이스 목록).
func (s *Server) handleTraces(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rng := domain.ParseRange(q.Get("range"))
	f := langfuse.Filters{Decision: q.Get("decision"), Status: q.Get("status"), Model: q.Get("model"), App: q.Get("app")}
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
