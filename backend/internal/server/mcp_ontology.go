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
