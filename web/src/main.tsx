import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installMockFetch } from "./api/mock";
import { ToastProvider } from "./toast.tsx";

// 프론트 단독 실행: 기본은 mock 활성(백엔드 0개 프로세스).
// 실제 백엔드(:8080)로 붙이려면 VITE_MOCK=off 로 dev 실행.
if (import.meta.env.VITE_MOCK !== "off") {
  installMockFetch();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
