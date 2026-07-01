package server

// FABRIX Endpoint MCP 서버(C7, read-only MVP) — 대시보드 의미를 AI 에이전트에 노출한다.
//
// 역할 분리(리서치 D4): Langfuse 네이티브 MCP 는 trace/score 소스를 담당하고,
// 여기 FABRIX MCP 는 Dynamo/VM 메트릭 + 대시보드 의미 + cross-source groupby 를 담당한다.
// grounding(R3-5): 자유 PromQL 을 짜게 하지 않고, 메트릭 카탈로그 + "인사이트 동사" tool 만 노출한다.
//
// 전송: JSON-RPC 2.0 over HTTP POST(stateless). initialize / tools.list / tools.call /
// resources.list / resources.read 지원. (실클라이언트용 streamable-HTTP/SSE 는 후속.)
// 읽기 전용 — 모든 tool 은 조회만 한다(observe 프로파일과 정합, Grafana --disable-write 동급).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

const mcpProtocolVersion = "2024-11-05"

type rpcReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResp struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcErr         `json:"error,omitempty"`
}

type rpcErr struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// handleMCP 는 POST /api/v1/mcp — JSON-RPC 2.0 엔드포인트.
func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	var req rpcReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		httpx.JSON(w, http.StatusOK, rpcResp{JSONRPC: "2.0", Error: &rpcErr{Code: -32700, Message: "parse error"}})
		return
	}
	// 알림(id 없음, notifications/*)은 응답 없이 202.
	if len(req.ID) == 0 && strings.HasPrefix(req.Method, "notifications/") {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	resp := rpcResp{JSONRPC: "2.0", ID: req.ID}
	switch req.Method {
	case "initialize":
		resp.Result = map[string]any{
			"protocolVersion": mcpProtocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}, "resources": map[string]any{}},
			"serverInfo":      map[string]any{"name": "fabrix-endpoint", "version": "0.1.0"},
			"instructions":    "FABRIX Endpoint 관측 대시보드의 메트릭·차원·인사이트를 읽기 전용으로 제공합니다. 자유 쿼리 대신 list_dimensions 로 차원/메트릭을 확인하고 groupby_metric·top_outliers·summarize_endpoint_health 를 사용하세요.",
		}
	case "tools/list":
		resp.Result = map[string]any{"tools": mcpTools()}
	case "tools/call":
		resp.Result, resp.Error = s.mcpCallTool(r.Context(), req.Params)
	case "resources/list":
		resp.Result = map[string]any{"resources": mcpResources()}
	case "resources/read":
		resp.Result, resp.Error = mcpReadResource(req.Params)
	default:
		resp.Error = &rpcErr{Code: -32601, Message: "method not found: " + req.Method}
	}
	httpx.JSON(w, http.StatusOK, resp)
}

// ── tools ──

func mcpTools() []map[string]any {
	rangeProp := map[string]any{"type": "string", "enum": []string{"1h", "6h", "24h", "7d"}, "description": "시간 범위(기본 1h)"}
	dimProp := map[string]any{"type": "string", "enum": []string{"model", "endpoint", "namespace"}, "description": "groupby 차원(기본 model)"}
	// (a) aggregate 대시보드 tool — 이 수기 라우트 고유(s.dashboard 집계).
	aggregate := []map[string]any{
		{
			"name": "list_dimensions", "description": "groupby 가능한 차원과 메트릭 카탈로그(의미·단위·임계치)를 반환한다. 다른 tool 호출 전에 먼저 본다.",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			"name": "groupby_metric", "description": "트래픽/품질 메트릭을 한 차원(model|endpoint|namespace)으로 분해해 반환한다(요청·QPS·TTFT p95·ITL·E2E·캐시적중·토큰).",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{"dim": dimProp, "range": rangeProp}},
		},
		{
			"name": "top_outliers", "description": "차원별 분해에서 카탈로그 임계치를 위반한(이상) 그룹만 추려 사유와 함께 반환한다(BubbleUp형).",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{"dim": dimProp, "range": rangeProp}},
		},
		{
			"name": "summarize_endpoint_health", "description": "전체 추론 서빙 건강도 요약(QPS·TTFT p95·ITL·캐시적중·차단·알람)을 자연어로 반환한다(L1).",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{"range": rangeProp}},
		},
	}
	// (b) IMP-73 — 온톨로지 read tool 은 프론트 emit 아티팩트에서 파생(수기 리스트 은퇴). SDK path(v2)와
	//     동일 계약을 이 수기 tools/list 에도 노출해 Diagnostics McpPanel 이 자동 동기되게 한다.
	return append(aggregate, ontologyToolListEntries()...)
}

type toolCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

func (s *Server) mcpCallTool(ctx context.Context, raw json.RawMessage) (any, *rpcErr) {
	var p toolCallParams
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, &rpcErr{Code: -32602, Message: "invalid params"}
	}
	var args struct {
		Dim   string `json:"dim"`
		Range string `json:"range"`
	}
	_ = json.Unmarshal(p.Arguments, &args)
	rng := domain.ParseRange(args.Range)
	dim := args.Dim
	if dim == "" {
		dim = "model"
	}

	switch p.Name {
	case "list_dimensions":
		return mcpTextResult(map[string]any{"dimensions": domain.MetricDimensions, "metrics": domain.MetricCatalog}), nil

	case "groupby_metric":
		src, ok := s.dashboard.(metricsBreakdownSource)
		if !ok {
			return mcpErrText("메트릭 분해 소스 미지원"), nil
		}
		if _, ok := domain.DimensionLabel(dim); !ok {
			return mcpErrText("지원하지 않는 차원: " + dim), nil
		}
		rep, err := src.MetricsBreakdown(ctx, rng, dim)
		if err != nil {
			return mcpErrText("분해 조회 실패: " + err.Error()), nil
		}
		domain.AnnotateWarnings(&rep)
		return mcpTextResult(rep), nil

	case "top_outliers":
		src, ok := s.dashboard.(metricsBreakdownSource)
		if !ok {
			return mcpErrText("메트릭 분해 소스 미지원"), nil
		}
		rep, err := src.MetricsBreakdown(ctx, rng, dim)
		if err != nil {
			return mcpErrText("분해 조회 실패: " + err.Error()), nil
		}
		domain.AnnotateWarnings(&rep)
		return mcpTextResult(map[string]any{"dimension": rep.Dimension, "range": rep.Range, "outliers": outliers(rep.Rows)}), nil

	case "summarize_endpoint_health":
		ov, err := s.dashboard.Overview(ctx, rng)
		if err != nil {
			return mcpErrText("overview 조회 실패: " + err.Error()), nil
		}
		return mcpTextResult(summarizeOverview(ov)), nil
	}
	return nil, &rpcErr{Code: -32602, Message: "unknown tool: " + p.Name}
}

// outliers 는 domain.AnnotateWarnings 가 표시한 이상 행(Warn)만 사유와 함께, 사유 많은 순으로 추린다.
// 판정 규칙은 domain.AnnotateWarnings 단일 출처 — 여기서 재계산하지 않아 UI 셀 강조와 결과가 일치한다.
func outliers(rows []domain.MetricsBreakdownRow) []map[string]any {
	out := []map[string]any{}
	for _, r := range rows {
		if !r.Warn {
			continue
		}
		out = append(out, map[string]any{"key": r.Key, "requests": r.Requests, "reasons": r.WarnReasons})
	}
	sort.Slice(out, func(i, j int) bool { return len(out[i]["reasons"].([]string)) > len(out[j]["reasons"].([]string)) })
	return out
}

func summarizeOverview(ov domain.DashboardOverview) string {
	var b strings.Builder
	fmt.Fprintf(&b, "기간 %s 추론 서빙 요약\n", ov.Range)
	fmt.Fprintf(&b, "- 트래픽: QPS %.1f, 실행중 %d, 대기 %d, 성공률 %.1f%%\n",
		ov.Traffic.QPS, ov.Traffic.Running, ov.Traffic.Waiting, ov.Traffic.SuccessRate*100)
	fmt.Fprintf(&b, "- 품질: TTFT p95 %.0fms, ITL %.0fms, 캐시 적중률 %.0f%%\n",
		ov.Quality.TTFTp95ms, ov.Quality.ITLavgMs, ov.Quality.CacheHitRate*100)
	fmt.Fprintf(&b, "- 가드레일: 차단 %d, PII %d, flagged %d\n", ov.Guardrail.Blocked, ov.Guardrail.PII, ov.Guardrail.Flagged)
	if ov.Quality.TTFTp95ms > 500 {
		b.WriteString("- ⚠ TTFT p95 가 높습니다. 큐 적체·prefix 캐시 적중률을 함께 확인하세요(groupby_metric dim=model).\n")
	}
	if ov.Quality.CacheHitRate > 0 && ov.Quality.CacheHitRate < 0.5 {
		b.WriteString("- ⚠ 캐시 적중률이 낮습니다(비용·TTFT 악화). top_outliers 로 어느 그룹인지 확인하세요.\n")
	}
	for _, a := range ov.Alarms {
		fmt.Fprintf(&b, "- 알람[%s]: %s\n", a.Severity, a.Message)
	}
	return b.String()
}

