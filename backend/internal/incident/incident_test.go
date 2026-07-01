package incident

import (
	"testing"
	"time"
)

// fixedClock 은 결정적 now 소스(snooze 만료/re-fire 테스트).
type fixedClock struct{ t time.Time }

func (c *fixedClock) now() time.Time { return c.t }
func (c *fixedClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newClockStore(start time.Time) (*Store, *fixedClock) {
	c := &fixedClock{t: start.UTC()}
	s := NewStore()
	s.SetNow(c.now)
	return s, c
}

// 1) group-merge: 동일 dedupKey 2회 → 1건, count=2, occurrences=2, firstSeen<=lastSeen.
func TestObserve_GroupMerge(t *testing.T) {
	s, c := newClockStore(time.Date(2026, 6, 30, 9, 0, 0, 0, time.UTC))
	a := s.Observe("dk-1", "warning", "큐 적체")
	c.advance(2 * time.Minute)
	b := s.Observe("dk-1", "warning", "큐 적체")

	if a.ID != b.ID {
		t.Fatalf("동일 dedupKey 는 같은 id 여야 하는데 %s vs %s", a.ID, b.ID)
	}
	if b.Count != 2 {
		t.Errorf("count 는 2 여야 하는데 %d", b.Count)
	}
	if len(b.Occurrences) != 2 {
		t.Errorf("occurrences 2개여야 하는데 %d", len(b.Occurrences))
	}
	if b.FirstSeen >= b.LastSeen {
		t.Errorf("firstSeen(%s) < lastSeen(%s) 이어야 함", b.FirstSeen, b.LastSeen)
	}
	if got := s.List("", ""); len(got) != 1 {
		t.Errorf("인시던트는 1건이어야 하는데 %d건", len(got))
	}
}

// 2) ack 전이: triggered→Ack→acked, ackedBy 기록, audit 1건.
func TestAck_Transition(t *testing.T) {
	s, _ := newClockStore(time.Now())
	first := s.Observe("dk-ack", "critical", "엔드포인트 NotReady")
	got, err := s.Ack(first.ID, "hjkim")
	if err != nil {
		t.Fatalf("ack 실패: %v", err)
	}
	if got.State != StateAcked {
		t.Errorf("state 는 acked 여야 하는데 %s", got.State)
	}
	if got.AckedBy != "hjkim" {
		t.Errorf("ackedBy 는 hjkim 여야 하는데 %q", got.AckedBy)
	}
	if len(got.Audit) != 1 || got.Audit[0].To != StateAcked {
		t.Errorf("audit 에 acked 전이 1건이어야 하는데 %v", got.Audit)
	}
}

// 3) snooze→silencedUntil→만료 re-fire: snooze 10m → snoozed/silencedUntil set; +11m Tick → triggered.
func TestSnooze_Expiry_Refire(t *testing.T) {
	s, c := newClockStore(time.Date(2026, 6, 30, 9, 0, 0, 0, time.UTC))
	first := s.Observe("dk-snz", "warning", "큐 적체")
	sn, err := s.Snooze(first.ID, 10*time.Minute, "sychoi")
	if err != nil {
		t.Fatalf("snooze 실패: %v", err)
	}
	if sn.State != StateSnoozed || sn.SilencedUntil == "" {
		t.Fatalf("snoozed + silencedUntil 이어야 하는데 state=%s until=%q", sn.State, sn.SilencedUntil)
	}
	// 9분 후 — 아직 snooze 중.
	c.advance(9 * time.Minute)
	if n := s.Tick(); n != 0 {
		t.Errorf("9분 후엔 re-fire 0 이어야 하는데 %d", n)
	}
	// 추가 2분(총 11분) — 만료 → re-fire.
	c.advance(2 * time.Minute)
	if n := s.Tick(); n != 1 {
		t.Errorf("만료 후 re-fire 1 이어야 하는데 %d", n)
	}
	got := s.List("", "")[0]
	if got.State != StateTriggered {
		t.Errorf("만료 re-fire 후 state 는 triggered 여야 하는데 %s", got.State)
	}
	// audit 에 snooze→triggered 자동 전이 기록.
	var found bool
	for _, e := range got.Audit {
		if e.From == StateSnoozed && e.To == StateTriggered && e.By == "system" {
			found = true
		}
	}
	if !found {
		t.Errorf("audit 에 snooze→triggered 자동 re-fire 기록이 있어야 함: %v", got.Audit)
	}
}

// 4) auto-resolve: open 인시던트 → AutoResolve → resolved, resolvedBy=auto.
func TestAutoResolve(t *testing.T) {
	s, _ := newClockStore(time.Now())
	first := s.Observe("dk-auto", "warning", "큐 적체")
	got, ok := s.AutoResolve("dk-auto")
	if !ok {
		t.Fatalf("open 인시던트는 auto-resolve 되어야 함")
	}
	if got.State != StateResolved || got.ResolvedBy != "auto" {
		t.Errorf("resolved + resolvedBy=auto 여야 하는데 state=%s by=%q", got.State, got.ResolvedBy)
	}
	if _, ok := s.AutoResolve("dk-auto"); ok {
		t.Errorf("이미 resolved 면 auto-resolve 매칭이 없어야 함")
	}
	_ = first
}

// 5) resolved 재오픈: resolved 후 동일 dedupKey Observe → 같은 id, triggered.
func TestObserve_ReopenAfterResolve(t *testing.T) {
	s, _ := newClockStore(time.Now())
	first := s.Observe("dk-reopen", "info", "차단 급증")
	if _, err := s.Resolve(first.ID, "op"); err != nil {
		t.Fatalf("resolve 실패: %v", err)
	}
	reopened := s.Observe("dk-reopen", "info", "차단 급증")
	if reopened.ID != first.ID {
		t.Errorf("재오픈은 같은 id 여야 하는데 %s vs %s", reopened.ID, first.ID)
	}
	if reopened.State != StateTriggered {
		t.Errorf("재오픈 state 는 triggered 여야 하는데 %s", reopened.State)
	}
	if reopened.ResolvedBy != "" {
		t.Errorf("재오픈 시 resolvedBy 는 초기화되어야 하는데 %q", reopened.ResolvedBy)
	}
}

// 6) List 필터: state/severity 필터가 정확히 거른다.
func TestList_Filters(t *testing.T) {
	s, _ := newClockStore(time.Now())
	a := s.Observe("dk-a", "critical", "A")
	s.Observe("dk-b", "warning", "B")
	if _, err := s.Ack(a.ID, "op"); err != nil {
		t.Fatalf("ack 실패: %v", err)
	}
	if got := s.List("acked", ""); len(got) != 1 || got[0].ID != a.ID {
		t.Errorf("state=acked 필터는 A 1건이어야 하는데 %v", got)
	}
	if got := s.List("", "warning"); len(got) != 1 || got[0].Severity != "warning" {
		t.Errorf("severity=warning 필터는 1건이어야 하는데 %v", got)
	}
	if got := s.List("triggered", "critical"); len(got) != 0 {
		t.Errorf("A 는 acked 라 triggered+critical 필터엔 0건이어야 하는데 %d건", len(got))
	}
}

// Snooze 범위 밖은 거부(0/음수/초과).
func TestSnooze_RejectsOutOfRange(t *testing.T) {
	s, _ := newClockStore(time.Now())
	first := s.Observe("dk-x", "info", "X")
	if _, err := s.Snooze(first.ID, 0, "op"); err == nil {
		t.Errorf("0 기간 snooze 는 거부되어야 함")
	}
	if _, err := s.Snooze(first.ID, MaxSnooze+time.Minute, "op"); err == nil {
		t.Errorf("MaxSnooze 초과는 거부되어야 함")
	}
}

// 미존재 id 전이는 ErrNotFound.
func TestTransition_NotFound(t *testing.T) {
	s, _ := newClockStore(time.Now())
	if _, err := s.Ack("inc_nope", "op"); err == nil {
		t.Errorf("미존재 id ack 는 ErrNotFound 여야 함")
	}
}
