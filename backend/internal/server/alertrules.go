package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/alerting"
	"github.com/maymust/fabrix-endpoint/internal/alertrules"
	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// 지표 기반 알림 룰(IMP-36). latency p95·error rate·guard block rate 임계 알림.
//
// 신규 data path 없음 — 평가는 overview(가 이미 산출하는 지표)에서 MetricSnapshot 을 뽑아 쓴다.
// 아웃바운드 발송은 기존 IMP-15 디스패처(alerting.Dispatcher)를 재사용한다(새 SSRF 표면·채널 없음).
//
// 게이트: 목록/조회/preview 는 Dashboard read cap, 생성/변경/삭제는 Credentials(=manage) cap.
// observe 는 write 라우트가 미등록(404) → 읽기전용.

func (s *Server) alertRuleStore() (AlertRuleStore, bool) {
	if s.store == nil {
		return nil, false
	}
	rs, ok := s.store.(AlertRuleStore)
	return rs, ok
}

// metricSnapshot 은 현재 overview 산출에서 룰 지표 1개의 스냅샷을 뽑는다(신규 data path 없음).
// HasData=false 면 빈/저샘플 window(NO_DATA 게이트) — 조용한 발화 방지.
func (s *Server) metricSnapshot(ctx context.Context, rule domain.AlertRule) alertrules.MetricSnapshot {
	rng := windowToRange(rule.Window)
	ov, err := s.dashboard.Overview(ctx, rng)
	if err != nil {
		return alertrules.MetricSnapshot{HasData: false}
	}
	switch rule.Metric {
	case domain.MetricTTFTp95:
		return alertrules.MetricSnapshot{Value: ov.Quality.TTFTp95ms, HasData: ov.Quality.TTFTp95ms > 0}
	case domain.MetricLatencyAvg:
		return alertrules.MetricSnapshot{Value: ov.Latency.E2Ep95ms, HasData: ov.Latency.E2Ep95ms > 0}
	case domain.MetricErrorRate:
		// success_rate 가 산출됐을 때만 데이터 있음(빈 window 면 0 으로 조용히 발화 금지).
		hasData := ov.Traffic.QPS > 0 || ov.Traffic.SuccessRate > 0
		return alertrules.MetricSnapshot{Value: clamp01(1 - ov.Traffic.SuccessRate), HasData: hasData}
	case domain.MetricBlockRate:
		// 차단율 = blocked / (성공 추정 + blocked). 트래픽이 0 이면 데이터 없음.
		total := ov.Guardrail.Blocked
		hasData := ov.Traffic.QPS > 0 || total > 0
		var rate float64
		if total > 0 || ov.Traffic.QPS > 0 {
			// 차단 건수 자체를 분율 대신 카운트 기반으로도 쓸 수 있으나 phase1 은 단순 비율 근사.
			denom := float64(total) + ov.Traffic.QPS*60 // 대략 1분 요청 수 근사
			if denom > 0 {
				rate = clamp01(float64(total) / denom)
			}
		}
		return alertrules.MetricSnapshot{Value: rate, HasData: hasData}
	case domain.MetricThroughput:
		return alertrules.MetricSnapshot{Value: ov.Traffic.QPS, HasData: true}
	case domain.MetricCount:
		return alertrules.MetricSnapshot{Value: float64(ov.Guardrail.Blocked), HasData: true}
	}
	return alertrules.MetricSnapshot{HasData: false}
}

func windowToRange(w domain.AlertWindow) domain.TimeRange {
	switch w {
	case domain.Window1h:
		return domain.Range1h
	case domain.Window1d:
		return domain.Range24h
	default: // 5m → 가장 짧은 가용 range(1h) 로 근사(별도 5분 산출 경로 신설 안 함)
		return domain.Range1h
	}
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// StartRuleEvaluator 는 주기적으로 EvaluateRules 를 돌리는 백그라운드 루프를 시작한다.
// ctx 종료 시 정지. 평가는 비차단(디스패처 go 발송)이므로 hot path 영향 없음.
func (s *Server) StartRuleEvaluator(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.EvaluateRules(ctx)
			}
		}
	}()
}

// EvaluateRules 는 등록된 모든 룰을 1회 평가하고, 발화/복구를 IMP-15 디스패처로 보낸다.
// 외부 스케줄러(또는 테스트)가 호출한다. 발송은 비차단(디스패처 go).
func (s *Server) EvaluateRules(ctx context.Context) {
	rs, ok := s.alertRuleStore()
	if !ok {
		return
	}
	rules, err := rs.ListAlertRules(ctx)
	if err != nil {
		return
	}
	for _, rule := range rules {
		snap := s.metricSnapshot(ctx, rule)
		_, fire := s.alertEval.Evaluate(rule, snap, nowTime())
		if fire == nil {
			continue
		}
		s.dispatchMetricFire(rule, fire)
	}
}

// dispatchMetricFire 는 평가 발화/복구를 IMP-15 디스패처로 보낸다(평문 키/PII 미포함).
func (s *Server) dispatchMetricFire(rule domain.AlertRule, fire *alertrules.FireDecision) {
	if s.alerts == nil {
		return
	}
	event := alerting.EventMetricBreached
	msg := alertRuleMessage(rule, fire)
	s.alerts.DispatchMetric(rule.ID, alerting.Event{
		Event:        event,
		EventGroup:   "metric", // 키 식별자 불필요 — 룰 ID 만(디스패처가 token 으로 치환)
		EventMessage: msg,
	}, fire.Renotify)
}

