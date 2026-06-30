import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";

// ESLint flat config (IMP-13) — Vite react-ts 스캐폴드 기본값 채택.
// js recommended + typescript-eslint + react-hooks + react-refresh + jsx-a11y(접근성).
export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // 의도된 빈 catch(/* ignore */) 다수 — 빈 블록은 허용하되 빈 catch만 경고.
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // 밑줄 접두 인자/변수는 의도적 미사용으로 허용(예: _signal).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // 접근성 baseline(IMP-13): 기존 코드에 다수 위반이 존재하는 상호작용 규칙은 warn 으로 도입해
      // 게이트를 막지 않으면서 가시화한다. 점진적으로 error 로 승격(IMP-12 등에서 해소).
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-tabindex": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/no-autofocus": "warn",
    },
  },
  // 테스트·설정 파일은 node/vitest 전역 허용.
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**", "*.config.{ts,js}"],
    languageOptions: { globals: { ...globals.node } },
  },
);
