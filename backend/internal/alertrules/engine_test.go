package alertrules

import (
	"testing"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

func snap(v float64) MetricSnapshot     { return MetricSnapshot{Value: v, HasData: true} }
func noData() MetricSnapshot            { return MetricSnapshot{HasData: false} }
func ptr(v float64) *float64            { return &v }
func base() domain.AlertRule {
	return domain.AlertRule{
		ID: "r1", Name: "t", Metric: domain.MetricErrorRate, Op: domain.OpGT,
		AlertThreshold: 0.05, Window: domain.Window5m, Severity: "warning",
		NoDataMode: domain.NoDataNoData, RecoveryWindow: 2, Enabled: true,
	}
}

// 정적 임계 발화: value 가 임계를 넘으면 ALERT + fire(alert).
func TestEvaluate_StaticThresholdFires(t *testing.T) {
	e := NewEvaluator()
	now := time.Now()
	state, fire := e.Evaluate(base(), snap(0.1), now)
	if state != domain.StateAlert {
		t.Fatalf("ALERT 기대, got %s", state)
	}
	if fire == nil || fire.Kind != "alert" {
		t.Fatalf("alert fire 기대, got %+v", fire)
	}
}

// 2-tier: warn 임계만 넘으면 WARNING(fire warn), alert 임계까지 넘으면 ALERT.
func TestEvaluate_TwoTier(t *testing.T) {
	e := NewEvaluator()
	r := base()
	r.WarnThreshold = ptr(0.03)
	now := time.Now()

	_, fire := e.Evaluate(r, snap(0.04), now) // warn 만
	if fire == nil || fire.Kind != "warn" {
		t.Fatalf("warn fire 기대, got %+v", fire)
	}
	state, fire2 := e.Evaluate(r, snap(0.1), now) // 승급 → alert
	if state != domain.StateAlert || fire2 == nil || fire2.Kind != "alert" {
		t.Fatalf("alert 승급 기대, got state=%s fire=%+v", state, fire2)
	}
}

// NO_DATA 게이트: 빈 window 는 noDataMode=no_data 에서 NO_DATA + fire=nil(조용한 발화 없음).
func TestEvaluate_NoDataGateSilent(t *testing.T) {
	e := NewEvaluator()
	state, fire := e.Evaluate(base(), noData(), time.Now())
	if state != domain.StateNoData {
		t.Fatalf("NO_DATA 기대, got %s", state)
	}
	if fire != nil {
		t.Fatalf("빈 window 는 조용해야(fire=nil), got %+v", fire)
	}
}

// treat_as_zero 는 명시 선택 시에만 0 으로 평가(gt 0.05 → 발화 안 함).
func TestEvaluate_TreatAsZero(t *testing.T) {
	e := NewEvaluator()
	r := base()
	r.NoDataMode = domain.NoDataTreatZero
	state, fire := e.Evaluate(r, noData(), time.Now())
	if state != domain.StateOK || fire != nil {
		t.Fatalf("treat_as_zero 는 0 평가 → OK·무발화, got state=%s fire=%+v", state, fire)
	}
}

// recoveryWindow 히스테리시스: 1회 clear 로는 복구 안 됨, recoveryWindow 회 연속 clear 여야 OK.
func TestEvaluate_RecoveryHysteresis(t *testing.T) {
	e := NewEvaluator()
	r := base()
	r.RecoveryWindow = 2
	now := time.Now()
	e.Evaluate(r, snap(0.1), now) // ALERT

	state, fire := e.Evaluate(r, snap(0.0), now) // 1회 clear — 아직 복구 안 함
	if state != domain.StateAlert || fire != nil {
		t.Fatalf("1회 clear 는 ALERT 유지·무발화, got state=%s fire=%+v", state, fire)
	}
	state, fire = e.Evaluate(r, snap(0.0), now) // 2회 연속 clear — 복구
	if state != domain.StateOK || fire == nil || fire.Kind != "recover" {
		t.Fatalf("2회 clear 복구 기대, got state=%s fire=%+v", state, fire)
	}
}

// renotify: ALERT 지속 시 간격 경과 후 fire(renotify), 간격 내 재평가는 fire=nil.
func TestEvaluate_Renotify(t *testing.T) {
	e := NewEvaluator()
	r := base()
	r.RenotifyMin = 15
	t0 := time.Now()
	e.Evaluate(r, snap(0.1), t0) // ALERT(첫 발화)

	_, fire := e.Evaluate(r, snap(0.1), t0.Add(5*time.Minute)) // 간격 내 — 무발화
	if fire != nil {
		t.Fatalf("renotify 간격 내 무발화 기대, got %+v", fire)
	}
	_, fire = e.Evaluate(r, snap(0.1), t0.Add(20*time.Minute)) // 간격 경과 — 재통지
	if fire == nil || !fire.Renotify {
		t.Fatalf("renotify 발화 기대, got %+v", fire)
	}
}

// disabled 룰은 PAUSED + 무발화.
func TestEvaluate_DisabledPaused(t *testing.T) {
	e := NewEvaluator()
	r := base()
	r.Enabled = false
	state, fire := e.Evaluate(r, snap(0.99), time.Now())
	if state != domain.StatePaused || fire != nil {
		t.Fatalf("PAUSED·무발화 기대, got state=%s fire=%+v", state, fire)
	}
}
