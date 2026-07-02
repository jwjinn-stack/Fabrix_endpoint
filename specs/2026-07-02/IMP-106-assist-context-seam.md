# IMP-106 — read-only assist context seam (glossary/widget = RESOURCE, get_screen_context = TOOL)

- **Type**: code (sev=medium, effort=M)
- **Branch**: feature/evolve-cycle8-assist
- **Date**: 2026-07-02

## 배경 / 문제

현행 MCP 표면은 온톨로지·K8s **조회 tool**(query_objects·get_incident_context 등, IMP-73/91/98)뿐이다.
어시스트(IMP-103/104)가 "현재 라우트 / 열린 객체 / 선택 영역 / 관련 용어"를 **근거로 받아** 답을
접지하려면 매번 ad-hoc 로 화면 상태를 긁고, 용어/위젯 설명을 tool-call 로 태워야 한다.

IMP-108(GLOSSARY 29 term)·IMP-105(WIDGET_META + getScreenContext/describeWidget)로 데이터 원천은
이미 선언적으로 존재한다. 남은 것은 그 데이터를 **MCP primitive taxonomy 에 맞게** 어시스트가
소비할 seam 이다.

## MCP primitive 분할(핵심 설계 — 전부 tool 로 만들지 말 것)

MCP spec 의 primitive taxonomy(model-controlled TOOLS = 동적/파라미터화; application-controlled
RESOURCES = named·addressable·read-only·side-effect 없음)를 그대로 따른다:

1. **`explain_term` → RESOURCE template `glossary://{term}`** — IMP-108 GLOSSARY 파생.
   정적/느린변화·named·read-only 참조데이터 → 교과서적 RESOURCE. tool-call 비용 0, addressable, pinnable.
2. **`describe_widget` → RESOURCE template `widget://{id}`** — IMP-105 WIDGET_META 파생. 위와 동일.
3. **`get_screen_context` → read-only TOOL** — per-turn UI 상태(route / open object / facet / selection +
   그 화면에 마운트된 widget id 들)는 동적이라 정당한 read-only TOOL. **이 하나만 tool 이어야 한다.**

## 단일 출처(IMP-73 패턴 재사용)

- tool 스키마 + resource template 정의 + resolved 콘텐츠 모두 **하나의 TS 레지스트리**에서 파생한다:
  - `ASSIST_TOOL_REGISTRY`(get_screen_context) → 기존 `ONTOLOGY_TOOL_REGISTRY`/`K8S_TOOL_REGISTRY` 와
    함께 `buildOntologyToolsArtifact()` 가 하나의 `ontology-tools.schema.json` 으로 emit.
  - `ASSIST_RESOURCE_TEMPLATES`(glossary://·widget://) + 해석 콘텐츠 → 같은 아티팩트의
    `resourceTemplates` / `resourceContents` 필드로 emit.
- Go 는 이 아티팩트를 `go:embed` 로 로드해 tools/list · resources/templates/list · resources/read 에
  그대로 노출한다(수기 미러 금지). 3-way drift canary(web emit.test ↔ 아티팩트 ↔ Go embed)가
  갈라짐을 CI 로 강제한다.

## read-only / 보안

- `get_screen_context` 는 조회 동사(query verb) → `assertReadOnly()`(ASSIST_TOOL_REGISTRY 포함)가
  mutating 성격 이름 유입을 런타임/테스트로 차단. Go contract test 도 mutating verb 부재 강제.
- resource template 은 정의상 read-only(side-effect 없음). resolvers 는 GLOSSARY/WIDGET_META 를
  순수 조회만 한다.
- **injection surface 취급**: resource/tool description 은 정적 선언 문자열만 쓴다. 사용자 입력·객체
  내용을 description 이나 resolved 콘텐츠 텍스트에 **보간하지 않는다**(prompt-injection 방어).
  `glossary://{term}` 해석은 lookupTerm(key/alias 완전일치)만 — 미지 term 은 "선언된 용어 없음"(환각 금지).
  `widget://{id}` 해석은 describeWidget — 미지 id 는 "선언된 메타 없음".
- capability/profile 게이팅(IMP-2): MCP 라우트 자체가 Dashboard cap 게이팅(cap-off = 라우트 미등록 404).
  어시스트 seam 은 그 라우트 위에 얹혀 동일 게이트를 상속한다.

## 변경 파일

- `web/src/actions/ontologyTools.ts` — `ASSIST_TOOL_REGISTRY`(get_screen_context) 추가,
  `assertReadOnly` 로드-타임 강제, `buildOntologyToolsArtifact` 에 병합, `ASSIST_RESOURCE_TEMPLATES`
  + resolved 콘텐츠를 아티팩트 `resourceTemplates`/`resourceContents` 로 emit.
- `web/src/actions/assistContext.ts`(신규) — glossary://·widget:// URI 파서 + resolver(단일 출처),
  get_screen_context 실행부(getScreenContext + 동적 selection/facet/objectId 패스스루).
- `web/src/actions/ontology-tools.schema.json` — 재생성(tool + resourceTemplates + resourceContents).
- `backend/internal/server/ontology_tools_schema.json` — 아티팩트 byte 동일 복사.
- `backend/internal/server/mcp_ontology.go` — resourceTemplates/resourceContents 로더 추가.
- `backend/internal/server/mcp.go` — resources/templates/list 메서드 + resources/read 확장
  (glossary://·widget://), tools/list 는 자동(ontologyToolListEntries).
- `web/src/api/mock.ts` — resources/templates/list + resources/read(glossary://·widget://) mock.
- `web/src/api/client.ts` — mcpListResourceTemplates / mcpReadResource 헬퍼(어시스트 소비용).

## 테스트 케이스

TS(vitest):
- `get_screen_context` 가 ASSIST_TOOL_REGISTRY 에 등록·read-only(assertReadOnly 통과)·
  additionalProperties:false·route enum 이 Page 와 정합.
- get_screen_context 실행부가 route 의 on-screen widget id + 동적 route/objectId/facet/selection 을 반환
  (앱 전체 덤프 금지 — SCREEN_WIDGETS 스코프).
- `glossary://{term}` resolver: key/alias 완전일치 해석, 미지 term → found:false(환각 금지).
- `widget://{id}` resolver: describeWidget 위임, 미지 id → "선언된 메타 없음".
- emit == committed(byte 동일) — tool + resourceTemplates + resourceContents 포함(drift canary).
- 결정성 — emit 두 번 동일.
- mock resources/templates/list 에 glossary://·widget:// template 노출.
- mock resources/read(glossary://ttft) 가 정의 텍스트 반환.
- description injection-safe: template/tool description 에 사용자 보간 없음(정적 문자열).

Go(go test):
- 계약 drift 없음(web 아티팩트 == Go embed) — 확장된 아티팩트로도 byte 동일.
- tools/list 에 get_screen_context 노출 + mutating verb 여전히 0(read-only shape).
- resources/templates/list 에 glossary://·widget:// template.
- resources/read(glossary://<term>, widget://<id>) 해석 + 미지 → 안전 응답.

## 완료 기준

- `cd web && npm run test` 전부 통과(신규 케이스 + IMP-88 isolation + drift canary emit==committed).
- `cd backend && go test ./...` 전부 통과(drift canary + read-only shape).
- `npm run build`(tsc) + `go build ./...` 통과.
- IMPROVEMENTS.md IMP-106 Status → done.
