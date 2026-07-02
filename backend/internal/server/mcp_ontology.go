package server

// 온톨로지 read tool 계약 로더(IMP-73) — 프론트/백엔드 스키마 단일화의 백엔드 쪽.
//
// tool 스키마의 단일 출처는 프론트 TS 레지스트리(web/src/actions/ontologyTools.ts)이고,
// 거기서 emit 한 committed 아티팩트(web/src/actions/ontology-tools.schema.json)를 이 패키지에
// byte 동일 복제(ontology_tools_schema.json)로 두고 go:embed 로 로드한다.
// → Go 는 스키마를 손으로 미러하지 않는다(mcp_v2.go 의 groupby_metric 처럼 jsonschema 구조체를
//   직접 쓰지 않고, LLM 계약을 프론트와 하나로 묶는다). drift 는 mcp_contract_test.go 가 잡는다.
//
// jsonschema-go 의 Schema 는 커스텀 (Un)MarshalJSON 을 가져 additionalProperties:false·enum·required 를
// 그대로 왕복한다 → 아티팩트 JSON 을 *jsonschema.Schema 로 언마샬하면 그대로 AddTool 에 먹일 수 있다.
// SDK 는 이 스키마로 핸들러 진입 전 입력을 검증한다(enum 밖·여분 필드·필수 누락 거부 = LLM 방어).

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
)

// ontologyToolsSchemaJSON 은 프론트 emit 아티팩트의 byte 동일 복제(계약 단일 출처).
// 갱신 규약: web 레지스트리 변경 → web 아티팩트 재생성 → 이 파일로 복사. mcp_contract_test 가 동일 강제.
//
//go:embed ontology_tools_schema.json
var ontologyToolsSchemaJSON []byte

// ontologyToolSpec — 아티팩트 한 tool 항목(name/description/inputSchema). inputSchema 는 jsonschema-go 로 파싱.
type ontologyToolSpec struct {
	Name        string             `json:"name"`
	Description string             `json:"description"`
	InputSchema *jsonschema.Schema `json:"inputSchema"`
}

type ontologyToolsArtifact struct {
	Version int                `json:"version"`
	Tools   []ontologyToolSpec `json:"tools"`
	// IMP-106 — 어시스트 RESOURCE 축(glossary://·widget:// 템플릿 + 해석 콘텐츠). 프론트 단일 출처 파생.
	ResourceTemplates []assistResourceTemplate `json:"resourceTemplates"`
	ResourceContents  assistResourceContents   `json:"resourceContents"`
}

