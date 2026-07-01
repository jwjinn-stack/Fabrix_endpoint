package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/alerting"
	"github.com/maymust/fabrix-endpoint/internal/alertrules"
	"github.com/maymust/fabrix-endpoint/internal/capability"
	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/mockstore"
)

// stubDashboard 는 metricSnapshot 이 읽을 overview 를 고정값으로 제공한다.
type stubDashboard struct{ ov domain.DashboardOverview }

func (d stubDashboard) Overview(context.Context, domain.TimeRange) (domain.DashboardOverview, error) {
	return d.ov, nil
}
func (d stubDashboard) Timeseries(context.Context, domain.TimeRange) (domain.Timeseries, error) {
	return domain.Timeseries{}, nil
}
func (d stubDashboard) Usage(context.Context, domain.TimeRange) (domain.UsageReport, error) {
	return domain.UsageReport{}, nil
}

func newRuleTestServer(t *testing.T, ov domain.DashboardOverview) *Server {
	t.Helper()
	return &Server{
		dashboard: stubDashboard{ov: ov},
		store:     mockstore.New(),
		alertEval: alertrules.NewEvaluator(),
		alerts:    alerting.NewDispatcher(true, "salt"),
	}
}

func mustSetWebhook(t *testing.T, d *alerting.Dispatcher, url string) {
	t.Helper()
	d.SetWebhookUncheckedForTest(url)
}

// waitFor 는 비동기 발송(go)이 webhook 에 1회 도달할 때까지 짧게 대기한다.
func waitFor(t *testing.T, hits *int32) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if atomic.LoadInt32(hits) > 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("webhook 발송이 도달하지 않음(타임아웃)")
}

// 룰 생성: 입력 화이트리스트 검증 통과 + 저장 + 목록 반영.
func TestCreateAlertRule(t *testing.T) {
	s := newRuleTestServer(t, domain.DashboardOverview{})
	body := `{"name":"에러율","metric":"error_rate","op":"gt","alert_threshold":0.05,"window":"5m","severity":"critical","enabled":true}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/alerts/rules", strings.NewReader(body))
	rec := httptest.NewRecorder()
	s.handleCreateAlertRule(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out domain.AlertRule
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.ID == "" || out.Metric != domain.MetricErrorRate {
		t.Fatalf("생성 결과 이상: %+v", out)
	}
}

// 잘못된 metric 은 화이트리스트에서 거부(400).
func TestCreateAlertRule_RejectsBadMetric(t *testing.T) {
	s := newRuleTestServer(t, domain.DashboardOverview{})
	body := `{"name":"x","metric":"cpu_temp","op":"gt","alert_threshold":1,"window":"5m","severity":"info","enabled":true}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/alerts/rules", strings.NewReader(body))
	rec := httptest.NewRecorder()
	s.handleCreateAlertRule(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad metric 거부(400) 기대, got %d", rec.Code)
	}
}

// 비율 임계 범위(0..1) 밖이면 거부.
func TestCreateAlertRule_RejectsOutOfRangeRatio(t *testing.T) {
	s := newRuleTestServer(t, domain.DashboardOverview{})
	body := `{"name":"x","metric":"error_rate","op":"gt","alert_threshold":5,"window":"5m","severity":"info","enabled":true}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/alerts/rules", strings.NewReader(body))
	rec := httptest.NewRecorder()
	s.handleCreateAlertRule(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("범위 밖 비율 거부 기대, got %d", rec.Code)
	}
}

// observe 프로파일은 write 라우트가 미등록(404) → 읽기전용.
func TestObserveWriteRoutesNotRegistered(t *testing.T) {
	caps := capability.Resolve("observe", "")
	s := &Server{
		dashboard: stubDashboard{},
		store:     mockstore.New(),
		alertEval: alertrules.NewEvaluator(),
		alerts:    alerting.NewDispatcher(false, "salt"),
		caps:      caps,
	}
	h := s.Handler()

	// observe 는 write 핸들러가 미등록 → 라우트가 없으면 404, 동일 경로에 read(GET)만 있으면
	// 405(Method Not Allowed). 어느 쪽이든 변경은 차단된다(핸들러 미도달이 핵심).
	for _, m := range []struct{ method, path string }{
		{http.MethodPost, "/api/v1/alerts/rules"},
		{http.MethodPut, "/api/v1/alerts/rules/rule_x"},
		{http.MethodDelete, "/api/v1/alerts/rules/rule_x"},
	} {
		req := httptest.NewRequest(m.method, m.path, strings.NewReader("{}"))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("observe %s %s 는 차단(404/405) 기대, got %d", m.method, m.path, rec.Code)
		}
	}
	// 목록(GET)은 observe 에서도 등록(읽기전용 노출) — Dashboard cap.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/alerts/rules", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("observe GET rules 는 200 기대, got %d", rec.Code)
	}
}

// EvaluateRules: 에러율이 임계를 넘으면 EventMetricBreached 가 IMP-15 디스패처(webhook)로 간다.
func TestEvaluateRules_DispatchesMetricBreached(t *testing.T) {
	var hits int32
	var mu sync.Mutex
	var gotEvent, gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var e alerting.Event
		_ = json.NewDecoder(r.Body).Decode(&e)
		mu.Lock()
		gotEvent, gotToken = e.Event, e.Token
		mu.Unlock()
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// success_rate=0.5 → error_rate=0.5 > 0.05 → 발화. QPS>0 으로 HasData.
	ov := domain.DashboardOverview{Traffic: domain.TrafficCard{QPS: 10, SuccessRate: 0.5}}
	s := newRuleTestServer(t, ov)
	// 룰 store 를 에러율 룰 1개만 남기게 직접 구성(시드 + 새 룰). 발송 채널은 unchecked(httptest=127.0.0.1).
	mustSetWebhook(t, s.alerts, srv.URL)

	rs := s.store.(AlertRuleStore)
	_, _ = rs.CreateAlertRule(context.Background(), domain.AlertRule{
		Name: "에러율", Metric: domain.MetricErrorRate, Op: domain.OpGT,
		AlertThreshold: 0.05, Window: domain.Window5m, Severity: "critical", Enabled: true,
	})

	s.EvaluateRules(context.Background())
	waitFor(t, &hits)

	mu.Lock()
	defer mu.Unlock()
	if gotEvent != alerting.EventMetricBreached {
		t.Errorf("event=%q want metric_breached", gotEvent)
	}
	// 페이로드 토큰은 룰 식별자(rule_*)여야 하고 평문 키/PII 없음.
	if !strings.HasPrefix(gotToken, "rule_") {
		t.Errorf("token=%q — 룰 식별자(rule_*) 기대(평문 키/PII 금지)", gotToken)
	}
}

// preview: metric×window 의 현재 값을 돌려준다(신뢰 UX).
func TestAlertRulePreview(t *testing.T) {
	ov := domain.DashboardOverview{Quality: domain.QualityCard{TTFTp95ms: 321}}
	s := newRuleTestServer(t, ov)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/alerts/rules/preview?metric=ttft_p95&window=1h", nil)
	rec := httptest.NewRecorder()
	s.handleAlertRulePreview(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	var out struct {
		Value   float64 `json:"value"`
		HasData bool    `json:"has_data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Value != 321 || !out.HasData {
		t.Errorf("preview value=%v has_data=%v want 321/true", out.Value, out.HasData)
	}
}
