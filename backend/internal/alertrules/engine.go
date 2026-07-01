// Package alertrules 는 지표 기반 알림 룰(IMP-36)의 평가 상태머신을 구현한다.
//
// 신규 data path 를 만들지 않는다 — 호출자가 overview/timeseries 산출에서 추출한 MetricSnapshot 을
// 넘기면, 룰별 상태머신(OK→WARNING→ALERT→NO_DATA)을 전이하고 발화/복구 결정을 돌려준다.
// 아웃바운드 발송은 호출자가 기존 IMP-15 디스패처로 한다(이 패키지는 발송 안 함).
//
// Datadog anti-flapping 을 기본 내장:
//   - NO_DATA 게이트: 빈/저샘플 window 는 noDataMode 에 따라 처리(기본 NO_DATA → 조용한 발화 방지).
//   - 히스테리시스: recoveryWindow 만큼 연속 clear 돼야 복구(진동 방지).
//   - renotify: elevated 지속 시 RenotifyMin 간격으로 재통지 결정만 내린다(dedup 은 디스패처).
package alertrules

import (
	"sync"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// MetricSnapshot 은 한 시점의 지표 값. HasData=false 면 빈/저샘플 window(NO_DATA 게이트).
type MetricSnapshot struct {
	Value   float64
	HasData bool
}

// FireDecision 은 평가 결과 발생한 발송 결정. nil 이면 발송 없음(조용함).
type FireDecision struct {
	Kind     string // "alert" | "warn" | "recover"
	Renotify bool   // elevated 지속 재통지(디스패처 dedup 우회)
	Value    float64
}

// ruleRuntime 은 룰별 평가 런타임 상태(상태머신 + 연속 카운터 + 마지막 통지 시각).
type ruleRuntime struct {
	state        domain.AlertState
	clearStreak  int       // 연속 clear 횟수(복구 히스테리시스)
	lastNotified time.Time // 마지막 발송 시각(renotify 기준)
	elevatedKind string    // 현재 elevated 종류("alert"|"warn") — renotify 시 동일 종류로
}

// Evaluator 는 룰 ID 별 런타임 상태를 보관한다(동시성 안전).
type Evaluator struct {
	mu sync.Mutex
	rt map[string]*ruleRuntime
}

// NewEvaluator 는 빈 evaluator 를 만든다.
func NewEvaluator() *Evaluator {
	return &Evaluator{rt: map[string]*ruleRuntime{}}
}

// breached 는 op 기준으로 value 가 threshold 를 넘었는지 본다.
func breached(op domain.AlertOp, value, threshold float64) bool {
	switch op {
	case domain.OpGT:
		return value > threshold
	case domain.OpGTE:
		return value >= threshold
	case domain.OpLT:
		return value < threshold
	case domain.OpLTE:
		return value <= threshold
	}
	return false
}

// Evaluate 는 현재 스냅샷으로 룰 상태를 전이하고 발송 결정을 반환한다.
//
// 반환: next(전이된 상태), fire(발송 결정 또는 nil). disabled 룰은 PAUSED 로 두고 발송 없음.
func (e *Evaluator) Evaluate(rule domain.AlertRule, snap MetricSnapshot, now time.Time) (domain.AlertState, *FireDecision) {
	e.mu.Lock()
	defer e.mu.Unlock()

	rt := e.rt[rule.ID]
	if rt == nil {
		rt = &ruleRuntime{state: domain.StateOK}
		e.rt[rule.ID] = rt
	}

	if !rule.Enabled {
		rt.state = domain.StatePaused
		rt.clearStreak = 0
		return domain.StatePaused, nil
	}

	// ── NO_DATA 게이트: 빈/저샘플 window 의 조용한 발화 방지 ──
	if !snap.HasData {
		switch noDataMode(rule) {
		case domain.NoDataTreatZero:
			snap = MetricSnapshot{Value: 0, HasData: true} // 명시 선택 시에만 0 으로 평가
		case domain.NoDataHoldPrev:
			return rt.state, nil // 직전 상태 유지, 발송 없음
		default: // NoDataNoData(기본): NO_DATA 로 전이, 발송 없음(거짓 발화 차단)
			rt.state = domain.StateNoData
			rt.clearStreak = 0
			return domain.StateNoData, nil
		}
	}

	// NO_DATA 에서 데이터가 돌아오면 일단 OK 기준선으로 리셋(이전 elevated 기억 안 함).
	if rt.state == domain.StateNoData {
		rt.state = domain.StateOK
		rt.clearStreak = 0
	}

	alertHit := breached(rule.Op, snap.Value, rule.AlertThreshold)
	warnHit := rule.WarnThreshold != nil && breached(rule.Op, snap.Value, *rule.WarnThreshold)

	// 목표 elevated 종류 결정(alert 우선).
	target := "" // "" = clear
	if alertHit {
		target = "alert"
	} else if warnHit {
		target = "warn"
	}

	if target == "" {
		// clear 후보 — 히스테리시스: recoveryWindow 만큼 연속 clear 돼야 복구.
		if rt.state == domain.StateOK {
			return domain.StateOK, nil
		}
		rt.clearStreak++
		need := rule.RecoveryWindow
		if need < 1 {
			need = 1
		}
		if rt.clearStreak >= need {
			rt.state = domain.StateOK
			rt.clearStreak = 0
			rt.elevatedKind = ""
			rt.lastNotified = now
			return domain.StateOK, &FireDecision{Kind: "recover", Value: snap.Value}
		}
		// 아직 복구 미확정 — 상태 유지, 발송 없음(진동 방지).
		return rt.state, nil
	}

	// elevated(alert/warn) — clear streak 리셋.
	rt.clearStreak = 0
	nextState := domain.StateAlert
	if target == "warn" {
		nextState = domain.StateWarning
	}

	// 상태/종류가 바뀌면(승급 포함) 즉시 발화.
	if rt.state != nextState || rt.elevatedKind != target {
		rt.state = nextState
		rt.elevatedKind = target
		rt.lastNotified = now
		return nextState, &FireDecision{Kind: target, Value: snap.Value}
	}

	// 동일 elevated 지속 — renotify 간격 경과 시에만 재통지.
	if rule.RenotifyMin > 0 {
		interval := time.Duration(rule.RenotifyMin) * time.Minute
		if now.Sub(rt.lastNotified) >= interval {
			rt.lastNotified = now
			return nextState, &FireDecision{Kind: target, Renotify: true, Value: snap.Value}
		}
	}
	return nextState, nil
}

// State 는 룰의 현재 평가 상태를 반환한다(표시용). 미평가는 OK.
func (e *Evaluator) State(ruleID string) domain.AlertState {
	e.mu.Lock()
	defer e.mu.Unlock()
	if rt := e.rt[ruleID]; rt != nil {
		return rt.state
	}
	return domain.StateOK
}

// Forget 은 삭제된 룰의 런타임 상태를 제거한다(메모리 누수 방지).
func (e *Evaluator) Forget(ruleID string) {
	e.mu.Lock()
	delete(e.rt, ruleID)
	e.mu.Unlock()
}

func noDataMode(r domain.AlertRule) domain.NoDataMode {
	if r.NoDataMode == "" {
		return domain.NoDataNoData
	}
	return r.NoDataMode
}
