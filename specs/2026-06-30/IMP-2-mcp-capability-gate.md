# 기능: MCP 엔드포인트(/api/v1/mcp)를 Dashboard capability 게이트 안으로 이동

> 출처: evolve/IMPROVEMENTS.md IMP-2 (code · severity=high · effort=S · confidence=high)
> 생성: build-next 자동 spec · 2026-06-30 · dev 전 수정 가능

## 목적 (Problem)
server.go 의 모든 라우트는 `if can(capability.X)` 로 프로파일별 게이트되는데(Dashboard·Traces·Guard 등),
`POST /api/v1/mcp`(server.go:110) 만 게이트 밖에 **무조건** 등록된다. 그 결과:
1. Dashboard capability 가 꺼진 프로파일에서도 MCP 의 `groupby_metric`/`top_outliers`/
   `summarize_endpoint_health` 가 동일한 `s.dashboard` 데이터를 그대로 반환 → capability 로 막은
   데이터가 MCP 경로로 새어나간다.
2. mcp.go:11 주석은 "observe 프로파일과 정합, read-only" 라고 적었지만 실제로는 어떤
   프로파일/capability 와도 무관하게 항상 켜진다.

observe(읽기전용)/manage 2-프로파일 모델에서 의도와 구현이 어긋난다. server.go:96-97 주석의
"미등록이 실제 차단을 담당한다" 원칙을 MCP 라우트만 위반하고 있다.

## 요구사항 (Fix)
- `mux.HandleFunc("POST /api/v1/mcp", s.handleMCP)` 를 server.go:110 의 무조건 위치에서
  `if can(capability.Dashboard)` 블록 **안으로** 이동한다 (블록 첫 줄 권장). MCP 4개 tool 이
  전부 `s.dashboard` 데이터를 쓰므로 Dashboard cap 이 의미상 정확한 게이트 — "대시보드를 못 보면
  MCP 로도 못 본다".
- 게이트 밖 무조건 등록 라인은 삭제하고, 주석을 "read-only + Dashboard-gated" 로 갱신.
- (후속·범위 밖) 더 세분화가 필요하면 tool 별 capability 매핑 또는 별도 `capability.MCP` 도입 —
  이번 스펙에선 주석으로만 남긴다.

## 변경 위치 (출력 위치 / Area)
- `backend/internal/server/server.go` — line 110 의 MCP 등록을 line 113 `if can(capability.Dashboard)`
  블록 내부로 이동.
- `backend/internal/server/mcp_test.go` — 신규 테스트.

## 함수 시그니처
- 시그니처 변경 없음. `func (s *Server) Handler() http.Handler` 내부의 등록 위치만 이동.

## 테스트 케이스 (mcp_test.go · httptest)
- **normal (Dashboard cap ON)**: Dashboard 포함 `capability.Set` 으로 Server → `Handler()` →
  `POST /api/v1/mcp` body `{"jsonrpc":"2.0","id":1,"method":"initialize"}` → **HTTP 200**,
  JSON-RPC `result.protocolVersion` 존재.
- **gated (Dashboard cap OFF)**: Dashboard 없는 `capability.Set` → `Handler()` →
  `POST /api/v1/mcp` → **HTTP 404**(라우트 미등록 = 실제 차단, 데이터 누출 없음). ← 핵심 회귀 가드
- **method routing 회귀 (cap ON)**: `tools/list` → 200 + tools 4개; 미지원 method → JSON-RPC error `-32601`.
- **bad-input (cap ON)**: 깨진 JSON body → `-32700` parse error(기존 동작 보존).
- 구성: `httptest.NewRecorder` + `s.Handler()`. initialize/tools.list 경로는 `s.dashboard` 불필요 →
  nil 또는 최소 mock 으로 Server 구성 가능.

## 의존성
- 없음. 표준 라이브러리(`net/http`, `net/http/httptest`, `testing`)만. 신규 외부 패키지 없음.

## 비고
- 파괴적 변경 아님 — 접근을 **좁히는**(tightening) 보안 정합 수정. 라우팅 1곳이라 되돌리기 쉬움.
- IMP-5(MCP 발견 UI)와 묶일 때 read-only 배지 + 이 게이트가 함께 가야 정합.
