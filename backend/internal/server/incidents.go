package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/httpx"
	"github.com/maymust/fabrix-endpoint/internal/incident"
)

// 알림 인시던트 라이프사이클(IMP-38) — OnCall/PagerDuty 모델. 인박스 조회 + ack/resolve/snooze.
//
// 게이팅(server.go 라우트 등록): 조회=Guard read, ack=incident.ack(observe 도 on),
// resolve/snooze=incident.write(=manage). 미등록이 실제 차단(observe write → 404).
//
// 보안: id 는 store 조회 키로만 쓰고 어디에도 주입하지 않는다. snooze minutes 는 1..1440 검증.
// acked_by/resolved_by 는 ctx 신원(프록시-set, 위조 가능 헤더)에서 가져와 *표시용* 으로만 쓴다.

// actor 는 상태전이 기록용 행위자 라벨(신원 없으면 "operator").
func actor(r *http.Request) string {
	if id, ok := httpx.IdentityFrom(r.Context()); ok && strings.TrimSpace(id.UserID) != "" {
		return id.UserID
	}
	return "operator"
}

// handleListIncidents 는 GET /api/v1/incidents?state=&severity= — 인박스 + 상태별 카운트.
func (s *Server) handleListIncidents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	state := normState(q.Get("state"))
	severity := normSeverity(q.Get("severity"))
	httpx.JSON(w, http.StatusOK, map[string]any{
		"incidents": s.incidents.List(state, severity),
		"counts":    s.incidents.Counts(),
	})
}

// handleAckIncident 는 POST /api/v1/incidents/{id}/ack — 인시던트를 처리중(acked)으로.
func (s *Server) handleAckIncident(w http.ResponseWriter, r *http.Request) {
	inc, err := s.incidents.Ack(r.PathValue("id"), actor(r))
	s.writeIncidentResult(w, inc, err)
}

// handleResolveIncident 는 POST /api/v1/incidents/{id}/resolve — 수동 해소.
func (s *Server) handleResolveIncident(w http.ResponseWriter, r *http.Request) {
	inc, err := s.incidents.Resolve(r.PathValue("id"), actor(r))
	s.writeIncidentResult(w, inc, err)
}

// handleSnoozeIncident 는 POST /api/v1/incidents/{id}/snooze {minutes} — silencedUntil 후 자동 re-fire.
func (s *Server) handleSnoozeIncident(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Minutes int `json:"minutes"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	// 입력 검증: 1분~24시간(=1440분). 범위 밖은 거부(주입·악용 방지·UX 명확).
	if req.Minutes < 1 || req.Minutes > 1440 {
		httpx.Error(w, http.StatusBadRequest, "snooze 시간(minutes)은 1~1440 사이여야 합니다")
		return
	}
	inc, err := s.incidents.Snooze(r.PathValue("id"), time.Duration(req.Minutes)*time.Minute, actor(r))
	s.writeIncidentResult(w, inc, err)
}

// writeIncidentResult 는 전이 결과를 직렬화한다(미존재=404, 기타 검증오류=409, 성공=200).
func (s *Server) writeIncidentResult(w http.ResponseWriter, inc incident.Incident, err error) {
	if err != nil {
		if errors.Is(err, incident.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, err.Error())
			return
		}
		httpx.Error(w, http.StatusConflict, err.Error()) // 이미 해소됨 등 상태 충돌
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"incident": inc})
}

// normState 는 state 필터를 화이트리스트로 정규화한다(알 수 없는 값은 무시 → 전체).
func normState(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "triggered", "acked", "resolved", "snoozed":
		return strings.ToLower(strings.TrimSpace(v))
	default:
		return ""
	}
}

// normSeverity 는 severity 필터를 화이트리스트로 정규화한다.
func normSeverity(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "info", "warning", "critical":
		return strings.ToLower(strings.TrimSpace(v))
	default:
		return ""
	}
}

// seedIncidents 는 mockstore 정합 결정적 seed 를 주입한다(인박스가 빈 화면이 아니게).
// 운영 연동 시 quota 임계 교차·guard 차단·엔드포인트 NotReady 신호가 Observe 를 호출하도록 교체.
func (s *Server) seedIncidents() {
	// 대표 인시던트 3건 + group-merge 시연(같은 dedupKey 재발).
	s.incidents.Observe("endpoint:qwen25-vl-7b:not-ready", "critical", "qwen25-vl-7b 엔드포인트 NotReady — 파드 기동 실패")
	s.incidents.Observe("scheduler:queue-backpressure", "warning", "대기 큐 적체 — 스케줄러 backpressure")
	s.incidents.Observe("scheduler:queue-backpressure", "warning", "대기 큐 적체 — 스케줄러 backpressure") // 재발 → count=2
	s.incidents.Observe("guard:pii-jailbreak-spike", "info", "가드레일 차단 급증 (PII·Jailbreak)")
}
