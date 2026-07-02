# IMP-86 — MCP 연동 상세 화면 (tools/resources/prompts 스키마·예시·호출 로그·연결 상태)

- **Type**: aesthetic (sev=medium, effort=M) · Direction 5 (MCP in detail)
- **Branch**: feature/evolve-cycle6-ontology-ux
- **Date**: 2026-07-02
- **Area**: `web/src/pages/Diagnostics.tsx`(McpPanel), `web/src/actions/ontologyTools.ts`(레지스트리 단일 출처), `web/src/api/client.ts`(mcpListTools/Resources), 신규 `web/src/components/mcp/*`

## 배경 / 문제
현행 McpPanel(Diagnostics.tsx 383~407행)의 "노출 tool · resource (라이브)" 섹션은 tool/resource
이름+설명을 `dl.diag-detail`(dt/dd)로만 얇게 나열한다. 각 tool 의 **입력 스키마·예시 호출/응답·
연결 상태·prompts** 가 없어 MCP Inspector / Stripe API 콘솔급 상세에 미달한다.

그런데 렌더 재료는 이미 있다: `ONTOLOGY_TOOL_REGISTRY` + `K8S_TOOL_REGISTRY`(ontologyTools.ts)가
tool 마다 name/description/inputSchema(prop별 type·description·enum)를 **단일 출처**로 보유하고,
라이브 `tools/list`(mcpListTools)는 이 레지스트리에서 파생된 목록(+ aggregate 4종)을 반환한다.

## 목표 (Fix)
1. MCP 카탈로그 섹션을 인라인 dt/dd → **전용 상세 뷰**로 승격. 상단 **Tools / Resources / Prompts**
   3-탭(Inspector 3분류). Prompts 는 서버가 노출하지 않으므로 정직한 "해당 없음 / coming soon" 카드.
2. tool 마다 **접이식 카드**(제목 = snake_case name + 연결상태 dot). Stripe식 2열:
   - 좌열 = 설명 + inputSchema 를 **prop 테이블**(name·type·enum·description, required 표시).
   - 우열 = 문법 하이라이트 **예시 JSON-RPC 요청/응답 코드블록**(read-only 서버라 정적 예시부터).
3. **단일 출처 렌더 + drift diff**: 카드 스키마/설명은 레지스트리에서 렌더. 동시에 라이브 tools/list 와
   **diff** 를 표시 — 라이브에만 있고 레지스트리엔 없는 tool(aggregate: inputSchema 미보유)은
   "라이브 전용(스키마 미노출)" 배지, 레지스트리에만 있고 라이브에 없으면 "라이브 미노출" 경고 배지.
   설명 불일치도 표기. = drift canary(3-way 단일화)를 **눈에 보이게**.
4. **read-only 안전**: 조회 tool 은 정적 예시 req/res 를 **먼저** 보여준다. mutating Run 은 절대 없음
   (레지스트리 자체가 assertReadOnly 로 read-only 불변). 이번 범위는 정적 예시까지(선택적 Run 폼은
   구조만 남기되 mutating 금지 원칙 유지 — 정적 예시로 충분).
5. **신규 primitive**(자체 완결, 외부 CDN 금지):
   - `StatusDot` — ok/warn/off 상태 점(steel-blue/green/amber, 네온 금지).
   - `SchemaTable` — inputSchema properties → name·type·enum·description 표(required 표시).
   - `CodeBlock` — 경량 JSON 토크나이저(key/string/number/keyword/punct span) — **eval/DSI 없음**, 텍스트 렌더만.
   - `Accordion` — 접이식 카드(button aria-expanded, reduce-motion 안전).
6. Backend.AI 라이트 + 스틸블루 토큰, 코드블록 엔터프라이즈 모노(`var(--mono)`), 네온 금지.

## 설계
- 신규 `web/src/components/mcp/`:
  - `primitives.tsx` — StatusDot, Accordion, SchemaTable, CodeBlock(자체 JSON 토크나이저 + hi-json span).
  - `McpDetail.tsx` — 3-탭 컨테이너. Tools 탭: 레지스트리(온톨로지+K8s) 카드 + 라이브 diff. Resources 탭:
    라이브 resources/list 카드. Prompts 탭: 정직한 coming-soon 카드.
  - `examples.ts` — 각 tool 의 예시 req/res(JSON-RPC 2.0 tools/call) 결정적 생성(레지스트리 inputSchema 기반).
- Diagnostics.McpPanel: 기존 "노출 tool · resource (라이브)" dt/dd 블록을 `<McpDetail tools resources />` 로 교체.
  로딩/에러/빈 상태는 유지. tools/resources 는 여전히 mcpListTools/mcpListResources 로 라이브 로드.
- diff 계산: 레지스트리 tool 집합(ONTOLOGY+K8S name) vs 라이브 tools name 집합.
  - both → "연결됨"(green dot). registry-only → "라이브 미노출"(amber). live-only → "라이브 전용"(blue, aggregate).

## 테스트 케이스 (web/src/components/mcp/McpDetail.test.tsx)
1. 3-탭(Tools/Resources/Prompts) 렌더 — 탭 클릭 시 해당 패널 표시.
2. tool 카드: 레지스트리 tool(query_objects 등)마다 카드 + snake_case 제목 + 연결상태 dot.
3. 카드 확장 시 SchemaTable(prop name·type·enum·description) + 예시 req/res 코드블록 표시.
4. live-vs-registry diff: 라이브에만 있는 aggregate(list_dimensions)는 "라이브 전용" 배지;
   레지스트리에만 있고 라이브 목록에서 빠진 tool 은 "라이브 미노출" 경고 배지.
5. read-only: 카드에 mutating Run 버튼 없음(정적 예시만). CodeBlock 은 텍스트만(스크립트 실행 없음).
6. Prompts 탭: 서버 미노출 → "해당 없음 / coming soon" 정직 카드.
7. CodeBlock: dangerouslySetInnerHTML 로 신뢰 못 할 내용 주입 없음(토큰 span 만).

## 기존 테스트 유지
- Diagnostics.mcp.test.tsx(IMP-5) — list_dimensions 등 라이브 목록 여전히 렌더(McpDetail 안에서).
- isolation.test.tsx(IMP-88) + ontologyTools.emit.test.ts(drift canary) GREEN 유지 — 레지스트리·아티팩트 불변.
- 보안: CodeBlock 텍스트 렌더 전용(eval/DSI 없음), mutating Run 없음, 시크릿 없음.

## 산출물
- 신규: web/src/components/mcp/{primitives.tsx, McpDetail.tsx, examples.ts, McpDetail.test.tsx}
- 수정: web/src/pages/Diagnostics.tsx(카탈로그 섹션 교체), web/src/index.css(mcp-* 스타일)
- IMPROVEMENTS.md IMP-86 Status → done.
