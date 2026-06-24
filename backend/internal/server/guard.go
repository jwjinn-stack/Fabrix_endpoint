package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/audit"
	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// handleGuardAudit 는 GET /api/v1/guard/audit?range=&decision=&type= (가드레일 증적 뷰 4-3).
func (s *Server) handleGuardAudit(w http.ResponseWriter, r *http.Request) {
	rng := domain.ParseRange(r.URL.Query().Get("range"))
	decision := r.URL.Query().Get("decision")
	gtype := r.URL.Query().Get("type")

	if s.audit == nil || !s.audit.Enabled() {
		httpx.JSON(w, http.StatusOK, domain.GuardAuditReport{
			Range:       rng,
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
			Rows:        []domain.GuardAuditRow{},
			Source:      "unavailable",
		})
		return
	}
	rep, err := s.audit.Query(r.Context(), rng, decision, gtype)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "증적 조회 실패: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, rep)
}

// handleGuardClassify 는 POST /api/v1/guard/classify {text} (분류 테스트 — 프록시/증적 없음).
// 가드레일 정책 테스트·한국어 PII 탐지 PoC 데모용.
func (s *Server) handleGuardClassify(w http.ResponseWriter, r *http.Request) {
	if s.guard == nil || !s.guard.Enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "가드레일 미구성 (FABRIX_SR_URL)")
		return
	}
	var in struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&in); err != nil || in.Text == "" {
		httpx.Error(w, http.StatusBadRequest, "text 는 필수입니다")
		return
	}
	httpx.JSON(w, http.StatusOK, s.guard.Classify(r.Context(), in.Text))
}

// handleGetPolicy 는 GET /api/v1/guard/policy (정책 카탈로그 #12).
func (s *Server) handleGetPolicy(w http.ResponseWriter, r *http.Request) {
	if s.guard == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "가드레일 미구성")
		return
	}
	httpx.JSON(w, http.StatusOK, s.guard.Policy())
}

// handleSetPolicy 는 PUT /api/v1/guard/policy (정책 토글/동작 변경 #12).
func (s *Server) handleSetPolicy(w http.ResponseWriter, r *http.Request) {
	if s.guard == nil || !s.guard.Enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "가드레일 미구성 (FABRIX_SR_URL)")
		return
	}
	var p domain.GuardPolicy
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&p); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 정책 본문")
		return
	}
	s.guard.SetPolicy(p)
	httpx.JSON(w, http.StatusOK, s.guard.Policy())
}

// handleGuardStatus 는 GET /api/v1/guard/status (가드레일/증적 활성 상태 — UI 안내용).
func (s *Server) handleGuardStatus(w http.ResponseWriter, r *http.Request) {
	enforce, policy := false, ""
	if s.guard != nil {
		enforce = s.guard.Enabled()
		policy = s.guard.PolicyVersion()
	}
	audited := s.audit != nil && s.audit.Enabled()
	wormEnabled, wormCount, wormBucket := false, 0, ""
	if s.audit != nil && s.audit.WORMEnabled() {
		wormEnabled = true
		wormCount, wormBucket = s.audit.WORMStats(r.Context())
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"enforcing":      enforce,
		"audit_enabled":  audited,
		"policy_version": policy,
		"worm_enabled":   wormEnabled,
		"worm_count":     wormCount,
		"worm_bucket":    wormBucket,
	})
}

// classifyAndAudit 는 프롬프트를 가드레일 판정하고 증적을 비동기 적재한다.
// 반환된 verdict 는 플레이그라운드 응답에 동봉된다. (핫패스 비차단)
func (s *Server) classifyAndAudit(ctx context.Context, r *http.Request, prompt, model string) domain.GuardVerdict {
	var v domain.GuardVerdict
	if s.guard != nil && s.guard.Enabled() {
		v = s.guard.Classify(ctx, prompt)
	} else {
		v = domain.GuardVerdict{Decision: domain.DecisionAllow, PolicyVer: s.policyVersion()}
	}

	if s.audit != nil && s.audit.Enabled() {
		s.audit.Enqueue(s.buildAuditRow(r, prompt, model, v))
	}
	return v
}

// buildAuditRow 는 판정 + 요청 헤더(귀속)로 증적 행을 만든다(원문/PII 비저장).
func (s *Server) buildAuditRow(r *http.Request, prompt, model string, v domain.GuardVerdict) domain.GuardAuditRow {
	piiSub := make([]string, 0, len(v.PIIEntities))
	for _, e := range v.PIIEntities {
		piiSub = append(piiSub, e.Type)
	}
	// http_status(P4-9, SIEM 표준): 차단=403(정책 거부), 통과/표시=200.
	httpStatus := 200
	if v.Decision == domain.DecisionBlocked {
		httpStatus = 403
	}
	return domain.GuardAuditRow{
		EventID:       audit.NewEventID(),
		Ts:            time.Now().UTC().Format("2006-01-02 15:04:05.000"),
		TraceID:       audit.NewEventID(),
		UserRef:       s.audit.UserRef(header(r, "x-user-id")),
		DeptID:        s.resolveDept(r),
		AppID:         headerOr(r, "x-app-id", "playground"),
		APIKeyID:      headerOr(r, "x-api-key-id", "-"),
		Model:         model,
		Decision:      v.Decision,
		GuardTypes:    v.GuardTypes,
		PIISubtypes:   piiSub,
		JBConfidence:  v.JBConfidence,
		PolicyVersion: v.PolicyVer,
		HTTPStatus:    httpStatus,
		LatencyMs:     v.LatencyMs,
	}
}

// resolveDept 는 부서를 해석한다(identity-broker #14): x-dept-id 헤더 우선,
// 없으면 x-user-id(이메일)로 사용자 디렉터리(app_user) 조회, 그래도 없으면 unknown.
func (s *Server) resolveDept(r *http.Request) string {
	if d := r.Header.Get("x-dept-id"); d != "" {
		return d
	}
	if uid := r.Header.Get("x-user-id"); uid != "" && s.store != nil {
		if dept, ok := s.store.DeptForUser(r.Context(), uid); ok {
			return dept
		}
	}
	return "unknown"
}

func (s *Server) policyVersion() string {
	if s.guard != nil {
		return s.guard.PolicyVersion()
	}
	return "v1"
}

func header(r *http.Request, k string) string { return r.Header.Get(k) }

func headerOr(r *http.Request, k, def string) string {
	if v := r.Header.Get(k); v != "" {
		return v
	}
	return def
}
