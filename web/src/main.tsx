import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ToastProvider } from "./toast.tsx";

function mount() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StrictMode>,
  );
}

// 프론트 단독 실행: 기본은 mock 활성(백엔드 0개 프로세스).
// 실제 백엔드(:8080)로 붙이려면 VITE_MOCK=off 로 dev 실행.
//
// IMP-85: mock.ts(2557줄)를 부트 청크에서 분리한다. 동적 import 로 게이트 안에서만 로드하므로
// 실백엔드 모드(VITE_MOCK=off)에서는 mock 청크를 아예 받지 않는다(부트 페이로드 축소).
// mock 을 설치한 뒤 첫 fetch(App 초기 /capabilities 등)가 나가도록 mount 순서를 보장한다.
if (import.meta.env.VITE_MOCK !== "off") {
  void import("./api/mock").then(({ installMockFetch }) => {
    installMockFetch();
    mount();
  });
} else {
  mount();
}
