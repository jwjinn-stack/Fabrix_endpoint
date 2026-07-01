// Package incident 은 알림 인시던트 라이프사이클(OnCall/PagerDuty 모델)을 인메모리로 구현한다.
//
// 기존 alerting.SendRecord ring 은 *발송* 이력일 뿐 인시던트 상태가 아니다. 여기서는 동일
// dedupKey(ruleRef+scope) 신호를 하나의 인시던트로 group-merge 하고, 상태 전이(triggered →
// acked → resolved, 또는 snoozed)와 상태전이 이력(audit)을 보존한다.
//
//   - group-merge   : 동일 dedupKey 의 open 인시던트를 흡수(count++, lastSeen 갱신, occurrence push).
//                     count++ 단순 증가가 아니라 firstSeen/lastSeen·최근 N occurrence 도 함께 유지.
//   - snooze         : 단순 mute 가 아니라 silencedUntil 후 자동 re-fire(만료 시 triggered 복귀).
//   - auto-resolve   : 동일 dedupKey 정상복귀 신호로 매칭 인시던트 auto-resolve.
//
// seam: server 핸들러는 *Store 에만 의존한다(DataStore/mockstore 와 동일 패턴). 운영 연동 시
// quota/guard 교차 hook 이 Observe/AutoResolve 를 호출하도록 바꾸면 되고, 모델·API 는 불변이다.
package incident

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"sync"
	"time"
)

// State 는 인시던트 상태. open = triggered|acked|snoozed, closed = resolved.
type State string

const (
	StateTriggered State = "triggered"
	StateAcked     State = "acked"
	StateResolved  State = "resolved"
	StateSnoozed   State = "snoozed"
)

// occurrenceCap 은 인시던트당 보존하는 최근 occurrence 타임스탬프 상한.
const occurrenceCap = 20

// MaxSnooze 는 snooze 최대 기간(re-fire 까지). 핸들러 입력 검증의 단일 출처.
const MaxSnooze = 24 * time.Hour

// ErrNotFound 는 존재하지 않는 인시던트 id 에 대한 작업 시 반환.
var ErrNotFound = errors.New("인시던트를 찾을 수 없습니다")

// Occurrence 는 발생 1회(group-merge 시 push, 최근 occurrenceCap 개 보존).
type Occurrence struct {
	Ts string `json:"ts"` // RFC3339 UTC
}

// AuditEntry 는 상태전이 이력 1건(누가·언제·무엇을).
type AuditEntry struct {
	Ts   string `json:"ts"`
	From State  `json:"from"`
	To   State  `json:"to"`
	By   string `json:"by"`
	Note string `json:"note,omitempty"`
}

// Incident 는 group-merge 된 단일 인시던트. JSON 은 프론트 인박스와 1:1.
type Incident struct {
	ID            string       `json:"id"`
	DedupKey      string       `json:"dedup_key"`
	Severity      string       `json:"severity"` // info|warning|critical
	Title         string       `json:"title"`
	State         State        `json:"state"`
	FirstSeen     string       `json:"first_seen"`
	LastSeen      string       `json:"last_seen"`
	Count         int          `json:"count"`
	Occurrences   []Occurrence `json:"occurrences"`
	AckedBy       string       `json:"acked_by,omitempty"`
	ResolvedBy    string       `json:"resolved_by,omitempty"`
	SilencedUntil string       `json:"silenced_until,omitempty"` // snooze 만료(RFC3339)
	Note          string       `json:"note,omitempty"`
	Audit         []AuditEntry `json:"audit,omitempty"`
}

// open 은 아직 닫히지 않은(처리 가능한) 상태인지.
func (i *Incident) open() bool { return i.State != StateResolved }

// Store 는 인메모리 인시던트 저장소(seam). now 주입으로 snooze 만료를 결정적 테스트한다.
type Store struct {
	mu    sync.Mutex
	byID  map[string]*Incident // id → 인시던트
	order []string             // 삽입 순서(안정 정렬 보조)
	now   func() time.Time
}

