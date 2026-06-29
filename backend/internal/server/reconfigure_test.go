package server

import "testing"

func TestLintField(t *testing.T) {
	cases := []struct {
		name       string
		f          cfgField
		dataSource string
		wantHard   bool
		wantWarn   bool
	}{
		{"enum ok", cfgField{Kind: "enum", Options: []string{"mock", "live"}, Value: "live"}, "", false, false},
		{"enum bad", cfgField{Kind: "enum", Options: []string{"mock", "live"}, Value: "wat"}, "", true, false},
		{"url empty ok(폴백)", cfgField{Kind: "url", Value: ""}, "", false, false},
		{"url fqdn ok", cfgField{Kind: "url", Value: "http://clickhouse.fabrix.svc.cluster.local:8123"}, "", false, false},
		{"url 형식오류", cfgField{Kind: "url", Value: "not a url"}, "", true, false},
		{"url single-label 경고", cfgField{Kind: "url", Value: "http://clickhouse:8123"}, "", false, true},
		{"mock URL live 경고", cfgField{Kind: "url", Value: "mock://x:8000"}, "live", false, true},
		{"mock URL mock 정상", cfgField{Kind: "url", Value: "mock://x:8000"}, "mock", false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			warns, hard := lintField(c.f, c.dataSource)
			if (hard != "") != c.wantHard {
				t.Errorf("hardErr=%q, wantHard=%v", hard, c.wantHard)
			}
			if (len(warns) > 0) != c.wantWarn {
				t.Errorf("warnings=%v, wantWarn=%v", warns, c.wantWarn)
			}
		})
	}
}
