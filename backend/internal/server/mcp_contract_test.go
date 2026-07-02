package server

// IMP-73 — 계약 drift canary(Go 측). 프론트 TS 레지스트리 emit 아티팩트와 Go 가 embed 한 사본이
// **byte 동일**한지 검증한다 → tool 스키마의 단일 출처가 프론트/백엔드에서 갈라지지 않음을 CI 가 강제.
//
// 3자 단일화:
//   web/src/actions/ontologyTools.ts (SOURCE)
//     └ emit → web/src/actions/ontology-tools.schema.json (아티팩트; web emit.test 가 SOURCE==아티팩트 강제)
//         └ 복사 → backend/internal/server/ontology_tools_schema.json (go:embed; 이 테스트가 아티팩트==사본 강제)
// 어느 링크가 끊겨도(레지스트리 변경 후 재생성/복사 누락) 해당 테스트가 실패한다.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// webArtifactPath 는 이 테스트(backend/internal/server)에서 web 아티팩트로 가는 상대 경로.
const webArtifactPath = "../../../web/src/actions/ontology-tools.schema.json"

// Go 가 embed 한 사본 == web 이 emit·커밋한 아티팩트(byte 동일). 불일치 = 재생성/복사 누락.
func TestMCP_OntologyContract_NoDrift(t *testing.T) {
	web, err := os.ReadFile(filepath.Clean(webArtifactPath))
	if err != nil {
		t.Fatalf("web 아티팩트 읽기 실패(%s): %v", webArtifactPath, err)
	}
	if string(web) != string(ontologyToolsSchemaJSON) {
		t.Fatalf("계약 drift: web 아티팩트 != Go embed 사본.\n" +
			"레지스트리(ontologyTools.ts) 변경 시 web 아티팩트를 재생성하고 " +
			"backend/internal/server/ontology_tools_schema.json 으로 복사하세요.")
	}
}

// embed 사본이 정상 파싱되고, 계약이 read-only(mutating 동사 없음)이며 온톨로지 4종 + K8s 4종(IMP-91)을 담는지.
func TestMCP_OntologyContract_ReadOnlyShape(t *testing.T) {
	specs := loadOntologyToolSpecs()
	want := map[string]bool{
		"query_objects": false, "traverse_links": false, "get_object": false, "get_object_metrics": false,
		// IMP-91 — read-only Kubernetes 조회 tool(list/get/describe; mutating verb 없음).
		"list_pods": false, "list_nodes": false, "get_events": false, "describe_deployment": false,
		// IMP-98 — 복합 진단 read-only tool(coarse-grained; buildIncidentEvidence seam 노출, mutating verb 없음).
		"get_incident_context": false, "get_pod_diagnostics": false,
		// IMP-106 — 어시스트 컨텍스트 read-only TOOL(동적 per-turn 상태; query verb, mutating 없음).
		"get_screen_context": false,
	}
	for _, s := range specs {
		if s.InputSchema == nil {
			t.Errorf("tool %q inputSchema 파싱 실패(nil)", s.Name)
		}
		if s.InputSchema != nil && s.InputSchema.Type != "object" {
			t.Errorf("tool %q inputSchema type 은 object 여야 함: %q", s.Name, s.InputSchema.Type)
		}
		if _, ok := want[s.Name]; ok {
			want[s.Name] = true
		}
		// **안전**: mutating 성격 이름이 계약에 새어들면 실패(auto-callable mutation 없음).
		n := strings.ToLower(s.Name)
		for _, verb := range []string{"create", "update", "delete", "set", "write", "patch", "scale", "restart", "drain", "cordon", "resolve", "invoke", "apply"} {
			if strings.Contains(n, verb) {
				t.Errorf("계약에 mutating 성격 tool 이 있음(read-only 위반): %q", s.Name)
			}
		}
	}
	for name, seen := range want {
		if !seen {
			t.Errorf("계약에 read tool %q 가 없음", name)
		}
	}
}

