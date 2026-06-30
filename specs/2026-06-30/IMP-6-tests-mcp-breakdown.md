# 기능: mcp.go(JSON-RPC 디스패치) + breakdown outliers 로직 테스트 추가 (IMP-6)

> 출처: evolve/IMPROVEMENTS.md IMP-6 (code · medium · M · high)

## 목적
최근 추가된 `mcp.go`(JSON-RPC 디스패치)와 `outliers()`(임계치 위반 추출)에 테스트가 0건.
저장소는 테스트 습관(range_test.go·reconfigure_test.go)이 있는데 핵심 분기가 미커버 → 회귀 위험.

## 요구사항
- `backend/internal/server/mcp_dispatch_test.go`: parse error(`-32700`), 미지원 method(`-32601`),
  `notifications/*`→202, `resources/list`, `resources/read`(정상 + 미지원 URI `-32602`).
- `backend/internal/server/breakdown_test.go`: `outliers()` 가 카탈로그 임계치 위반 행만 사유와 함께
  사유 많은 순으로 반환(LowerBetter `WarnAbove` / !LowerBetter `WarnBelow` 양방향),
  `cache_hit_rate=0`(무데이터)은 위반으로 치지 않음(`v>0` 가드).

## 변경 위치
- `backend/internal/server/mcp_dispatch_test.go` (신규)
- `backend/internal/server/breakdown_test.go` (신규)
- 헬퍼 `newTestServer`/`postMCP` 는 IMP-2 의 `mcp_test.go` 재사용(동일 패키지).

## 테스트 케이스
- 위 요구사항이 곧 케이스. `tools/call` 실제 실행 검증은 dashboard mock 이 필요 → 후속(IMP-7 이후 고려).

## 의존성
- 없음(표준 `testing`/`net/http/httptest`).

## 비고
- 순수 테스트 추가 — 프로덕션 코드 무변경, 회귀 가드만 강화.
