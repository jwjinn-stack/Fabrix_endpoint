/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api 요청은 Go API 서버(:8080)로 프록시 → 개발 중 CORS/포트 고민 없이 동작.
export default defineConfig({
  plugins: [react()],
  // IMP-85: react/react-dom 만 안정 far-future-cache 청크로 분리한다.
  // 이 프로젝트는 런타임 의존성 0(hand-rolled router/polling)이라 다른 vendor 버킷은 만들지 않는다
  // (없는 의존성 과설계 금지). 페이지/mock 분할은 소스의 dynamic import 로 Rollup 이 자동 청크화.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "react-vendor";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  // 단위/컴포넌트 테스트(IMP-13): jsdom + RTL. 별도 vitest.config 불필요.
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
