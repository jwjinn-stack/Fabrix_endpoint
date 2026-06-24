import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api 요청은 Go API 서버(:8080)로 프록시 → 개발 중 CORS/포트 고민 없이 동작.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