// NewStore 는 빈 인메모리 스토어를 만든다.
func NewStore() *Store {
	return &Store{byID: map[string]*Incident{}, now: func() time.Time { return time.Now().UTC() }}
}

// SetNow 는 시간 소스를 교체한다(테스트 전용 — snooze 만료/re-fire 결정성).
func (s *Store) SetNow(fn func() time.Time) {
	s.mu.Lock()
	s.now = fn
	s.mu.Unlock()
}

// idFor 는 dedupKey 를 안정적 인시던트 id 로 해시한다(같은 dedupKey → 같은 id → 재오픈 흡수).
func idFor(dedupKey string) string {
	sum := sha256.Sum256([]byte(dedupKey))
	return "inc_" + hex.EncodeToString(sum[:])[:12]
}

// Observe 는 발생 신호를 흡수한다(group-merge).
//
//	- 동일 dedupKey 인시던트가 있으면: count++, lastSeen 갱신, occurrence push.
//	  resolved/snoozed 였다면 triggered 로 재오픈(중복 폭증을 새 인시던트로 쪼개지 않는다).
//	- 없으면: 새 인시던트(triggered) 생성.
//
// 반환은 영향받은 인시던트의 사본.
func (s *Store) Observe(dedupKey, severity, title string) Incident {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tickLocked()
	now := s.now().UTC().Format(time.RFC3339)
	id := idFor(dedupKey)
	inc, ok := s.byID[id]
	if !ok {
		inc = &Incident{
			ID: id, DedupKey: dedupKey, Severity: severity, Title: title,
			State: StateTriggered, FirstSeen: now, LastSeen: now, Count: 1,
			Occurrences: []Occurrence{{Ts: now}},
		}
		s.byID[id] = inc
		s.order = append(s.order, id)
		return *inc
	}
	// 기존 인시던트 흡수. 닫혔거나 snooze 중이면 다시 trigger 로 복귀(재발).
	prev := inc.State
	inc.Count++
	inc.LastSeen = now
	if severity != "" {
		inc.Severity = severity
	}
	if title != "" {
		inc.Title = title
	}
	inc.Occurrences = pushOccurrence(inc.Occurrences, Occurrence{Ts: now})
	if prev == StateResolved || prev == StateSnoozed {
		inc.State = StateTriggered
		inc.SilencedUntil = ""
		inc.ResolvedBy = ""
		note := "재발(group-merge)"
		if prev == StateSnoozed {
			note = "snooze 중 재발"
		}
		inc.Audit = append(inc.Audit, AuditEntry{Ts: now, From: prev, To: StateTriggered, By: "system", Note: note})
	}
	return *inc
}

// AutoResolve 는 동일 dedupKey 의 open 인시던트를 정상복귀 신호로 resolved 처리한다.
// 매칭 open 인시던트가 없으면 (zero, false).
func (s *Store) AutoResolve(dedupKey string) (Incident, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	inc, ok := s.byID[idFor(dedupKey)]
	if !ok || !inc.open() {
		return Incident{}, false
	}
	now := s.now().UTC().Format(time.RFC3339)
	prev := inc.State
	inc.State = StateResolved
	inc.ResolvedBy = "auto"
	inc.SilencedUntil = ""
	inc.LastSeen = now
	inc.Audit = append(inc.Audit, AuditEntry{Ts: now, From: prev, To: StateResolved, By: "auto", Note: "정상 복귀 신호 자동 해소"})
	return *inc, true
}

// Ack 는 인시던트를 처리중(acked)으로 표시한다. open 인시던트만.
func (s *Store) Ack(id, by string) (Incident, error) {
	return s.transition(id, StateAcked, by, "")
}

// Resolve 는 인시던트를 수동 해소한다.
func (s *Store) Resolve(id, by string) (Incident, error) {
	return s.transition(id, StateResolved, by, "")
}

