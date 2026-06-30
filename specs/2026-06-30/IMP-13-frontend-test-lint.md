# 기능: 프론트엔드 테스트 러너 + 린터 도입 (Vitest + RTL + ESLint flat)

## 목적
`web/`에 테스트 러너·린터가 전무(테스트 0건, package.json scripts=dev/build/preview, eslint config 부재). 회귀를 잡을 그물이 없어 IMP-6가 추가한 백엔드 테스트와 비대칭. IMP-11(CI 게이트)의 `npm run lint`/`npm test` 선결조건.

## 요구사항
- Vitest + @testing-library/react + jsdom + @testing-library/jest-dom + user-event 도입.
- `vite.config.ts`에 `test`(environment:'jsdom', globals:true, setupFiles) — 별도 vitest.config 불필요.
- `src/test/setup.ts`: jest-dom 매처 + afterEach cleanup.
- ESLint flat(`eslint.config.js`): @eslint/js recommended + typescript-eslint + react-hooks(recommended) + react-refresh + jsx-a11y(recommended). `_` 접두 미사용 인자 허용.
- 기존 코드 다수 위반인 jsx-a11y 상호작용 규칙은 **baseline warn**(게이트 비차단, 점진 승격).
- `package.json` scripts: `test`(vitest run), `test:watch`, `lint`(eslint .).
- 시드 테스트: 순수 로직(`utils/format.ts`) + 컴포넌트(`InfoTip` 토글 a11y).

## 테스트 케이스
- format: compact(M/K/locale/반올림), formatMetric(ms/ratio/req·s/fallback).
- InfoTip: 기본 닫힘·aria-expanded=false, 클릭 시 열림+내용 표시, Escape 닫힘.
- gate: `npm test` 통과(11건), `npm run lint` exit 0(0 errors), tsc·build 회귀 없음.

## 출력 위치
- `web/vite.config.ts`, `web/eslint.config.js`, `web/src/test/setup.ts`, `web/src/utils/format.test.ts`, `web/src/components/InfoTip.test.tsx`, `web/package.json`.

## 의존성
- devDeps: vitest, @testing-library/{react,jest-dom,user-event}, jsdom, eslint, @eslint/js, typescript-eslint, eslint-plugin-{react-hooks,react-refresh,jsx-a11y}, globals.
