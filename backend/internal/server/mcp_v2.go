package server

// IMP-9 PoC — JSON-RPC 2.0 MCP 전송을 공식 MCP Go SDK(modelcontextprotocol/go-sdk)로 채택.
//
// 채택 순서 step 1(좁게): groupby_metric tool 1개만 typed mcp.AddTool[In,Out] 로 이전하고,
// 전송은 mcp.NewStreamableHTTPHandler(stateless) 를 별도 PoC 라우트 POST /api/v1/mcp/v2 에 마운트한다.
// 기존 수기 POST /api/v1/mcp(handleMCP, mcp.go) 는 무수정 유지 — 회귀 없이 나란히 비교.
//
// 봉투/전송/검증 레이어만 SDK 로 교체한다. 비즈니스 로직(s.dashboard 의 MetricsBreakdown +
// domain.AnnotateWarnings)은 수기 라우트와 동일 경로를 그대로 재사용한다 → 데이터 패리티.
//
// read-only 보장: groupby_metric(조회) 1개만 등록. write tool 미등록(observe 프로파일 정합).
// protocolVersion 하드코딩 제거: SDK 가 클라이언트와 자동 네고한다(수기 라우트의 "2024-11-05" 와 분리).
//
// 스키마 함정(검증 노트):
//   - jsonschema-go 는 객체 스키마에 additionalProperties:false 를 강제(SDK #892) →
//     봉투에 없는 여분 필드는 검증 단계에서 거부된다(핸들러 진입 전).
//   - format/regex back-reference 는 미적용 → 허용값은 enum 태그로 선언(아래 jsonschema:"enum=..").

import (
	"context"
	"net/http"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// groupbyMetricIn — dim/range 입력. SDK/jsonschema-go 는 jsonschema 구조체 태그를 description
// 으로만 쓰고 enum 은 태그로 받지 않으므로(태그는 "WORD=" 로 시작 금지), enum 제약은 아래
// groupbyMetricInputSchema 에서 명시적으로 선언해 AddTool 에 넘긴다.
type groupbyMetricIn struct {
	Dim   string `json:"dim,omitempty" jsonschema:"groupby 차원(기본 model)"`
	Range string `json:"range,omitempty" jsonschema:"시간 범위(기본 1h)"`
}

// groupbyMetricInputSchema 는 dim/range 의 허용값을 enum 으로 박은 inputSchema 를 명시 선언한다.
//   - enum: jsonschema-go 가 핸들러 진입 전에 허용값(model|endpoint|namespace, 1h|6h|24h|7d) 밖을 거부.
//   - additionalProperties:false(= {"not":{}}): 봉투에 없는 여분 필드 거부(SDK #892 함정 회피).
//   - format/regex back-reference 는 미적용이라 enum 으로 표현(pattern 도 가능하나 여기선 enum).
func groupbyMetricInputSchema() *jsonschema.Schema {
	return &jsonschema.Schema{
		Type: "object",
		Properties: map[string]*jsonschema.Schema{
			"dim":   {Type: "string", Description: "groupby 차원(기본 model)", Enum: []any{"model", "endpoint", "namespace"}},
			"range": {Type: "string", Description: "시간 범위(기본 1h)", Enum: []any{"1h", "6h", "24h", "7d"}},
		},
		AdditionalProperties: &jsonschema.Schema{Not: &jsonschema.Schema{}}, // → additionalProperties:false
	}
}

// groupbyMetricOut — 출력은 수기 라우트의 structuredContent 와 동형(domain.MetricsBreakdown).
// SDK 가 Out 타입에서 outputSchema 를 자동생성하고 StructuredContent 를 채운다.
type groupbyMetricOut struct {
	domain.MetricsBreakdown
}

// mcpV2Server 는 groupby_metric 1개만 등록한 SDK MCP 서버를 만든다(read-only — write tool 없음).
// stateless StreamableHTTP 라 요청마다 새로 만들어도 무방하다(getServer 가 동일 서버를 반환해도 OK).
func (s *Server) mcpV2Server() *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{
		Name:    "fabrix-endpoint",
		Version: "0.1.0",
		Title:   "FABRIX Endpoint MCP (go-sdk PoC)",
	}, nil)

	// typed AddTool — inputSchema/outputSchema 자동생성 + 입력 자동검증.
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "groupby_metric",
		Description: "트래픽/품질 메트릭을 한 차원(model|endpoint|namespace)으로 분해해 반환한다(요청·QPS·TTFT p95·ITL·E2E·캐시적중·토큰).",
		InputSchema: groupbyMetricInputSchema(),
	}, s.groupbyMetricV2)

	return srv
}

// groupbyMetricV2 는 groupby_metric typed 핸들러 — 기존 metricsBreakdownSource +
// domain.AnnotateWarnings 를 그대로 재사용한다(수기 라우트 mcpCallTool 의 groupby_metric 경로와 동일).
func (s *Server) groupbyMetricV2(ctx context.Context, _ *mcp.CallToolRequest, in groupbyMetricIn) (*mcp.CallToolResult, groupbyMetricOut, error) {
	dim := in.Dim
	if dim == "" {
		dim = "model"
	}
	rng := domain.ParseRange(in.Range)

	src, ok := s.dashboard.(metricsBreakdownSource)
	if !ok {
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: "메트릭 분해 소스 미지원"}},
			IsError: true,
		}, groupbyMetricOut{}, nil
	}
	rep, err := src.MetricsBreakdown(ctx, rng, dim)
	if err != nil {
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: "분해 조회 실패: " + err.Error()}},
			IsError: true,
		}, groupbyMetricOut{}, nil
	}
	domain.AnnotateWarnings(&rep)

	// Content 는 비워두면 SDK 가 StructuredContent(=Out)의 JSON 텍스트로 채운다.
	return nil, groupbyMetricOut{MetricsBreakdown: rep}, nil
}

// mcpV2Handler 는 POST /api/v1/mcp/v2 에 마운트할 StreamableHTTP 핸들러(stateless)를 만든다.
// JSONResponse=true 로 application/json 응답(테스트·디버깅 단순화; SSE 미사용).
func (s *Server) mcpV2Handler() http.Handler {
	return mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return s.mcpV2Server() },
		&mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true},
	)
}
