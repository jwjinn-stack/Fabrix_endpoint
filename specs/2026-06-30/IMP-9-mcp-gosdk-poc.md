# 기능: JSON-RPC 2.0 MCP 전송을 공식 MCP Go SDK(go-sdk)로 채택 (IMP-9 PoC)

## 목적
현재 `backend/internal/server/mcp.go` 는 JSON-RPC 2.0 봉투(rpcReq/rpcResp/rpcErr),
디스패치(handleMCP), inputSchema, `protocolVersion="2024-11-05"` 하드코딩을 전부 수기로
구현한다. 전송/봉투/스키마 검증 레이어를 공식 `modelcontextprotocol/go-sdk` 로 교체하면
프로토콜 버전 자동 네고, typed tool, inputSchema 자동생성+검증을 SDK 가 책임진다.

이번 PoC 는 채택 순서(adoption order)의 step 1 로 **좁게** 검증한다:
- tool **1개(groupby_metric)만** typed `mcp.AddTool[In,Out]` 로 end-to-end 이전한다.
- 전송은 `mcp.NewStreamableHTTPHandler`(stateless) 를 **별도 PoC 라우트**(`POST /api/v1/mcp/v2`)에
  마운트한다. 기존 `POST /api/v1/mcp`(수기 handleMCP) 는 **그대로 유지**해 회귀 없이 나란히 비교.
- 비즈니스 로직(s.dashboard 의 MetricsBreakdown + domain.AnnotateWarnings) 은 그대로 재사용 —
  봉투/전송/검증 레이어만 교체한다.
- read-only 보장: write tool 미등록.

이 PoC 는 HUMAN LIVE VERIFICATION 용이지 완성 마이그레이션이 아니다. 나머지 3 tool / 2 resource
이전, 수기 mcp.go 삭제는 사람이 이 PoC 를 검증한 뒤의 후속 작업이다.

## 요구사항
1. `backend/go.mod` 에 `github.com/modelcontextprotocol/go-sdk` **v1.6.1 정확 핀**(floating/latest 금지).
   `google/jsonschema-go` 는 transitive — 직접 추가하지 않는다. `go mod tidy` 로 go.sum 반영.
2. groupby_metric 를 typed `mcp.AddTool` 로 선언. 입력은 구조체 필드 + jsonschema enum 태그로
   inputSchema 자동생성 + 검증(SDK 가 잘못된 dim 거부 + additionalProperties:false 로 여분 필드 거부).
3. 전송 `mcp.NewStreamableHTTPHandler` 를 stateless 옵션으로 `POST /api/v1/mcp/v2` 에 마운트.
   기존 라우트와 **동일한 Dashboard capability 게이트**(IMP-2) 안에 등록 — 대시보드를 못 보면 MCP v2 도
   못 본다(미등록=404=실제 차단). protocolVersion 하드코딩 제거(SDK 자동 네고)는 v2 라우트에서만.
4. 핸들러 내부는 기존 `metricsBreakdownSource` 인터페이스 + `domain.AnnotateWarnings` 재사용 —
   수기 라우트와 동일 데이터 경로.

### 스키마 함정 검증 노트(코드 주석으로 남김 — PoC 구현 중 실측 확인)
- jsonschema-go 는 객체 스키마에 `additionalProperties:false`(SDK #892) → 봉투에 없는 여분 필드 거부.
  SDK 서버는 raw arguments(map)를 resolved 스키마로 검증하므로 typed unmarshal 전에 거부된다.
- `format`/regex back-reference 는 미적용 → `enum` 사용.
- **함정 실측**: jsonschema-go 의 `jsonschema:"..."` 구조체 태그는 **description 으로만** 쓰이고
  enum 은 태그로 못 넘긴다(태그는 "WORD=" 로 시작 금지). 따라서 enum 제약은 명시적
  `*jsonschema.Schema`(InputSchema 필드)로 선언해 AddTool 에 넘겨야 한다.
- **함정 실측**: SDK 는 스키마 검증 실패를 **tool 에러**(`CallToolResult.IsError=true`)로 패킹한다
  (전송에 따라 Go 에러로도 표면화). 프로토콜 에러가 아니므로 테스트는 IsError 또는 Go 에러 둘 다 본다.

## 함수 시그니처
```go
// 입력: dim/range 를 enum 태그로 — SDK 가 inputSchema 자동생성 + 검증(additionalProperties:false).
type groupbyMetricIn struct {
    Dim   string `json:"dim,omitempty"   jsonschema:"enum=model,enum=endpoint,enum=namespace"`
    Range string `json:"range,omitempty" jsonschema:"enum=1h,enum=6h,enum=24h,enum=7d"`
}

// 출력: 수기 라우트의 structuredContent 와 동형(domain.MetricsBreakdown).
type groupbyMetricOut struct {
    domain.MetricsBreakdown
}

// mcpV2Server 는 groupby_metric 1개만 등록한 SDK MCP 서버를 만든다(read-only=write tool 없음).
func (s *Server) mcpV2Server() *mcp.Server

// groupby_metric typed 핸들러 — 기존 metricsBreakdownSource + AnnotateWarnings 재사용.
func (s *Server) groupbyMetricV2(ctx context.Context, req *mcp.CallToolRequest, in groupbyMetricIn) (*mcp.CallToolResult, groupbyMetricOut, error)

// 라우트 마운트(server.go, Dashboard cap 게이트 안):
//   mux.Handle("POST /api/v1/mcp/v2", mcp.NewStreamableHTTPHandler(
//       func(*http.Request) *mcp.Server { return s.mcpV2Server() },
//       &mcp.StreamableHTTPOptions{Stateless: true}))
```

## 테스트 케이스
1. **패리티**: SDK v2 라우트의 groupby_metric 결과(structuredContent)가 수기 라우트와 동일한
   비즈니스 데이터 경로를 탄다 — dimension/label/row key 집합/행 수가 일치(wave 기반 float 값은
   호출 시각 의존이라 구조 필드로 비교).
2. **잘못된 dim 거부**: `dim:"bogus"` → SDK 스키마(enum) 가 거부(에러 응답).
3. **여분 필드 거부**: 봉투에 없는 필드(`extra:"x"`) → additionalProperties:false 로 거부.
4. **read-only**: tools/list 에 write tool 이 하나도 없다(groupby_metric 만, 미등록=불가).

## 출력 위치
- `backend/internal/server/mcp_v2.go` (신규 — SDK typed tool + 서버 빌더)
- `backend/internal/server/server.go` (Dashboard cap 게이트 안에 v2 라우트 1줄 추가)
- `backend/internal/server/mcp_v2_test.go` (신규 — 위 4 케이스)
- `backend/go.mod` / `backend/go.sum` (의존성 핀)
- 기존 `backend/internal/server/mcp.go` 는 **무수정**.

## 의존성
- `github.com/modelcontextprotocol/go-sdk` **v1.6.1**(정확 핀). `google/jsonschema-go` 는 transitive.
- HUMAN GATE(이 PoC 가 풀 채택을 여는 조건):
  - 라이선스/공급망 사인오프 — Apache-2.0/MIT 등 permissive 확인 + SCA allowlist 등록,
    핀 버전이 알려진 침해 범위 아님 확인.
  - MCP Inspector 라이브 검증 — 실제 MCP 클라이언트로 v2 라우트 initialize/tools/call 확인.
