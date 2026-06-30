# IMP-5 — FABRIX MCP UI 패널 (발견·연결·카탈로그)

## 목적
읽기 전용 FABRIX MCP 서버(`POST /api/v1/mcp`, JSON-RPC 2.0)가 백엔드에 구현돼 있으나
프론트에 진입점이 전혀 없다(웹 코드에 mcp 흔적 0건). 운영자가 (1) 엔드포인트 URL,
(2) 노출되는 tool/resource, (3) 자신의 AI 클라이언트(Claude/Cursor/Vercel)에서 연결하는 방법을
대시보드 안에서 직접 확인할 수 있게 한다.

## 호스트 결정 (Diagnostics 채택)
**연동 상태(Diagnostics) 페이지**에 'AI 연동(MCP)' 패널을 추가한다(Settings 아님).
근거:
- Diagnostics 는 이미 "외부/내부 연동 발견·상태·연결 디버깅" 페이지 — MCP 발견·연결은 같은 멘탈모델.
- Diagnostics 는 observe/manage 양 프로파일 공통(read-only 친화). MCP 도 읽기 전용이므로 정합.
- Settings 는 사용자/자격증명 등 mutating 중심 → read-only 카탈로그와 톤이 어긋남.

## 요구사항
- (a) 엔드포인트 URL(`<origin>/api/v1/mcp`) + 복사 버튼 + "읽기 전용" 배지.
- (b) tool/resource 카탈로그를 서버의 `tools/list` + `resources/list` 에서 **LIVE** 렌더
      (UI 가 백엔드와 드리프트 안 함). 실패/캡오프 시 graceful fallback(아래).
- (c) per-client connect 블록 — 연결 스니펫 + 복사. 클라이언트 탭(Claude Code / Cursor / Vercel/일반).
- (d) 보안/신뢰 노트(읽기 전용·자격증명 없음·사내 네트워크 한정).
- capability 게이트: MCP 는 `dashboard` cap 안에 등록(IMP-2 정합). `can("dashboard")===false` 면
  패널을 "비활성"으로 표기(렌더는 하되 카탈로그/스니펫 숨김) — 발견성은 유지하되 오해 방지.

## TRANSPORT (이 브랜치 상태에 정직)
이 브랜치 백엔드는 bare JSON-RPC over POST `/api/v1/mcp` 만 제공(Streamable HTTP 네이티브
커넥터는 IMP-9 PoC=미머지). 따라서:
- **1순위 = `npx mcp-remote` stdio-bridge 패턴** (모든 클라이언트가 따라하면 실제로 동작).
- 네이티브 Streamable HTTP 커넥터(`claude mcp add --transport http`)는 **"coming soon (IMP-9)"** 로만 표기.

## 함수 시그니처
client.ts:
```ts
export interface McpTool { name: string; description?: string; inputSchema?: unknown }
export interface McpResource { uri: string; name?: string; description?: string; mimeType?: string }
// JSON-RPC POST. method ∈ tools/list | resources/list. cap-off/오류는 throw → 호출부 fallback.
export function mcpListTools(signal?: AbortSignal): Promise<McpTool[]>
export function mcpListResources(signal?: AbortSignal): Promise<McpResource[]>
```
컴포넌트:
```ts
// Diagnostics 내부 컴포넌트. caps(can("dashboard")) 로 게이트.
function McpPanel({ enabled }: { enabled: boolean }): JSX.Element
```

## 테스트 (Vitest/RTL)
- catalog renders from a mocked `tools/list` (4 tool 이름 표시) + `resources/list`.
- cap-off 경로: enabled=false → "비활성" 안내, 카탈로그/스니펫 미표시.
- copy 액션: 엔드포인트 URL·스니펫 복사 → navigator.clipboard.writeText 호출 + 토스트.
- transport note: mcp-remote 가 1순위로 보이고 네이티브는 "coming soon" 으로 표기.

## 출력 위치
- `web/src/api/client.ts` — mcpListTools/mcpListResources + 타입.
- `web/src/api/mock.ts` — `POST /mcp` JSON-RPC mock(tools/list·resources/list).
- `web/src/pages/Diagnostics.tsx` — McpPanel 추가.
- `web/src/pages/Diagnostics.mcp.test.tsx` — 테스트.

## 의존성
없음(zero new runtime dep). 기존 Badge·InfoTip·toast(IMP-29)·client·mock 재사용.

## 보안
- 엔드포인트 URL/스니펫은 비밀 아님. 토큰/키 미렌더.
- JSON-RPC 응답 텍스트는 React 기본 escape 로 렌더, `dangerouslySetInnerHTML` 미사용.
