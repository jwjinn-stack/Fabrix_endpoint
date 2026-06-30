package server

import (
	"encoding/json"
	"net/http"

	"github.com/maymust/fabrix-endpoint/internal/alerting"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// 아웃바운드 알림 채널 설정(IMP-15). 예산·임계 초과 시 제네릭 Webhook 으로 능동 통지.
// 라우트는 credentials cap(=manage, 민감) 게이트 안에서만 등록 → observe 는 미등록(404) + 발송 비활성.
//
// 보안: webhook URL 원문은 응답에 노출하지 않는다(configured 불리언만). SSRF 검증은 alerting 패키지.

// handleGetAlertConfig 는 GET /api/v1/alerts/config — 채널 구성 상태 + 발송 이력(원문 URL 비노출).
func (s *Server) handleGetAlertConfig(w http.ResponseWriter, _ *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"enabled":            s.alerts.Enabled(),     // profile 게이트(manage=true)
		"webhook_configured": s.alerts.WebhookConfigured(),
		"audit":              s.alerts.Audit(), // 최근 발송 이력(해시 토큰만)
	})
}

// handleSetAlertWebhook 은 PUT /api/v1/alerts/webhook — webhook URL 등록/해제(빈 문자열=해제).
// SSRF 검증(scheme 화이트리스트 + 메타데이터/루프백 차단) 통과 시에만 저장한다.
func (s *Server) handleSetAlertWebhook(w http.ResponseWriter, r *http.Request) {
	if !s.alerts.Enabled() {
		httpx.Error(w, http.StatusForbidden, "이 배포(observe)에서는 아웃바운드 통지가 비활성입니다")
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	// 검증을 먼저 돌려 경고/하드에러를 분리(저장 전에 사용자에게 안내).
	warnings, verr := alerting.ValidateWebhookURL(req.URL)
	if verr != nil {
		httpx.Error(w, http.StatusBadRequest, "Webhook URL 거부: "+verr.Error())
		return
	}
	if err := s.alerts.SetWebhook(req.URL); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Webhook URL 거부: "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"webhook_configured": s.alerts.WebhookConfigured(),
		"warnings":           warnings, // 사설망/단일 라벨 등 폐쇄망 안내(저장은 됨)
	})
}
