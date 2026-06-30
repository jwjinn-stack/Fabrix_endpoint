package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
	"github.com/maymust/fabrix-endpoint/internal/usage"
)

// handleModels 는 GET /api/v1/models (모델 카탈로그).
// 상태(ready/unreachable)는 k8s 실제 readiness 로 보정한다 — dev 백엔드가 맥에서 돌아
// in-cluster DNS HTTP 프로브가 안 되는 경우에도 클러스터 실상태를 반영(목업 아님).
func (s *Server) handleModels(w http.ResponseWriter, r *http.Request) {
	cat := s.catalog.Models(r.Context())
	if s.k8s != nil && s.k8s.Enabled() {
		ready := s.k8s.ModelReadiness(r.Context())
		for i := range cat.Models {
			m := &cat.Models[i]
			if m.Workload == "" {
				continue
			}
			if r, ok := ready[m.Namespace+"/"+m.Workload]; ok {
				if r {
					m.Status = "ready"
				} else if m.Status == "ready" {
					m.Status = "unknown"
				}
			}
		}
	}
	httpx.JSON(w, http.StatusOK, cat)
}

// modelMetricsSource 는 모델별 live 운영 메트릭 능력(P4-6, live·mock 모두 구현).
type modelMetricsSource interface {
	ModelMetrics(ctx context.Context, ids []string) map[string]domain.ModelLive
}

// gpuForModel 은 모델 id/컨텍스트로 요구 GPU 수를 추정한다(휴리스틱, 카탈로그 미보유).
func gpuForModel(id string, ctxWindow int) int {
	m := strings.ToLower(id)
	switch {
	case strings.Contains(m, "120b"), strings.Contains(m, "70b"):
		return 4
	case strings.Contains(m, "31b"), strings.Contains(m, "30b"), strings.Contains(m, "32b"):
		return 1
	case strings.Contains(m, "embedding"), strings.Contains(m, "rerank"), strings.Contains(m, "bge"):
		return 1
	default:
		return 1
	}
}

// patternFor 은 serving 문자열을 agg/disagg/vllm 패턴으로 정규화한다.
func patternFor(serving string) string {
	s := strings.ToLower(serving)
	switch {
	case strings.Contains(s, "disagg"):
		return "disagg"
	case strings.Contains(s, "agg"):
		return "agg"
	default:
		return "vllm"
	}
}

// handleModelMetrics 는 GET /api/v1/models/metrics (P4-6 카드 전면 운영 메트릭).
// 카탈로그 메타(serving/context/gpu) + dynamo by-model live 메트릭(tok/s·TTFT·E2E) 조인.
func (s *Server) handleModelMetrics(w http.ResponseWriter, r *http.Request) {
	cat := s.catalog.Models(r.Context())
	ids := make([]string, 0, len(cat.Models))
	for _, m := range cat.Models {
		ids = append(ids, m.ID)
	}
	live := map[string]domain.ModelLive{}
	if src, ok := s.dashboard.(modelMetricsSource); ok {
		live = src.ModelMetrics(r.Context(), ids)
	}
	// k8s readiness 보정.
	ready := map[string]bool{}
	if s.k8s != nil && s.k8s.Enabled() {
		ready = s.k8s.ModelReadiness(r.Context())
	}
	out := make([]domain.ModelMetric, 0, len(cat.Models))
	for _, m := range cat.Models {
		lv := live[m.ID]
		status := m.Status
		if rdy, ok := ready[m.Namespace+"/"+m.Workload]; ok && rdy {
			status = "ready"
		}
		out = append(out, domain.ModelMetric{
			Model:         m.ID,
			DisplayName:   m.DisplayName,
			Serving:       m.Serving,
			Pattern:       patternFor(m.Serving),
			ContextWindow: m.ContextWindow,
			GPU:           gpuForModel(m.ID, m.ContextWindow),
			TokS:          lv.TokS,
			TTFTp95ms:     lv.TTFTp95ms,
			E2Ep95ms:      lv.E2Ep95ms,
			Requests:      lv.Requests,
			Deployed:      lv.Deployed || status == "ready",
			Status:        status,
		})
	}
	httpx.JSON(w, http.StatusOK, domain.ModelMetricsReport{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Models:      out,
		Source:      s.dataSource,
	})
}