// Snooze 는 인시던트를 d 만큼 mute 한다(만료 시 자동 re-fire). d 는 (0, MaxSnooze].
func (s *Store) Snooze(id string, d time.Duration, by string) (Incident, error) {
	if d <= 0 || d > MaxSnooze {
		return Incident{}, errors.New("snooze 기간은 1분~24시간 범위여야 합니다")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tickLocked()
	inc, ok := s.byID[id]
	if !ok {
		return Incident{}, ErrNotFound
	}
	if inc.State == StateResolved {
		return Incident{}, errors.New("이미 해소된 인시던트는 snooze 할 수 없습니다")
	}
	now := s.now().UTC()
	prev := inc.State
	inc.State = StateSnoozed
	inc.SilencedUntil = now.Add(d).Format(time.RFC3339)
	inc.LastSeen = now.Format(time.RFC3339)
	inc.Audit = append(inc.Audit, AuditEntry{Ts: now.Format(time.RFC3339), From: prev, To: StateSnoozed, By: by, Note: "snooze " + d.String()})
	return *inc, nil
}

// transition 은 ack/resolve 공통 상태 전이(open 인시던트만).
func (s *Store) transition(id string, to State, by, note string) (Incident, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tickLocked()
	inc, ok := s.byID[id]
	if !ok {
		return Incident{}, ErrNotFound
	}
	if !inc.open() {
		return Incident{}, errors.New("이미 해소된 인시던트입니다")
	}
	now := s.now().UTC().Format(time.RFC3339)
	prev := inc.State
	inc.State = to
	inc.LastSeen = now
	switch to {
	case StateAcked:
		inc.AckedBy = by
		inc.SilencedUntil = "" // ack 는 snooze 를 해제(다시 보이게)
	case StateResolved:
		inc.ResolvedBy = by
		inc.SilencedUntil = ""
	}
	inc.Audit = append(inc.Audit, AuditEntry{Ts: now, From: prev, To: to, By: by, Note: note})
	return *inc, nil
}

// List 는 (선택) state/severity 필터를 적용해 lastSeen 내림차순으로 사본을 반환한다.
func (s *Store) List(filterState, filterSeverity string) []Incident {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tickLocked()
	out := make([]Incident, 0, len(s.byID))
	for _, id := range s.order {
		inc := s.byID[id]
		if inc == nil {
			continue
		}
		if filterState != "" && string(inc.State) != filterState {
			continue
		}
		if filterSeverity != "" && inc.Severity != filterSeverity {
			continue
		}
		out = append(out, *inc)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastSeen > out[j].LastSeen })
	return out
}

// Counts 는 상태별 인시던트 수(전체, 필터 무관)를 반환한다(인박스 탭 배지용).
func (s *Store) Counts() map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tickLocked()
	c := map[string]int{"triggered": 0, "acked": 0, "resolved": 0, "snoozed": 0}
	for _, id := range s.order {
		if inc := s.byID[id]; inc != nil {
			c[string(inc.State)]++
		}
	}
	return c
}

// Tick 은 silencedUntil 만료된 snoozed 인시던트를 triggered 로 re-fire 한다. 반환: re-fire 개수.
func (s *Store) Tick() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.tickLocked()
}

// tickLocked 는 잠금 보유 상태에서 만료 snooze 를 re-fire 한다(모든 진입점이 lazy 호출).
func (s *Store) tickLocked() int {
	now := s.now().UTC()
	nowStr := now.Format(time.RFC3339)
	n := 0
	for _, id := range s.order {
		inc := s.byID[id]
		if inc == nil || inc.State != StateSnoozed || inc.SilencedUntil == "" {
			continue
		}
		until, err := time.Parse(time.RFC3339, inc.SilencedUntil)
		if err != nil || now.Before(until) {
			continue
		}
		inc.State = StateTriggered
		inc.SilencedUntil = ""
		inc.Audit = append(inc.Audit, AuditEntry{Ts: nowStr, From: StateSnoozed, To: StateTriggered, By: "system", Note: "snooze 만료 자동 re-fire"})
		n++
	}
	return n
}

func pushOccurrence(o []Occurrence, e Occurrence) []Occurrence {
	o = append(o, e)
	if len(o) > occurrenceCap {
		o = o[len(o)-occurrenceCap:]
	}
	return o
}
