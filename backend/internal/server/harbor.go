package server

import (
	"encoding/json"
	"net/http"

	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// handleHarborModels 는 GET /api/v1/harbor/models (Harbor 레지스트리의 모델 목록).
func (s *Server) handleHarborModels(w http.ResponseWriter, r *http.Request) {
	if s.harbor == nil || !s.harbor.Enabled() {
		httpx.JSON(w, http.StatusOK, map[string]any{"models": []any{}, "available": false})
		return
	}
	models, err := s.harbor.ListModels(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "Harbor 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"models": models, "available": true})
}

// handleHarborStatus 는 GET /api/v1/harbor/status (레지스트리 상태/용량).
func (s *Server) handleHarborStatus(w http.ResponseWriter, r *http.Request) {
	if s.harbor == nil || !s.harbor.Enabled() {
		httpx.JSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	httpx.JSON(w, http.StatusOK, s.harbor.Status(r.Context()))
}

// handleHarborImport 는 POST /api/v1/harbor/import (HF→Harbor 임포트 잡 트리거).
// UI 에서 HF 모델 ID 입력 → 백엔드가 k8s Job(다운로드·패키징·Harbor push)을 생성.
// ※ dev 에서는 사용자가 직접 CLI push 하기도 함 — 그 경우 CLI 명령을 함께 반환.
func (s *Server) handleHarborImport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Source  string `json:"source"`   // hf | ngc
		ModelID string `json:"model_id"` // 예: Qwen/Qwen3-0.6B
		Project string `json:"project"`  // Harbor 프로젝트(기본 library)
		Apply   bool   `json:"apply"`    // true 면 실제 Job 생성, 아니면 미리보기
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil || req.ModelID == "" {
		httpx.Error(w, http.StatusBadRequest, "model_id 는 필수입니다")
		return
	}
	if req.Project == "" {
		req.Project = "library"
	}
	if s.k8s == nil || !s.k8s.Enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "kubectl 미구성 — 임포트 잡 생성 불가")
		return
	}
	res, err := s.k8s.ImportModelJob(r.Context(), req.Source, req.ModelID, req.Project, !req.Apply)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "임포트 잡 처리 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}
