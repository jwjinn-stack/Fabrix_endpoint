# IMP-34 — 트레이스 스팬 워터폴·상세 패널 시각 완성도

## 목적
Langfuse/Phoenix 대비 얇은 스팬 워터폴을 시각적으로 완성도 있게 재구성한다.
- 시간축 정렬 막대(상대 offset + duration 비례) + 깊이 들여쓰기
- 호버 readout(self/total ms, 토큰)
- 타입 색을 응집된 범례 칩으로
- 선택 스팬 ↔ 상세 패널 양방향 하이라이트

라이트 + 스틸블루, NO neon, ZERO new runtime deps.

## 요구사항
1. **시간축 정렬**: 각 span 막대의 left% = start_ms/total, width% = duration_ms/total (최소 폭 보장).
   타임라인 상단에 0 / mid / total 시간축 눈금.
2. **깊이 들여쓰기**: 타임라인에서도 parent 체인 깊이만큼 라벨을 들여쓰기(트리 계층 가시화).
3. **호버 readout**: span 막대/행 호버 시 DOM 툴팁으로 name·kind·start(+offset)·self ms·total(dur) ms·토큰(있으면) 표시.
   self = duration − 직속 자식 duration 합(클램프 ≥0). 값은 모두 React 텍스트(이스케이프).
4. **응집 범례 칩**: 등장한 kind 만 색 칩 + 라벨 + 개수로 표시.
5. **양방향 하이라이트**: openSpan(선택 span) ↔ 막대/행 강조(`is-active`). 호버 span 도 약하게 강조.

## 함수 시그니처 (web/src/components/spanWaterfall.ts — 순수, 테스트 대상)
- `spanGeometry(span, total): { leftPct, widthPct }` — offset→x%, duration→width% (clamp 0..100, min width).
- `spanDepth(span, byId): number` — parent 체인 깊이(사이클 가드). Traces.tsx 의 기존 로직 이관.
- `selfMs(span, spans): number` — duration − 직속 자식 duration 합, ≥0 클램프.
- `kindCounts(spans): { kind, count }[]` — 등장 순서 보존 kind별 개수(범례 칩용).

## 테스트 (web/src/components/spanWaterfall.test.ts)
- spanGeometry: offset/duration → left/width %, 클램프, 최소폭.
- spanDepth: 평면 0, 1단계, 다단계, 사이클 가드.
- selfMs: 자식 없음 = duration, 자식 있으면 차감, 음수 클램프.
- kindCounts: 등장 순서·개수.

## 출력 위치
- web/src/components/spanWaterfall.ts (신규 순수 헬퍼)
- web/src/components/spanWaterfall.test.ts (신규 테스트)
- web/src/pages/Traces.tsx (타임라인 재구성 + 호버 readout + 범례 칩 + 하이라이트)
- web/src/index.css (시간축·툴팁·하이라이트·범례칩 스타일)

## 의존성
없음 (ZERO new runtime deps). 기존 토큰(--sp/--fs/--text/--border/스틸블루) 사용.
