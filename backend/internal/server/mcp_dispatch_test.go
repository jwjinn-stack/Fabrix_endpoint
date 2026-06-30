package server

import (
	"net/http"
	"strings"
	"testing"

	"github.com/maymust/fabrix-endpoint/internal/capability"
)

// mcpHandlerCapOn 은 MCP 라우트가 등록되는(Dashboard 보유) 핸들러를 만든다.
func mcpHandlerCapOn() http.Handler {
	return newTestServer(capability.Set{capability.Dashboard: true}).Handler()
}

// IMP-6: 잘못된 JSON 바디 → JSON-RPC parse error(-32700), HTTP 는 200.
func TestMCP_ParseError(t *testing.T) {
	rec := postMCP(t, mcpHandlerCapOn(), `{not valid`)
	if rec.Code != http.StatusOK {
		t.Fatalf("JSON-RPC 에러도 HTTP 200 여야 하는데 %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "-32700") {
		t.Errorf("parse error 코드 -32700 가 없음: %s", rec.Body.String())
	}
}

// IMP-6: 지원하지 않는 method → -32601 method not found.
func TestMCP_UnknownMethod(t *testing.T) {
	rec := postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":9,"method":"no/such/method"}`)
	if !strings.Contains(rec.Body.String(), "-32601") {
		t.Errorf("미지원 method 는 -32601 이어야 하는데: %s", rec.Body.String())
	}
}

// IMP-6: id 없는 notifications/* → 응답 본문 없이 202.
func TestMCP_NotificationReturns202(t *testing.T) {
	rec := postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("notifications/* 는 202 여야 하는데 %d", rec.Code)
	}
}

// IMP-6: resources/list → 메트릭 카탈로그·차원 리소스 노출.
func TestMCP_ResourcesList(t *testing.T) {
	rec := postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":3,"method":"resources/list"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("resources/list 는 200 이어야 하는데 %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "fabrix://metric-catalog") {
		t.Errorf("resources/list 에 metric-catalog 가 없음: %s", rec.Body.String())
	}
}

// IMP-6: resources/read(dimensions) → 실제 Prometheus 라벨 포함.
func TestMCP_ResourcesReadDimensions(t *testing.T) {
	rec := postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"fabrix://dimensions"}}`)
	if !strings.Contains(rec.Body.String(), "dynamo_endpoint") {
		t.Errorf("dimensions 리소스에 dynamo_endpoint 라벨이 없음: %s", rec.Body.String())
	}
}

// IMP-6: 알 수 없는 resource URI → -32602.
func TestMCP_ResourcesReadUnknown(t *testing.T) {
	rec := postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"fabrix://nope"}}`)
	if !strings.Contains(rec.Body.String(), "-32602") {
		t.Errorf("미지원 resource 는 -32602 여야 하는데: %s", rec.Body.String())
	}
}
