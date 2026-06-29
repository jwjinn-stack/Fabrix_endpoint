package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// handleGetMaskingPolicy 는 GET /api/v1/masking/policy.
// 설정 화면이 읽고, 게이트웨이 글루가 폴링해서 ingestion 전 캡처/마스킹에 적용한다.
// DB 미구성 시 기본값을 반환(글루가 항상 사용 가능한 정책을 받도록).
func (s *Server) handleGetMaskingPolicy(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.JSON(w, http.StatusOK, domain.DefaultMaskingPolicy())
		return
	}
	p, err := s.store.GetMaskingPolicy(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "마스킹 정책 조회 실패")
		return
	}
	httpx.JSON(w, http.StatusOK, p)
}

// handleSetMaskingPolicy 는 PUT /api/v1/masking/policy (설정 화면 저장).
func (s *Server) handleSetMaskingPolicy(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "정책 저장소(PostgreSQL) 미구성 (FABRIX_DATABASE_URL)")
		return
	}
	var p domain.MaskingPolicy
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&p); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 정책 본문")
		return
	}
	p.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := s.store.SetMaskingPolicy(r.Context(), p); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "마스킹 정책 저장 실패")
		return
	}
	saved, err := s.store.GetMaskingPolicy(r.Context())
	if err != nil {
		httpx.JSON(w, http.StatusOK, p)
		return
	}
	httpx.JSON(w, http.StatusOK, saved)
}
