package server

import (
	"encoding/json"
	"net/http"

	"github.com/maymust/fabrix-endpoint/internal/httpx"
	"github.com/maymust/fabrix-endpoint/internal/k8s"
)

// handleListEndpoints 는 GET /api/v1/endpoints (DynamoGraphDeployment 목록).
func (s *Server) handleListEndpoints(w http.ResponseWriter, r *http.Request) {
	if s.k8s == nil || !s.k8s.Enabled() {
		httpx.JSON(w, http.StatusOK, map[string]any{"endpoints": []any{}, "available": false})
		return
	}
	eps, err := s.k8s.List(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "엔드포인트 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"endpoints": eps, "available": true})
}

// handlePreviewEndpoint 는 POST /api/v1/endpoints/preview (매니페스트 미리보기 + 서버 dry-run).
func (s *Server) handlePreviewEndpoint(w http.ResponseWriter, r *http.Request) {
	if s.k8s == nil || !s.k8s.Enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "kubectl 미구성 — 엔드포인트 기능 비활성")
		return
	}
	spec, ok := decodeSpec(w, r)
	if !ok {
		return
	}
	manifest := s.k8s.Manifest(spec)
	// 서버측 dry-run 검증
	res, err := s.k8s.Create(r.Context(), spec, true)
	resp := map[string]any{"manifest": manifest, "dry_run_ok": err == nil}
	if err != nil {
		resp["dry_run_error"] = err.Error()
	} else {
		resp["dry_run_result"] = res
	}
	httpx.JSON(w, http.StatusOK, resp)
}

// handleCreateEndpoint 는 POST /api/v1/endpoints (실제 생성 — apply=true 필요).
func (s *Server) handleCreateEndpoint(w http.ResponseWriter, r *http.Request) {
	if s.k8s == nil || !s.k8s.Enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "kubectl 미구성 — 엔드포인트 기능 비활성")
		return
	}
	spec, ok := decodeSpec(w, r)
	if !ok {
		return
	}
	if spec.Name == "" || (spec.Model == "" && spec.HarborRef == "") {
		httpx.Error(w, http.StatusBadRequest, "name 과 model(또는 harbor_ref) 은 필수입니다")
		return
	}
	// apply 쿼리=true 가 아니면 안전하게 dry-run 만(실수 방지).
	apply := r.URL.Query().Get("apply") == "true"
	res, err := s.k8s.Create(r.Context(), spec, !apply)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "생성 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"result": res, "applied": apply})
}

// handleDeleteEndpoint 는 DELETE /api/v1/endpoints/{ns}/{name} (우리가 만든 CR 만).
func (s *Server) handleDeleteEndpoint(w http.ResponseWriter, r *http.Request) {
	if s.k8s == nil || !s.k8s.Enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "kubectl 미구성")
		return
	}
	ns := r.PathValue("ns")
	name := r.PathValue("name")
	if err := s.k8s.Delete(r.Context(), ns, name); err != nil {
		httpx.Error(w, http.StatusForbidden, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "deleted", "name": name})
}

// handleEndpointLogs 는 GET /api/v1/endpoints/{ns}/{name}/logs?component=&tail= (P4-8 실시간 로그).
// 읽기 전용 — 파드 로그 tail. component 비면 전체 컴포넌트.
func (s *Server) handleEndpointLogs(w http.ResponseWriter, r *http.Request) {
	if s.k8s == nil || !s.k8s.Enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "kubectl 미구성")
		return
	}
	ns := r.PathValue("ns")
	name := r.PathValue("name")
	component := r.URL.Query().Get("component")
	tail := 200
	if v := r.URL.Query().Get("tail"); v != "" {
		if n, err := parseIntSafe(v); err == nil && n > 0 {
			tail = n
		}
	}
	logs, err := s.k8s.Logs(r.Context(), ns, name, component, tail)
	comps := s.k8s.Components(r.Context(), ns, name)
	resp := map[string]any{"logs": logs, "components": comps, "ok": err == nil}
	if err != nil {
		resp["error"] = err.Error()
	}
	httpx.JSON(w, http.StatusOK, resp)
}

func decodeSpec(w http.ResponseWriter, r *http.Request) (k8s.CreateSpec, bool) {
	var spec k8s.CreateSpec
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&spec); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return spec, false
	}
	return spec, true
}
