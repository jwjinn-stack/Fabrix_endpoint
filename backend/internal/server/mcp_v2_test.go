package server

// IMP-9 PoC 테스트 — SDK StreamableHTTP 라우트(POST /api/v1/mcp/v2)를 SDK 클라이언트로 E2E 검증.
//
// 4 케이스:
//  1) 패리티 — SDK 라우트 groupby_metric 의 structuredContent 가 수기 라우트와 동일 비즈니스 경로
//     (dimension/label/row key 집합/행 수 일치). wave 기반 float 값은 호출 시각 의존이라 구조 필드로 비교.
//  2) 잘못된 dim — enum 스키마가 거부.
//  3) 여분 필드 — additionalProperties:false 가 거부.
//  4) read-only — tools/list 에 groupby_metric 만(write tool 0개).

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/maymust/fabrix-endpoint/internal/capability"
	"github.com/maymust/fabrix-endpoint/internal/domain"
	mockprov "github.com/maymust/fabrix-endpoint/internal/provider/mock"
)

// v2TestServer 는 mock dashboard + Dashboard cap 으로 SDK v2 라우트가 동작하는 Server 를 만든다.
func v2TestServer() *Server {
	return &Server{
		caps:      capability.Set{capability.Dashboard: true},
		dashboard: mockprov.New(),
	}
}

// dialV2 는 httptest 서버에 SDK 클라이언트를 연결한 세션을 만든다.
func dialV2(t *testing.T) (*mcp.ClientSession, func()) {
	t.Helper()
	ts := httptest.NewServer(v2TestServer().Handler())
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil)
	cs, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint: ts.URL + "/api/v1/mcp/v2",
	}, nil)
	if err != nil {
		ts.Close()
		t.Fatalf("v2 라우트 connect 실패: %v", err)
	}
	return cs, func() { _ = cs.Close(); ts.Close() }
}

// 1) 패리티: SDK 라우트 groupby_metric 이 수기 metricsBreakdownSource 와 동일 데이터 경로를 탄다.
func TestMCPv2_GroupbyMetric_Parity(t *testing.T) {
	cs, done := dialV2(t)
	defer done()

	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "groupby_metric",
		Arguments: map[string]any{"dim": "endpoint", "range": "1h"},
	})
	if err != nil {
		t.Fatalf("CallTool 실패: %v", err)
	}
	if res.IsError {
		t.Fatalf("tool 결과가 에러: %+v", res.Content)
	}

	var got groupbyMetricOut
	raw, _ := json.Marshal(res.StructuredContent)
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("structuredContent 언마샬 실패: %v (raw=%s)", err, raw)
	}

	// 수기 라우트와 동일한 비즈니스 경로(직접 호출)로 기준값 산출.
	want, err := mockprov.New().MetricsBreakdown(context.Background(), domain.ParseRange("1h"), "endpoint")
	if err != nil {
		t.Fatalf("기준 MetricsBreakdown 실패: %v", err)
	}
	domain.AnnotateWarnings(&want)

	if got.Dimension != want.Dimension {
		t.Errorf("dimension 불일치: got=%q want=%q", got.Dimension, want.Dimension)
	}
	if got.Label != want.Label {
		t.Errorf("label 불일치: got=%q want=%q", got.Label, want.Label)
	}
	if len(got.Rows) != len(want.Rows) {
		t.Fatalf("행 수 불일치: got=%d want=%d", len(got.Rows), len(want.Rows))
	}
	gotKeys, wantKeys := rowKeys(got.MetricsBreakdown), rowKeys(want)
	if strings.Join(gotKeys, ",") != strings.Join(wantKeys, ",") {
		t.Errorf("row key 집합 불일치: got=%v want=%v", gotKeys, wantKeys)
	}
}

func rowKeys(b domain.MetricsBreakdown) []string {
	ks := make([]string, 0, len(b.Rows))
	for _, r := range b.Rows {
		ks = append(ks, r.Key)
	}
	sort.Strings(ks)
	return ks
}

// rejected 는 SDK 스키마 검증 실패가 거부됐는지 본다. SDK 는 검증 실패를 전송에 따라
// Go 에러(StreamableHTTP) 또는 tool 에러(CallToolResult.IsError) 로 표면화하므로 둘 다 허용.
func rejected(res *mcp.CallToolResult, err error) bool {
	return err != nil || (res != nil && res.IsError)
}

