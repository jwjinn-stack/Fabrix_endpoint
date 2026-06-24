package server

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// handleListKeys 는 GET /api/v1/keys?range= (키 목록 + 쿼터 + 키별 사용량 귀속, #5).
func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "키 스토어 미구성 (FABRIX_DATABASE_URL)")
		return
	}
	keys, err := s.store.ListKeys(r.Context())
	if err != nil {
		slog.Error("키 목록 조회 실패", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "키 목록 조회 실패")
		return
	}
	// 키별 사용량(usage_rollup api_key_id 축) 머지 — 스펜드/Top5 표시.
	if s.usage != nil && s.usage.Enabled() {
		rng := domain.ParseRange(r.URL.Query().Get("range"))
		if rows, err := s.usage.QueryRollup(r.Context(), rng, "api_key"); err == nil {
			byKey := make(map[string]domain.UsageRow, len(rows))
			for _, u := range rows {
				byKey[u.APIKeyID] = u
			}
			for i := range keys {
				if u, ok := byKey[keys[i].APIKeyID]; ok {
					keys[i].Requests = u.Requests
					keys[i].PromptToks = u.PromptTokens
					keys[i].CompTokens = u.CompletionTokens
					keys[i].EstCostKRW = round1(domain.EstCostKRW(u.Model, u.PromptTokens, u.CompletionTokens))
				}
			}
		}
	}
	// 오늘 누적 토큰 + 경고 임계(인메모리 예산 카운터) — 인앱 예산 진행 게이지(P4-5).
	for i := range keys {
		keys[i].TokensToday = s.quota.TokensToday(keys[i].APIKeyID)
		at := s.quota.AlertThreshold(keys[i].APIKeyID)
		keys[i].AlertThreshold = &at
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"keys": keys})
}

// handleIssueKey 는 POST /api/v1/keys (키 발급 — 평문 1회 반환).
func (s *Server) handleIssueKey(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "키 스토어 미구성 (FABRIX_DATABASE_URL)")
		return
	}
	var req domain.IssueKeyRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	if req.AppID == "" && req.AppName == "" {
		httpx.Error(w, http.StatusBadRequest, "app_id 또는 app_name 은 필수입니다")
		return
	}
	issued, err := s.store.IssueKey(r.Context(), req)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "키 발급 실패: "+err.Error())
		return
	}
	// 예산 경고 임계(P4-5) — 인메모리 보관(DB DDL 권한 불필요).
	if req.AlertThreshold != nil {
		s.quota.SetAlertThreshold(issued.APIKeyID, *req.AlertThreshold)
	}
	httpx.JSON(w, http.StatusCreated, issued)
}

// handleRevokeKey 는 DELETE /api/v1/keys/{id} (키 회수).
func (s *Server) handleRevokeKey(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "키 스토어 미구성")
		return
	}
	id := r.PathValue("id")
	if err := s.store.RevokeKey(r.Context(), id); err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "revoked", "api_key_id": id})
}
