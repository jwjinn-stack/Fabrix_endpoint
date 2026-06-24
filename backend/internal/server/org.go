package server

import (
	"encoding/json"
	"net/http"

	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// handleOrg 는 GET /api/v1/org — 부서 → 앱 → 키 + 부서별 사용자 트리.
func (s *Server) handleOrg(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "스토어 미구성 (FABRIX_DATABASE_URL)")
		return
	}
	tree, err := s.store.OrgTree(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "조직 트리 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, tree)
}

// handleSetAppDept 는 PUT /api/v1/apps/{id}/dept — 앱의 소속 부서 설정("" 면 미귀속).
func (s *Server) handleSetAppDept(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "스토어 미구성")
		return
	}
	var req struct {
		DeptID string `json:"dept_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	if err := s.store.SetAppDept(r.Context(), r.PathValue("id"), req.DeptID); err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