// handlePlaygroundChat 는 POST /api/v1/playground/chat (플레이그라운드 채팅 프록시).
// 모든 요청은 업스트림 호출 전 가드레일(PII/Jailbreak) 판정을 거치고 증적이 남는다.
func (s *Server) handlePlaygroundChat(w http.ResponseWriter, r *http.Request) {
	var req domain.ChatRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	if req.Model == "" || len(req.Messages) == 0 {
		httpx.Error(w, http.StatusBadRequest, "model 과 messages 는 필수입니다")
		return
	}

	// 키 쿼터 강제(#5): x-api-key-id 제시 시 분당 한도 초과면 429. (LiteLLM/Portkey 패턴)
	if keyID := r.Header.Get("x-api-key-id"); keyID != "" && keyID != "-" && s.store != nil {
		if q, _ := s.store.KeyQuota(r.Context(), keyID); q.Found {
			if !q.Enabled {
				httpx.Error(w, http.StatusForbidden, "비활성/회수된 키입니다")
				return
			}
			rpm := 0
			if q.QuotaRPM != nil {
				rpm = *q.QuotaRPM
			}
			if !s.quota.Allow(keyID, rpm) {
				w.Header().Set("Retry-After", "60")
				httpx.Error(w, http.StatusTooManyRequests, "분당 요청 한도(rpm) 초과")
				return
			}
			// 일 토큰 예산 하드캡(P4-5): 오늘 누적이 tpd 이상이면 429(다음날 리셋).
			if q.QuotaTPD != nil && s.quota.OverTPD(keyID, *q.QuotaTPD) {
				w.Header().Set("Retry-After", "3600")
				httpx.Error(w, http.StatusTooManyRequests, "일 토큰 예산(tpd) 초과 — 익일 00:00 UTC 리셋")
				return
			}
		}
	}

	// 가드레일 판정(마지막 user 메시지) + 증적 적재.
	verdict := s.classifyAndAudit(r.Context(), r, lastUserText(req.Messages), req.Model)
	if verdict.Decision == domain.DecisionBlocked {
		// 차단 — 업스트림 미호출, 정책 메시지 반환(증권사 컴플라이언스).
		s.pstats.Record(verdict.LatencyMs, 0, true, req.Model)
		v := verdict
		httpx.JSON(w, http.StatusOK, domain.ChatResponse{
			Model:   req.Model,
			Content: verdict.Reason,
			Guard:   &v,
		})
		return
	}

	resp, code, err := s.catalog.Chat(r.Context(), req)
	if err != nil {
		httpx.Error(w, code, err.Error())
		return
	}
	v := verdict
	resp.Guard = &v

	// 프록시 실측 통계(트래픽/프록시 뷰 #9): 가드레일 지연 + 업스트림 지연.
	s.pstats.Record(verdict.LatencyMs, resp.LatencyMs, false, resp.Model)

	// 일 토큰 예산 카운터 적립(P4-5 하드캡 입력) — x-api-key-id 제시 시.
	if keyID := r.Header.Get("x-api-key-id"); keyID != "" && keyID != "-" {
		s.quota.AddTokens(keyID, resp.PromptTokens+resp.CompletionTokens)
	}

	// 사용량 롤업 적재(부서·앱·키 축 귀속, #4). 모든 추론이 프록시를 통과 = 트레이스 지점.
	if s.usage != nil && s.usage.Enabled() {
		idApp := "playground"
		if id, _ := httpx.IdentityFrom(r.Context()); id.AppID != "" {
			idApp = id.AppID
		}
		s.usage.Enqueue(usage.Event{
			Ts:               time.Now().UTC(),
			DeptID:           s.resolveDept(r),
			AppID:            idApp,
			APIKeyID:         headerOr(r, "x-api-key-id", "-"),
			Model:            resp.Model,
			PromptTokens:     resp.PromptTokens,
			CompletionTokens: resp.CompletionTokens,
		})
	}

	httpx.JSON(w, code, resp)
}

// lastUserText 는 가드레일 검사 대상(마지막 user 메시지)을 추출한다.
func lastUserText(msgs []domain.ChatMessage) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			return msgs[i].Content
		}
	}
	if len(msgs) > 0 {
		return msgs[len(msgs)-1].Content
	}
	return ""
}