// 수기 라우트(mcp.go) tools/list 가 온톨로지 tool 을 레지스트리에서 파생하는지 — Diagnostics McpPanel 동기 근거.
func TestMCP_ToolsList_IncludesOntology(t *testing.T) {
	rec := postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":7,"method":"tools/list"}`)
	body := rec.Body.String()
	// aggregate + 온톨로지 read tool + K8s read tool(IMP-91) + 복합 진단 tool(IMP-98)이 모두 노출(합집합).
	for _, name := range []string{"groupby_metric", "query_objects", "traverse_links", "get_object", "get_object_metrics", "list_pods", "list_nodes", "get_events", "describe_deployment", "get_incident_context", "get_pod_diagnostics", "get_screen_context"} {
		if !strings.Contains(body, `"`+name+`"`) {
			t.Errorf("tools/list 에 %q 가 없음: %s", name, body)
		}
	}
}

// fabrix://ontology/schema 리소스가 노출·읽기되는지(Object/Link/Action 타입 카탈로그).
func TestMCP_OntologySchemaResource(t *testing.T) {
	// list 에 등장.
	rec := postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":8,"method":"resources/list"}`)
	if !strings.Contains(rec.Body.String(), "fabrix://ontology/schema") {
		t.Errorf("resources/list 에 fabrix://ontology/schema 가 없음: %s", rec.Body.String())
	}
	// read → Object/Link 타입 이름 포함.
	rec = postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":9,"method":"resources/read","params":{"uri":"fabrix://ontology/schema"}}`)
	body := rec.Body.String()
	for _, tok := range []string{"objectTypes", "GpuDevice", "linkKinds", "runsOn"} {
		if !strings.Contains(body, tok) {
			t.Errorf("ontology/schema 리소스에 %q 가 없음: %s", tok, body)
		}
	}
}

// IMP-106 — 어시스트 resource template(glossary://·widget://)이 templates/list 에 노출·read 로 해석되는지.
func TestMCP_AssistResourceTemplates(t *testing.T) {
	// templates/list 에 glossary://·widget:// template.
	rec := postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":10,"method":"resources/templates/list"}`)
	body := rec.Body.String()
	for _, tok := range []string{"glossary://{term}", "widget://{id}"} {
		if !strings.Contains(body, tok) {
			t.Errorf("resources/templates/list 에 %q 가 없음: %s", tok, body)
		}
	}

	// glossary://ttft read → 정의 텍스트(key 해석).
	rec = postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":11,"method":"resources/read","params":{"uri":"glossary://ttft"}}`)
	body = rec.Body.String()
	if !strings.Contains(body, "TTFT") {
		t.Errorf("glossary://ttft read 에 정의가 없음: %s", body)
	}

	// glossary alias 해석(대소문자 무시) — "p95" alias 등도 통과.
	rec = postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":12,"method":"resources/read","params":{"uri":"glossary://95th percentile"}}`)
	if !strings.Contains(rec.Body.String(), "p95") && !strings.Contains(rec.Body.String(), "95") {
		t.Errorf("glossary alias 해석 실패: %s", rec.Body.String())
	}

	// widget://dashboard.gpu read → 메타.
	rec = postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":13,"method":"resources/read","params":{"uri":"widget://dashboard.gpu"}}`)
	if !strings.Contains(rec.Body.String(), "whatItShows") {
		t.Errorf("widget://dashboard.gpu read 에 메타가 없음: %s", rec.Body.String())
	}

	// 미지 term → not-found(환각 금지), 에러 아님(명시 페이로드).
	rec = postMCP(t, mcpHandlerCapOn(), `{"jsonrpc":"2.0","id":14,"method":"resources/read","params":{"uri":"glossary://없는용어xyz"}}`)
	if !strings.Contains(rec.Body.String(), "선언된 용어 없음") {
		t.Errorf("미지 glossary term 에 not-found 페이로드가 없음: %s", rec.Body.String())
	}
}