// ── resources ──

func mcpResources() []map[string]any {
	return []map[string]any{
		{"uri": "fabrix://metric-catalog", "name": "메트릭 카탈로그", "description": "메트릭별 의미·단위·방향·임계치(AI grounding)", "mimeType": "application/json"},
		{"uri": "fabrix://dimensions", "name": "groupby 차원", "description": "분해 가능한 차원과 Prometheus 라벨 매핑", "mimeType": "application/json"},
		// IMP-73 — 온톨로지 스키마(static, session-load). Object/Link/Action 타입 카탈로그를 client 가
		// 세션 시작 시 KNOW 하도록 Resource 로 노출한다. per-object read 는 Tool(get_object)로 분리(정정 반영).
		{"uri": "fabrix://ontology/schema", "name": "온톨로지 스키마", "description": "Object/Link/Action 타입 카탈로그(§5.1·5.2·5.3)", "mimeType": "application/json"},
	}
}

// ontologySchemaCatalog 는 온톨로지 타입 카탈로그(정적) — Resource 페이로드.
// Object/Link 타입 이름 + Action 동사 이름(read-only 노출 — mutation 실행은 여기서 안 함).
// 프론트 types.ts §5.1·5.2·5.3 와 정합(타입 이름의 얇은 미러 — tool 스키마와 달리 소량 static 메타).
func ontologySchemaCatalog() map[string]any {
	return map[string]any{
		"objectTypes": []string{"Model", "Endpoint", "Service", "GpuDevice", "Node", "Trace", "Incident"},
		"linkKinds":   []string{"serves", "runsOn", "hostedBy", "routedTo", "executedOn", "consumes", "affects"},
		// Action 동사(제어) — 이름·대상만 노출(계약 카탈로그). 실행은 ActionForm+capability 게이팅 경로에만.
		"actionTypes": []map[string]any{
			{"name": "restartModel", "target": "Model"}, {"name": "scaleReplicas", "target": "Model"},
			{"name": "cordonNode", "target": "Node"}, {"name": "drainGpu", "target": "GpuDevice"},
			{"name": "ack", "target": "Incident"}, {"name": "resolve", "target": "Incident"}, {"name": "snooze", "target": "Incident"},
		},
		"note": "read-only. Action 실행은 MCP tool 로 노출되지 않으며 ActionForm+capability 게이팅으로만 수행됩니다.",
	}
}

func mcpReadResource(raw json.RawMessage) (any, *rpcErr) {
	var p struct {
		URI string `json:"uri"`
	}
	_ = json.Unmarshal(raw, &p)
	var payload any
	switch p.URI {
	case "fabrix://metric-catalog":
		payload = domain.MetricCatalog
	case "fabrix://dimensions":
		payload = domain.MetricDimensions
	case "fabrix://ontology/schema":
		payload = ontologySchemaCatalog()
	default:
		return nil, &rpcErr{Code: -32602, Message: "unknown resource: " + p.URI}
	}
	js, _ := json.Marshal(payload)
	return map[string]any{"contents": []map[string]any{{"uri": p.URI, "mimeType": "application/json", "text": string(js)}}}, nil
}

// ── helpers ──

// mcpTextResult 는 구조화 데이터를 MCP tool 결과(text JSON + structuredContent)로 감싼다.
func mcpTextResult(v any) map[string]any {
	js, _ := json.MarshalIndent(v, "", "  ")
	return map[string]any{
		"content":           []map[string]any{{"type": "text", "text": string(js)}},
		"structuredContent": v,
	}
}

func mcpErrText(msg string) map[string]any {
	return map[string]any{"content": []map[string]any{{"type": "text", "text": msg}}, "isError": true}
}
