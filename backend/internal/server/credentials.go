package server

import (
	"encoding/json"
	"net/http"

	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// handleGetCredentials 는 GET /api/v1/credentials (서드파티 자격증명 마스킹 조회).
// HF Model Hub 토큰·NVIDIA NGC 키 — 모델 임포트(다운로드) 시 사용.
func (s *Server) handleGetCredentials(w http.ResponseWriter, r *http.Request) {
	if s.k8s == nil || !s.k8s.Enabled() {
		httpx.JSON(w, http.StatusOK, map[string]any{"credentials": []any{}, "available": false})
		return
	}
	creds, err := s.k8s.GetCredentials(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "자격증명 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"credentials": creds, "available": true})
}

// handleSetCredential 은 PUT /api/v1/credentials (자격증명 1건 업서트).
// 값(value)이 비면 이름만 갱신(기존 값 유지) — Nutanix Update 패턴.
func (s *Server) handleSetCredential(w http.ResponseWriter, r *http.Request) {
	if s.k8s == nil || !s.k8s.Enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "kubectl 미구성 — 자격증명 저장 불가")
		return
	}
	var req struct {
		Kind  string `json:"kind"`  // hf | ngc
		Name  string `json:"name"`  // 토큰/키 이름
		Value string `json:"value"` // 토큰/키 값(비면 이름만 갱신)
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil || (req.Kind != "hf" && req.Kind != "ngc") {
		httpx.Error(w, http.StatusBadRequest, "kind(hf|ngc) 는 필수입니다")
		return
	}
	if err := s.k8s.SetCredential(r.Context(), req.Kind, req.Name, req.Value); err != nil {
		httpx.Error(w, http.StatusBadGateway, "자격증명 저장 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "saved", "kind": req.Kind})
}
