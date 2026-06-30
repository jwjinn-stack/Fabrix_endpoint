package quota

import (
	"sync"
	"testing"
)

// TestAddTokensWithBudget_ThresholdFiresOnce — 임계 교차는 같은 날 1회만 발화.
func TestAddTokensWithBudget_ThresholdFiresOnce(t *testing.T) {
	l := New()
	const key = "k1"
	const tpd int64 = 1000
	l.SetAlertThreshold(key, 0.8) // 800 토큰에서 임계

	var mu sync.Mutex
	var fires []string
	l.OnThresholdCross(func(_, kind string, _ float64, _ int64) {
		mu.Lock()
		fires = append(fires, kind)
		mu.Unlock()
	})

	l.AddTokensWithBudget(key, 700, tpd) // 700 — 임계 미달, 발화 없음
	l.AddTokensWithBudget(key, 200, tpd) // 900 — 임계(800) 교차 → threshold 1회
	l.AddTokensWithBudget(key, 50, tpd)  // 950 — 임계 이미 발화, 재발화 없음

	mu.Lock()
	defer mu.Unlock()
	if len(fires) != 1 || fires[0] != "threshold" {
		t.Fatalf("임계 교차는 1회(threshold)여야 함, got %v", fires)
	}
}

// TestAddTokensWithBudget_BudgetCross — 예산(100%) 교차도 1회 발화.
func TestAddTokensWithBudget_BudgetCross(t *testing.T) {
	l := New()
	const key = "k2"
	const tpd int64 = 1000
	l.SetAlertThreshold(key, 0.8)

	var mu sync.Mutex
	got := map[string]int{}
	l.OnThresholdCross(func(_, kind string, _ float64, _ int64) {
		mu.Lock()
		got[kind]++
		mu.Unlock()
	})

	l.AddTokensWithBudget(key, 900, tpd)  // 900 — threshold 교차
	l.AddTokensWithBudget(key, 200, tpd)  // 1100 — budget(1000) 교차
	l.AddTokensWithBudget(key, 100, tpd)  // 1200 — 둘 다 이미 발화

	mu.Lock()
	defer mu.Unlock()
	if got["threshold"] != 1 || got["budget"] != 1 {
		t.Fatalf("threshold·budget 각 1회여야 함, got %v", got)
	}
}

// TestAddTokensWithBudget_NoTPDNoFire — tpd<=0(무제한)이면 발화하지 않음.
func TestAddTokensWithBudget_NoTPDNoFire(t *testing.T) {
	l := New()
	var fired bool
	l.OnThresholdCross(func(_, _ string, _ float64, _ int64) { fired = true })
	l.AddTokensWithBudget("k3", 100000, 0)
	if fired {
		t.Error("tpd=0(무제한)에서는 발화하면 안 됨")
	}
	// 적립 자체는 유지(게이지용).
	if l.TokensToday("k3") != 100000 {
		t.Errorf("토큰 적립은 유지되어야 함, got %d", l.TokensToday("k3"))
	}
}