// assistResourceTemplate — glossary://{term}·widget://{id} MCP resource template(정적 메타).
type assistResourceTemplate struct {
	URITemplate string `json:"uriTemplate"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MimeType    string `json:"mimeType"`
}

// assistResourceContents — resources/read 해석용 정적 콘텐츠(프론트 emit 단일 출처 — Go 중복 선언 없음).
// glossary: key → term(map 그대로 왕복). widgets: id → 얇은 메타. json.RawMessage 로 원본 보존.
type assistResourceContents struct {
	Glossary map[string]json.RawMessage `json:"glossary"`
	Widgets  map[string]json.RawMessage `json:"widgets"`
}

// loadOntologyToolSpecs 는 embed 된 계약을 파싱해 name 순 정렬로 반환한다(결정적).
// 파싱 실패는 프로그래머 에러(빌드에 아티팩트가 동봉되므로) — 명확히 패닉.
func loadOntologyToolSpecs() []ontologyToolSpec {
	var art ontologyToolsArtifact
	if err := json.Unmarshal(ontologyToolsSchemaJSON, &art); err != nil {
		panic(fmt.Errorf("ontology tool 계약 아티팩트 파싱 실패: %w", err))
	}
	sort.Slice(art.Tools, func(i, j int) bool { return art.Tools[i].Name < art.Tools[j].Name })
	return art.Tools
}

// loadAssistArtifact 는 embed 아티팩트에서 어시스트 resource template + 콘텐츠를 파싱한다(IMP-106).
// 파싱 실패는 프로그래머 에러(빌드에 아티팩트 동봉) — 명확히 패닉.
func loadAssistArtifact() ontologyToolsArtifact {
	var art ontologyToolsArtifact
	if err := json.Unmarshal(ontologyToolsSchemaJSON, &art); err != nil {
		panic(fmt.Errorf("어시스트 resource 아티팩트 파싱 실패: %w", err))
	}
	return art
}

// assistResourceTemplateEntries 는 resources/templates/list 용 map 배열(uriTemplate 순 정렬, 결정적).
func assistResourceTemplateEntries() []map[string]any {
	tmpls := loadAssistArtifact().ResourceTemplates
	sort.Slice(tmpls, func(i, j int) bool { return tmpls[i].URITemplate < tmpls[j].URITemplate })
	out := make([]map[string]any, 0, len(tmpls))
	for _, t := range tmpls {
		out = append(out, map[string]any{
			"uriTemplate": t.URITemplate, "name": t.Name, "description": t.Description, "mimeType": t.MimeType,
		})
	}
	return out
}

// resolveGlossaryResource 는 glossary://{term} 을 해석한다 — key 완전일치 후 alias 완전일치(대소문자 무시).
// 미지 term 은 nil,false(호출부가 "선언된 용어 없음" 처리 — 환각 금지). 사용자 입력 보간 없음(injection-safe).
func resolveGlossaryResource(term string) (json.RawMessage, bool) {
	g := loadAssistArtifact().ResourceContents.Glossary
	q := strings.ToLower(strings.TrimSpace(term))
	if q == "" {
		return nil, false
	}
	// 1) key 완전일치(key 는 이미 소문자 안정 식별자).
	if raw, ok := g[q]; ok {
		return raw, true
	}
	// 2) alias 완전일치(대소문자 무시).
	for _, raw := range g {
		var t struct {
			Aliases []string `json:"aliases"`
		}
		if err := json.Unmarshal(raw, &t); err != nil {
			continue
		}
		for _, a := range t.Aliases {
			if strings.ToLower(a) == q {
				return raw, true
			}
		}
	}
	return nil, false
}

// resolveWidgetResource 는 widget://{id} 를 해석한다 — id 완전일치. 미지 id 는 nil,false("선언된 메타 없음").
func resolveWidgetResource(id string) (json.RawMessage, bool) {
	w := loadAssistArtifact().ResourceContents.Widgets
	if raw, ok := w[strings.TrimSpace(id)]; ok {
		return raw, true
	}
	return nil, false
}

// ontologyToolListEntries 는 mcp.go 수기 tools/list 가 합칠 수 있도록 tool 메타를 map 형태로 반환한다.
// inputSchema 는 아티팩트 원본(map)을 그대로 실어 tools/list JSON 이 프론트 계약과 동일하게 나가게 한다.
func ontologyToolListEntries() []map[string]any {
	// 원본 JSON 에서 inputSchema 를 map 그대로 뽑는다(jsonschema-go 재마샬로 인한 표현 차이 방지).
	var raw struct {
		Tools []struct {
			Name        string          `json:"name"`
			Description string          `json:"description"`
			InputSchema json.RawMessage `json:"inputSchema"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(ontologyToolsSchemaJSON, &raw); err != nil {
		panic(fmt.Errorf("ontology tool 계약 아티팩트 파싱 실패: %w", err))
	}
	sort.Slice(raw.Tools, func(i, j int) bool { return raw.Tools[i].Name < raw.Tools[j].Name })
	out := make([]map[string]any, 0, len(raw.Tools))
	for _, t := range raw.Tools {
		var schema any
		_ = json.Unmarshal(t.InputSchema, &schema)
		out = append(out, map[string]any{
			"name": t.Name, "description": t.Description, "inputSchema": schema,
		})
	}
	return out
}
