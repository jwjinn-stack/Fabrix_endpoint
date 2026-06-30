# 기능: 전역 React ErrorBoundary

## 목적
관제 콘솔 전체에 ErrorBoundary가 0개(grep 확인). React 19는 컴포넌트 렌더 throw 시 트리 전체를 언마운트 → 한 위젯(forecast 회귀·span 트리·수치 SVG) 버그가 콘솔 전체 백스크린으로 번진다. 온콜이 '지금 정상인가'를 봐야 하는 제품에서 치명적. 라우트 셸 + 위젯 단위 바운더리로 장애를 국소화한다.

## 요구사항 / 함수 시그니처
- `web/src/components/ErrorBoundary.tsx` 신설 — 무의존 class 컴포넌트(react 19, `getDerivedStateFromError`/`componentDidCatch`).
  - props: `{ fallback?: (err: Error, reset: () => void) => ReactNode; resetKey?: unknown; label?: string; children: ReactNode }`.
  - `resetKey` 변경 시 에러 상태 자동 리셋(라우트/range 전환 시 재마운트 효과) — `componentDidUpdate`에서 prevProps.resetKey !== resetKey && hasError → reset.
  - 기본 폴백: 기존 `.state.error` 토큰 스타일 재사용, "이 영역을 표시할 수 없습니다" + "다시 시도" 버튼(reset) + (개발모드 한정) 에러 메시지.
  - `componentDidCatch`에서 `console.error`로 진단 로깅(향후 /diagnostics 연동 여지).
- `App.tsx`: 최상위 ErrorBoundary(앱 셸 전체) + 각 페이지 렌더를 page를 resetKey로 갖는 ErrorBoundary로 래핑 → 한 페이지 throw가 NAV/Layout까지 죽이지 않게, 다른 페이지로 이동하면 자동 복구.

## 테스트 케이스
- normal: 정상 렌더 시 children 그대로 통과(폴백 미표시).
- failure: 자식이 throw → 폴백 렌더, NAV/Layout 유지.
- recovery: resetKey 변경(페이지 이동) → 폴백 해제·재마운트 시도.
- bad-input: undefined/형태 다른 데이터로 위젯 throw 시 위젯 폴백만, 페이지 나머지 유지.
- (프론트 테스트 러너 미도입 — IMP-13 전까지 tsc 타입체크 + 수동/시각 QA로 검증)

## 출력 위치
- `web/src/components/ErrorBoundary.tsx`(신규), `web/src/App.tsx`(래핑), `web/src/index.css`(폴백 스타일 — 기존 .state.error 재사용, 최소 추가).

## 의존성
- 없음(무의존 정책 — react-error-boundary 미사용, in-house class 컴포넌트).
