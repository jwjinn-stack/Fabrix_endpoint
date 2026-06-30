# 기능: StatCard ⓘ·Delta 접근성 — InfoTip 전면 전환 + InfoTip 하드닝

## 목적
IMP-4(done)가 만든 무의존 `InfoTip` toggletip 이 DimensionBreakdown 에만 적용되어, 운영자가 가장 먼저 보는 대시보드 StatCard 의 ⓘ(메트릭 의미)·Delta('전기간 대비 …%')가 아직 native `title=` 에 머묾 — 키보드 포커스 미표시·터치 미표시로 WCAG 1.4.13 갭이 핵심 화면에서 재현. 화면 단위로 완결한다.

## 요구사항 / 함수 시그니처
- **InfoTip 하드닝**(`InfoTip.tsx`): 버블 `role="tooltip"` → `role="status"` 라이브 영역. 라이브 영역을 항상 DOM 에 두고 열릴 때 내용을 채워 SR 이 클릭 시 실제 announce(Inclusive Components). DimensionBreakdown 에도 전파.
- **StatCard**(`StatCard.tsx`): (1) `<span className="info" title={info}>ⓘ</span>` → `<InfoTip>{info}</InfoTip>`. (2) Delta `title=` 제거 → 방향+크기 말로 풀어쓴 `aria-label`(예: `전기간 대비 +3.2% 개선`), ▲▼·수치는 `aria-hidden`.
- **잔존 안티패턴 일괄 전환**: 코드베이스의 `<span className="info" title="…">ⓘ</span>` 24곳(컴포넌트+페이지) 전부 `<InfoTip>…</InfoTip>` 로. 삼항 title(Usage)·중첩(LatencyPanel)은 수동. 이미 라벨된 버튼(⟳ 등)의 redundant title= 는 보존.
- 무의존(in-house InfoTip) 유지.

## 테스트 케이스
- normal: ⓘ 키보드 포커스 가능(button), Enter/Space 로 토글, Esc·바깥클릭 닫힘.
- a11y: 열릴 때 role=status 로 내용 announce. Delta 가 aria-label 로 방향+크기 읽힘.
- visual: 대시보드 StatCard ⓘ·기타 화면 ⓘ 가 카드 헤더에서 깨지지 않음(시각 QA, 앱 구동).
- regression: tsc + vite build 통과, className="info" 잔존 0.

## 출력 위치
- `web/src/components/InfoTip.tsx`, `web/src/components/StatCard.tsx`, +info-span 보유 22개 파일.

## 의존성
- 없음.
