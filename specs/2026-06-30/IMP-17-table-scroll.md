# 기능: 넓은 데이터 표 .table-scroll 일관 래핑

## 목적
`usage-table` 셀은 white-space:nowrap 라 컬럼이 많으면 카드를 넘긴다. 페이지가 가로로 밀리면 안 된다는 자체 반응형 규칙이 있는데 `.table-scroll`(+sticky-first)로 감싼 곳은 Keys 한 곳뿐 — 다른 표 페이지(Usage/Guard/Settings/Traffic/Gpu/Playground/Sessions/Traces/Endpoints + 컴포넌트)는 래퍼 없이 가로 오버플로 위험.

## 요구사항
- 미래핑 `usage-table`/`span-attr-table` 을 `<div className="table-scroll" tabIndex={0} role="region" aria-label="…">` 로 감싼다(이미 정의된 클래스 재사용 — 새 CSS 불필요).
- 스크롤 컨테이너에 tabindex=0 + aria-label 부여(키보드 스크롤·SR 인지, WCAG).
- 표가 카드를 넘칠 때 페이지가 아니라 표만 가로 스크롤.
- sticky-first(첫 식별자 컬럼 고정)는 시각 리스크가 있어 이번 범위에서 제외(follow-up).

## 테스트 케이스
- visual(좁은 폭 900px): 표 페이지 가로 오버플로 0(documentElement.scrollWidth == clientWidth).
- a11y: 래퍼가 role=region + tabindex=0 + aria-label 보유.
- regression: tsc·build 통과, 표 렌더 정상·콘솔 에러 0.

## 출력 위치
- `web/src/pages/{Usage,Guard,Settings,Traffic,Gpu,Playground,Sessions,Traces,Endpoints}.tsx`, `web/src/components/{DimensionBreakdown,GuardOverview,MaskingPolicy}.tsx`.

## 의존성
- 없음(기존 .table-scroll 클래스 재사용).
