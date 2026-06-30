package diag

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestClassify(t *testing.T) {
	cases := map[string]string{
		`dial tcp: lookup foo on 10.96.0.10:53: no such host`: KindDNSFail,
		`dial tcp 10.0.0.1:8123: connect: connection refused`: KindConnRefused,
		`x509: certificate has expired or is not yet valid`:   KindTLSFail,
		`tls: handshake failure`:                              KindTLSFail,
		`harbor 403`:                                          KindAuthFail,
		`unexpected status 401`:                               KindAuthFail,
		`clickhouse 500`:                                      KindBadStatus,
		`context deadline exceeded`:                           KindTimeout,
		`some unknown wat`:                                    KindUnreachable,
	}
	for msg, want := range cases {
		if got := classify(msg); got != want {
			t.Errorf("classify(%q) = %q, want %q", msg, got, want)
		}
	}
}

// runProbe 가 HTTP 프로브에서 단계 타이밍을 채우고 성공/실패를 분류하는지 검증.
func TestRunProbe_HTTPTimingAndKind(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ok.Close()

	st := Status{Name: "x", Configured: true}
	p := Prober{Probe: func(ctx context.Context) error {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ok.URL, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		resp.Body.Close()
		return nil
	}}
	runProbe(context.Background(), time.Unix(1700000000, 0), false, p, &st)

	if !st.Reachable || st.FailKind != KindOK {
		t.Fatalf("reachable=%v kind=%q, want reachable ok", st.Reachable, st.FailKind)
	}
	if st.Timing == nil {
		t.Fatal("HTTP 프로브인데 Timing 이 nil")
	}
	if st.RemoteAddr == "" {
		t.Error("RemoteAddr 비어 있음(연결 주소 미수집)")
	}
}

func TestRunProbe_NonHTTPNoTiming(t *testing.T) {
	st := Status{Name: "pg", Configured: true}
	p := Prober{Probe: func(context.Context) error { return nil }} // HTTP 활동 없음
	runProbe(context.Background(), time.Unix(1700000000, 0), false, p, &st)
	if st.Timing != nil {
		t.Errorf("비-HTTP 프로브인데 Timing 이 채워짐: %+v", st.Timing)
	}
	if !st.Reachable {
		t.Error("성공 프로브가 reachable 아님")
	}
}

func TestRunProbe_VerboseDetails(t *testing.T) {
	st := Status{Name: "h", Configured: true}
	called := false
	p := Prober{
		Probe:   func(context.Context) error { return nil },
		Details: func(context.Context) map[string]any { called = true; return map[string]any{"k": "v"} },
	}
	// verbose=false → Details 미호출
	runProbe(context.Background(), time.Now(), false, p, &st)
	if called || st.Details != nil {
		t.Fatal("verbose=false 인데 Details 가 호출됨")
	}
	// verbose=true → Details 호출
	st = Status{Name: "h", Configured: true}
	runProbe(context.Background(), time.Now(), true, p, &st)
	if !called || st.Details["k"] != "v" {
		t.Fatalf("verbose=true 인데 Details 미수집: %+v", st.Details)
	}
}

func TestBuildNetwork_ConfigResolution(t *testing.T) {
	deps := []DepEndpoint{
		{Name: "harbor", EnvKey: "FABRIX_HARBOR_URL", RawURL: "https://admin:secret@harbor.example.com:8443/api"},
		{Name: "worm", EnvKey: "FABRIX_WORM_URL", RawURL: ""},
	}
	n := BuildNetwork(context.Background(), deps)
	if len(n.Hosts) != 2 {
		t.Fatalf("hosts=%d, want 2", len(n.Hosts))
	}
	h := n.Hosts[0]
	if h.Scheme != "https" || h.Host != "harbor.example.com" || h.Port != "8443" {
		t.Errorf("설정 해석 오류: %+v", h)
	}
	if n.Hosts[1].Error == "" {
		t.Error("미구성 dep 에 error 가 없음")
	}
}

func TestNoProxyCoversAndClusterLocal(t *testing.T) {
	if !isClusterLocal("clickhouse") || !isClusterLocal("svc.foo.svc.cluster.local") {
		t.Error("인클러스터 호스트 판별 실패")
	}
	if isClusterLocal("10.0.0.1") || isClusterLocal("harbor.example.com") {
		t.Error("외부 호스트를 인클러스터로 오판")
	}
	if !noProxyCovers(".svc,.cluster.local", "x.y.svc.cluster.local") {
		t.Error("NO_PROXY 접미사 매칭 실패")
	}
	if noProxyCovers(".svc", "harbor.example.com") {
		t.Error("NO_PROXY 가 외부 호스트를 잘못 포괄")
	}
}
