# 기능: 접근 가능한 toggletip(InfoTip) — title 툴팁 대체 (IMP-4, WCAG 1.4.13)

> 출처: evolve/IMPROVEMENTS.md IMP-4 (ux · medium · M · high)

## 목적
ⓘ·메트릭 의미가 네이티브 `title=` 툴팁에만 의존 → 키보드 포커스로 안 뜨고 터치 미표시(WCAG 1.4.13).
ⓘ 자체도 `cursor:help` span 으로 포커스 불가.

## 요구사항 (무의존 in-house — Radix 미도입)
- 재사용 `InfoTip` 컴포넌트(toggletip): 네이티브 `<button>` + 클릭/Enter/Space 토글, Esc·바깥 클릭 닫기,
  `aria-expanded`/`aria-controls`, 본문 `role="tooltip"`.
- DimensionBreakdown 의 ⓘ(차원 분해 도움말)에 적용. `.infotip*` CSS 추가.
- **(follow-up)** 전 페이지 `title=`(34곳)·메트릭 카탈로그 toggletip 마이그레이션은 점진.
  Radix 도입 여부는 `oss-evaluate` deep-dive 후 결정.

## 변경 위치
- `web/src/components/InfoTip.tsx`(신규), `web/src/components/DimensionBreakdown.tsx`, `web/src/index.css`

## 테스트 케이스
- tsc 통과. 시각/AT QA(앱 구동): Tab 으로 ⓘ 포커스 → Enter/Space 열림 → Esc/바깥클릭 닫힘, 터치 동작.

## 의존성
- 없음(미니멀 스택 유지).

## 비고
- IMP-4 의 **패턴(InfoTip) + 핵심 1개 적용**. 광범위 롤아웃은 follow-up.
