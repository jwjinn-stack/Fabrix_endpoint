package server

import (
	"encoding/json"
	"net/http"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// handleListUsers 는 GET /api/v1/users (RBAC #13).
func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "스토어 미구성 (FABRIX_DATABASE_URL)")
		return
	}
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "사용자 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"users": users, "roles": []string{"admin", "user", "super"}})
}

// handleCreateUser 는 POST /api/v1/users.
func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "스토어 미구성")
		return
	}
	var req domain.UserUpsertRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	u, err := s.store.CreateUser(r.Context(), req)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, u)
}

// handleUpdateUser 는 PUT /api/v1/users/{id} (역할/부서/상태).
func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "스토어 미구성")
		return
	}
	var req domain.UserUpsertRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	if err := s.store.UpdateUser(r.Context(), r.PathValue("id"), req); err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// handleDeleteUser 는 DELETE /api/v1/users/{id}.
func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "스토어 미구성")
		return
	}
	if err := s.store.DeleteUser(r.Context(), r.PathValue("id")); err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
