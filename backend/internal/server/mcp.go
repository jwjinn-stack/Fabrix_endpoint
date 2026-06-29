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
	return []map[string]any{
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

// outliers 는 카탈로그 임계치를 위반한 행만 사유와 함께 추린다(서버측 C6).
func outliers(rows []domain.MetricsBreakdownRow) []map[string]any {
	out := []map[string]any{}
	for _, r := range rows {
		reasons := []string{}
		vals := map[string]float64{
			"ttft_p95_ms": r.TTFTp95ms, "itl_avg_ms": r.ITLavgMs, "e2e_p95_ms": r.E2Ep95ms, "cache_hit_rate": r.CacheHitRate,
		}
		for _, m := range domain.MetricCatalog {
			v, ok := vals[m.Key]
			if !ok {
				continue
			}
			if m.LowerBetter && m.WarnAbove > 0 && v > m.WarnAbove {
				reasons = append(reasons, fmt.Sprintf("%s %.0f > 임계 %.0f", m.Title, v, m.WarnAbove))
			}
			if !m.LowerBetter && m.WarnBelow > 0 && v > 0 && v < m.WarnBelow {
				reasons = append(reasons, fmt.Sprintf("%s %.0f%% < 임계 %.0f%%", m.Title, v*100, m.WarnBelow*100))
			}
		}
		if len(reasons) > 0 {
			out = append(out, map[string]any{"key": r.Key, "requests": r.Requests, "reasons": reasons})
		}
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
