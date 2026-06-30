# 기능: 정렬 가능한 표 헤더 키보드 접근성 (IMP-3, WCAG 2.1.1)

> 출처: evolve/IMPROVEMENTS.md IMP-3 (ux · medium · S · high)

## 목적
DimensionBreakdown 정렬 헤더가 `role="button"` + onClick 만 → tabIndex/onKeyDown 없어 키보드로
조작 불가(WCAG 2.1.1 위반). 정렬 방향 토글도 없음(내림차순 고정). 활성 정렬 강조가 ' ↓' 글자뿐.

## 요구사항
- 헤더 텍스트를 네이티브 `<button type="button">` 으로(키보드/포커스/역할 무료). th 의 role="button" 제거.
- 현재 정렬 컬럼 th 에만 `aria-sort="ascending|descending"`. 나머지는 미설정.
- 같은 컬럼 재클릭 → 방향 토글(sortDir 상태). 다른 컬럼 → 그 컬럼 내림차순.
- 시각 화살표 ▲/▼(aria-hidden) 를 활성 컬럼에. `aria-live="polite"` sr-only 영역에 "정렬 기준 …, 오름/내림차순".
- CSS: `.th-sort` 버튼 리셋 + :hover 밑줄 + :focus-visible 아웃라인 + active 컬럼 강조.

## 변경 위치
- `web/src/components/DimensionBreakdown.tsx`, `web/src/index.css`

## 테스트 케이스
- tsc 통과. 시각/AT QA(앱 구동): Tab 으로 헤더 포커스, Enter/Space 로 정렬·토글, VoiceOver 가 aria-sort/live 읽음.

## 의존성
- 없음.

## 비고
- 행 드릴다운 키보드 접근(tr)·target-size(24px)는 minor follow-up. 본 스펙은 정렬 헤더 키보드 조작(주요 위반) 집중.