func alertRuleMessage(rule domain.AlertRule, fire *alertrules.FireDecision) string {
	switch fire.Kind {
	case "recover":
		return "알림 룰 복구: " + rule.Name
	case "warn":
		return "알림 룰 경고: " + rule.Name
	default:
		return "알림 룰 발화: " + rule.Name
	}
}

// handleListAlertRules 는 GET /api/v1/alerts/rules — 룰 목록 + 현재 평가 상태(표시용).
func (s *Server) handleListAlertRules(w http.ResponseWriter, r *http.Request) {
	rs, ok := s.alertRuleStore()
	if !ok {
		httpx.JSON(w, http.StatusOK, map[string]any{"rules": []domain.AlertRule{}, "metrics": domain.AlertMetricCatalog})
		return
	}
	rules, err := rs.ListAlertRules(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "알림 룰 조회 실패")
		return
	}
	for i := range rules {
		rules[i].State = s.alertEval.State(rules[i].ID)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"rules":   rules,
		"metrics": domain.AlertMetricCatalog,
		"enabled": s.alerts.Enabled(), // 발송 가능(manage) 여부 — UI 안내용
	})
}

// handleAlertRulePreview 는 GET /api/v1/alerts/rules/preview?metric=&window= — 현재 라이브 값
// (신뢰 UX: 룰 생성 전 "지금 값"을 보여준다). 읽기 cap.
func (s *Server) handleAlertRulePreview(w http.ResponseWriter, r *http.Request) {
	metric := domain.AlertMetric(r.URL.Query().Get("metric"))
	window := domain.AlertWindow(r.URL.Query().Get("window"))
	probe := domain.AlertRule{Metric: metric, Window: window, Op: domain.OpGT, Severity: "info", AlertThreshold: 0}
	// metric/window 화이트리스트 검증(범위는 무시 — 0 임계).
	if !validMetric(metric) || !validWindow(window) {
		httpx.Error(w, http.StatusBadRequest, "지원하지 않는 metric/window")
		return
	}
	snap := s.metricSnapshot(r.Context(), probe)
	httpx.JSON(w, http.StatusOK, map[string]any{
		"metric":   metric,
		"window":   window,
		"value":    snap.Value,
		"has_data": snap.HasData,
	})
}

// handleCreateAlertRule 는 POST /api/v1/alerts/rules — 룰 생성(write=manage). 입력 화이트리스트 검증.
func (s *Server) handleCreateAlertRule(w http.ResponseWriter, r *http.Request) {
	rs, ok := s.alertRuleStore()
	if !ok {
		httpx.Error(w, http.StatusServiceUnavailable, "알림 룰 스토어 미지원")
		return
	}
	rule, err := decodeRule(w, r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := rs.CreateAlertRule(r.Context(), rule)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "알림 룰 생성 실패")
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

// handleUpdateAlertRule 는 PUT /api/v1/alerts/rules/{id} — 룰 변경(write=manage).
func (s *Server) handleUpdateAlertRule(w http.ResponseWriter, r *http.Request) {
	rs, ok := s.alertRuleStore()
	if !ok {
		httpx.Error(w, http.StatusServiceUnavailable, "알림 룰 스토어 미지원")
		return
	}
	id := r.PathValue("id")
	rule, err := decodeRule(w, r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := rs.UpdateAlertRule(r.Context(), id, rule)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "알림 룰 없음")
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

// handleDeleteAlertRule 는 DELETE /api/v1/alerts/rules/{id} — 룰 삭제(write=manage).
func (s *Server) handleDeleteAlertRule(w http.ResponseWriter, r *http.Request) {
	rs, ok := s.alertRuleStore()
	if !ok {
		httpx.Error(w, http.StatusServiceUnavailable, "알림 룰 스토어 미지원")
		return
	}
	id := r.PathValue("id")
	if err := rs.DeleteAlertRule(r.Context(), id); err != nil {
		httpx.Error(w, http.StatusNotFound, "알림 룰 없음")
		return
	}
	s.alertEval.Forget(id)
	w.WriteHeader(http.StatusNoContent)
}

// decodeRule 은 본문을 bounded 디코드 + 화이트리스트 검증한다(평가 상태 필드는 무시).
func decodeRule(w http.ResponseWriter, r *http.Request) (domain.AlertRule, error) {
	var rule domain.AlertRule
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&rule); err != nil {
		return domain.AlertRule{}, errBadBody
	}
	// 입력으로 들어온 평가 상태 필드는 신뢰하지 않는다(서버가 보유).
	rule.State, rule.LastValue, rule.LastEvalAt, rule.CreatedAt = "", nil, "", ""
	if err := rule.Validate(); err != nil {
		return domain.AlertRule{}, err
	}
	return rule, nil
}

var errBadBody = errBadRequest("잘못된 요청 본문")

type errBadRequest string

func (e errBadRequest) Error() string { return string(e) }

func validMetric(m domain.AlertMetric) bool {
	for _, c := range domain.AlertMetricCatalog {
		if c.Key == m {
			return true
		}
	}
	return false
}

func validWindow(window domain.AlertWindow) bool {
	return window == domain.Window5m || window == domain.Window1h || window == domain.Window1d
}