// 2) 잘못된 dim → enum 스키마가 핸들러 진입 전에 거부.
func TestMCPv2_InvalidDim_RejectedBySchema(t *testing.T) {
	cs, done := dialV2(t)
	defer done()

	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "groupby_metric",
		Arguments: map[string]any{"dim": "bogus"},
	})
	if !rejected(res, err) {
		t.Fatalf("허용값 밖 dim 은 enum 스키마로 거부돼야 하는데 통과함: res=%+v err=%v", res, err)
	}
}

// 3) 봉투에 없는 여분 필드 → additionalProperties:false 가 거부.
func TestMCPv2_ExtraField_Rejected(t *testing.T) {
	cs, done := dialV2(t)
	defer done()

	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "groupby_metric",
		Arguments: map[string]any{"dim": "model", "extra": "x"},
	})
	if !rejected(res, err) {
		t.Fatalf("여분 필드는 additionalProperties:false 로 거부돼야 하는데 통과함: res=%+v err=%v", res, err)
	}
}

// 4) read-only(IMP-73): SDK path 는 groupby_metric + 온톨로지 read tool 4종을 노출하되, 전부 조회 전용.
// mutating 동사 이름이 하나라도 있으면 안 된다(auto-callable mutation 없음 — two-tier 안전 가드).
func TestMCPv2_ReadOnly_NoWriteTools(t *testing.T) {
	cs, done := dialV2(t)
	defer done()

	res, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListTools 실패: %v", err)
	}
	got := map[string]bool{}
	for _, tl := range res.Tools {
		got[tl.Name] = true
	}
	// groupby_metric(IMP-9) + query_objects/traverse_links/get_object/get_object_metrics(IMP-73).
	for _, want := range []string{"groupby_metric", "query_objects", "traverse_links", "get_object", "get_object_metrics"} {
		if !got[want] {
			t.Errorf("SDK path tools/list 에 read tool %q 가 없음: %+v", want, res.Tools)
		}
	}
	// **안전**: 변경 동사 이름이 하나라도 있으면 read-only 위반(mutation 은 ActionForm 경로에만).
	for _, tl := range res.Tools {
		n := strings.ToLower(tl.Name)
		for _, verb := range []string{"create", "update", "delete", "set", "write", "patch", "scale", "restart", "drain", "cordon", "resolve", "invoke", "apply"} {
			if strings.Contains(n, verb) {
				t.Errorf("write 성격 tool 노출됨(read-only 위반): %q", tl.Name)
			}
		}
	}
}

// IMP-73 bad-input(strict validation) — LLM 이 낼 수 있는 malformed/hallucinated args 를 스키마가 거부.
func TestMCPv2_Ontology_StrictValidation(t *testing.T) {
	cs, done := dialV2(t)
	defer done()
	ctx := context.Background()

	// (a) required 누락 — traverse_links.objectId 없음 → 거부.
	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "traverse_links", Arguments: map[string]any{}})
	if !rejected(res, err) {
		t.Errorf("traverse_links: objectId(required) 누락은 거부돼야 함: res=%+v err=%v", res, err)
	}
	// (b) enum 밖 — query_objects.type=Bogus → 거부.
	res, err = cs.CallTool(ctx, &mcp.CallToolParams{Name: "query_objects", Arguments: map[string]any{"type": "Bogus"}})
	if !rejected(res, err) {
		t.Errorf("query_objects: enum 밖 type 은 거부돼야 함: res=%+v err=%v", res, err)
	}
	// (c) 여분 필드 — additionalProperties:false → 거부.
	res, err = cs.CallTool(ctx, &mcp.CallToolParams{Name: "get_object_metrics", Arguments: map[string]any{"id": "x", "extra": "y"}})
	if !rejected(res, err) {
		t.Errorf("get_object_metrics: 여분 필드는 additionalProperties:false 로 거부돼야 함: res=%+v err=%v", res, err)
	}
	// (d) 정상 인자 — get_object{id} 는 통과(핸들러가 안전 응답, 크래시/에러 아님).
	res, err = cs.CallTool(ctx, &mcp.CallToolParams{Name: "get_object", Arguments: map[string]any{"id": "endpoint:e-slow"}})
	if err != nil || (res != nil && res.IsError) {
		t.Errorf("get_object{id} 정상 인자는 통과해야 함: res=%+v err=%v", res, err)
	}
}
