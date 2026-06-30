# 기능: 이상강조·서식 로직 프론트/백 통일 (IMP-7)

> 출처: evolve/IMPROVEMENTS.md IMP-7 (code · medium · M · high)

## 목적
임계 위반 판정이 두 곳에 따로 산다: 프론트 `isWarn`(절대 + 상대 median*1.6) vs 백엔드 `outliers`(절대만)
→ UI 셀 강조와 MCP `top_outliers` 결과가 어긋날 수 있음. 단위 서식 함수도 페이지마다 흩어짐.

## 요구사항
- **백엔드를 이상 판정 단일 출처로**: `domain.AnnotateWarnings`(절대 `WarnAbove/WarnBelow` + 상대
  median*1.6 통합 규칙)가 행별 `warn`/`warn_keys`/`warn_reasons` 를 채운다.
  `handleMetricsBreakdown` 와 `mcp.go`(groupby_metric·top_outliers)가 이를 호출하고,
  `outliers()` 는 annotate 된 행만 필터(중복 규칙 제거).
- **프론트는 소비만**: `row.warn_keys` 로 셀 강조. 백엔드 미제공 시(프론트 mock) 기존 `isWarn` 폴백.
- **서식**: `formatMetric(unit, v)` 공용 util 추출(`web/src/utils/format.ts`), DimensionBreakdown 적용
  (Usage 등 타 페이지는 후속).

## 변경 위치
- backend: `domain/breakdown.go`(규칙+필드), `server/mcp.go`(outliers/annotate), `server/dashboard.go`(handler annotate)
- frontend: `api/types.ts`, `components/DimensionBreakdown.tsx`, `utils/format.ts`(신규)

## 테스트 케이스
- `domain/breakdown_test.go`: AnnotateWarnings — 절대 임계(TTFT>500)·상대(median*1.6)·cache<0.5,
  cache=0 가드, 위반 없는 행 warn=false.
- `server/breakdown_test.go`: outliers() 는 annotate 된 warn 행만 사유와 함께 반환(사유 많은 순).

## 의존성
- 없음(표준 fmt/sort). 신규 프론트 의존성 없음.

## 비고
- Go↔TS 코드 직접 공유는 불가 → "단일 출처" = **백엔드 권위 + 프론트 소비**. 실데이터에서의
  UI↔MCP 불일치 해소가 핵심 가치(IMP-1 드릴다운·MCP top_outliers 와도 정합).
