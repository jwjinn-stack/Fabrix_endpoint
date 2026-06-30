# 기능: 로딩 상태 일관화 (페이지 단위 Skeleton)

## 목적
초기 로딩 표시가 페이지마다 제각각 — 다수는 Skeleton(Dashboard/Usage/Traces 등), 일부는 평문 '…불러오는 중…'(Keys·Settings 사용자·Models). 일관된 perceived-performance 위해 페이지 단위 로더를 Skeleton 으로 통일.

## 요구사항
- Keys·Settings(사용자)·Models 의 평문 `<div className="state">…불러오는 중…</div>` 제거.
- 카드 본문에서 `loading && empty` → 테이블 페이지는 `<SkeletonRows>`, 카드 그리드(Models)는 `<SkeletonCards>`. empty/table 분기 앞에 로딩 분기 추가.
- 상세 패널 인라인 로더(Gpu 시계열·Sessions 턴)는 소규모 2차 로드라 유지(follow-up).

## 테스트 케이스
- 로딩 중: 평문 텍스트 대신 Skeleton 표시, empty 오인 없음.
- 로드 후: 데이터 정상(회귀 없음).
- gate: tsc·lint·test green.

## 출력 위치
- web/src/pages/{Keys,Settings,Models}.tsx (+Skeleton import).

## 의존성
- 기존 components/Skeleton.tsx (SkeletonRows/SkeletonCards).
