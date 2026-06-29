package diag

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestRedactStripsPassword(t *testing.T) {
	cases := map[string]string{
		"http://fabrix:supersecret@clickhouse.ns:8123":     "http://fabrix@clickhouse.ns:8123",
		"http://admin:pw@192.168.160.43:30834/api/v2.0/x":  "http://admin@192.168.160.43:30834",
		"http://vmselect.observability:8481/select/0/prom": "http://vmselect.observability:8481",
		"postgres://fabrix:pw@fabrix-pg-rw.ns:5432/fabrix": "postgres://fabrix@fabrix-pg-rw.ns:5432",
		"": "",
	}
	for in, want := range cases {
		if got := Redact(in); got != want {
			t.Errorf("Redact(%q) = %q, want %q", in, got, want)
		}
		// 비밀번호가 절대 남지 않아야 한다.
		if strings.Contains(Redact(in), "pw") || strings.Contains(Redact(in), "supersecret") {
			t.Errorf("Redact(%q) 가 비밀번호를 노출함: %q", in, Redact(in))
		}
	}
}

func TestRunProbesConcurrentlyAndSummarizes(t *testing.T) {
	now := time.Unix(1700000000, 0)
	probers := []Prober{
		{Name: "ok", Title: "OK", Configured: true, Probe: func(context.Context) error { return nil }},
		{Name: "down", Title: "Down", Configured: true, Optional: true, Probe: func(context.Context) error { return errors.New("connection refused") }},
		{Name: "unset", Title: "Unset", Configured: false}, // 프로브 생략
	}
	rep := Run(context.Background(), "observe", now, false, probers)

	if rep.Profile != "observe" || rep.GeneratedAt != "2023-11-14T22:13:20Z" {
		t.Fatalf("메타 불일치: %+v", rep)
	}
	if rep.Summary.Total != 3 || rep.Summary.Configured != 2 || rep.Summary.Reachable != 1 || rep.Summary.Degraded != 1 {
		t.Fatalf("summary 불일치: %+v", rep.Summary)
	}
	byName := map[string]Status{}
	for _, c := range rep.Checks {
		byName[c.Name] = c
	}
	if !byName["ok"].Reachable || byName["ok"].Error != "" {
		t.Error("ok 는 reachable 이어야 함")
	}
	if byName["down"].Reachable || byName["down"].Error == "" {
		t.Error("down 은 unreachable + error 여야 함")
	}
	if byName["unset"].Reachable || byName["unset"].LatencyMs != 0 {
		t.Error("unset 은 프로브 생략(미도달, 지연 0)이어야 함")
	}
	// required_by 는 nil 이 아니라 빈 배열로 직렬화되어야 한다(프론트 .map 안전).
	if byName["unset"].RequiredBy == nil {
		t.Error("RequiredBy 는 nil 이 아니라 [] 여야 함")
	}
}
