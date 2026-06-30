package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/maymust/fabrix-endpoint/internal/capability"
)

// newTestServer 는 라우팅 테스트용 최소 Server 를 만든다.
// Handler() 의 핸들러 등록은 의존성을 호출하지 않으므로(함수값만 등록) caps 만 있으면 충분하다.
func newTestServer(caps capability.Set) *Server {
	return &Server{caps: caps}
}

func postMCP(t *testing.T, h http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/mcp", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// IMP-2: Dashboard cap 이 꺼진 프로파일에서는 /api/v1/mcp 가 아예 등록되지 않아 404 여야 한다.
// (미등록 = 실제 차단. capability 로 막은 대시보드 데이터가 MCP 경로로 새어나가면 안 됨.)
func TestMCP_GatedWhenDashboardCapabilityOff(t *testing.T) {
	// Dashboard 없음 (Traces 만 보유한 프로파일)
	h := newTestServer(capability.Set{capability.Traces: true}).Handler()
	rec := postMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("Dashboard cap 꺼짐 → /api/v1/mcp 는 404(미등록) 여야 하는데 %d (body=%s)",
			rec.Code, rec.Body.String())
	}
}

// IMP-2: Dashboard cap 이 켜진 프로파일에서는 MCP 가 정상 동작해야 한다(회귀 가드).
func TestMCP_AvailableWhenDashboardCapabilityOn(t *testing.T) {
	h := newTestServer(capability.Set{capability.Dashboard: true}).Handler()

	// initialize → 200 + protocolVersion
	rec := postMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("Dashboard cap 켜짐 → initialize 는 200 이어야 하는데 %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "protocolVersion") {
		t.Fatalf("initialize 결과에 protocolVersion 이 없음: %s", rec.Body.String())
	}

	// tools/list → 200 + 4개 tool 노출(정적, dashboard 데이터 불필요)
	rec = postMCP(t, h, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("tools/list 는 200 이어야 하는데 %d", rec.Code)
	}
	for _, name := range []string{"list_dimensions", "groupby_metric", "top_outliers", "summarize_endpoint_health"} {
		if !strings.Contains(rec.Body.String(), name) {
			t.Errorf("tools/list 결과에 tool %q 가 없음", name)
		}
	}
}
