import { useCallback, useEffect, useState } from "react";
import Layout, { type Page } from "./components/Layout";
import { pageFromPath, pathForPage, queryParam, capForPage, type NavParams } from "./router";
import { CapabilitiesProvider, useCap } from "./capabilities";
import { TimeRangeProvider } from "./timeRange";
import { ThemeProvider } from "./theme";
import Dashboard from "./pages/Dashboard";
import Usage from "./pages/Usage";
import Guard from "./pages/Guard";
import Traces from "./pages/Traces";
import Sessions from "./pages/Sessions";
import Models from "./pages/Models";
import ModelImport from "./pages/ModelImport";
import Playground from "./pages/Playground";
import Eval from "./pages/Eval";
import Endpoints from "./pages/Endpoints";
import Gpu from "./pages/Gpu";
import Traffic from "./pages/Traffic";
import Settings from "./pages/Settings";
import Credentials from "./pages/Credentials";
import Keys from "./pages/Keys";
import Diagnostics from "./pages/Diagnostics";

// 부팅 시 /capabilities 를 받아 배포 프로파일(observe/manage)을 확정한 뒤 앱을 그린다.
export default function App() {
  return (
    <CapabilitiesProvider>
      <ThemeProvider>
        <TimeRangeProvider>
          <AppInner />
        </TimeRangeProvider>
      </ThemeProvider>
    </CapabilitiesProvider>
  );
}

function AppInner() {
  const { can } = useCap();
  // URL 경로 ↔ 화면 상태 동기화(History API, 라이브러리 없음).
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [pgModel, setPgModel] = useState<string | undefined>(() =>
    pageFromPath(window.location.pathname) === "playground" ? queryParam("model") : undefined,
  );

  const navigate = useCallback((p: Page, params?: NavParams) => {
    if (p === "playground") setPgModel(params?.model);
    setPage(p);
    const path = pathForPage(p, params as Record<string, string | undefined> | undefined);
    if (path !== window.location.pathname + window.location.search) {
      window.history.pushState({ page: p }, "", path);
    }
  }, []);

  // 뒤로/앞으로 가기 → URL 에서 화면 복원. 최초 진입 시 정규 경로로 치환(/, /unknown → /dashboard).
  useEffect(() => {
    const onPop = () => {
      const p = pageFromPath(window.location.pathname);
      setPage(p);
      setPgModel(p === "playground" ? queryParam("model") : undefined);
    };
    window.addEventListener("popstate", onPop);
    const canonical = pathForPage(page, page === "playground" ? { model: pgModel } : undefined);
    if (window.location.pathname + window.location.search !== canonical) {
      window.history.replaceState({ page }, "", canonical);
    }
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 현재 프로파일에서 접근 불가한 화면(딥링크 등)은 관제로 폴백. NAV 에 없어도 URL 직접 진입 방어.
  const cap = capForPage(page);
  const effPage: Page = !cap || can(cap) ? page : "dashboard";

  return (
    <Layout page={effPage} onNavigate={navigate}>
      {effPage === "dashboard" && <Dashboard onNavigate={navigate} />}
      {effPage === "usage" && <Usage onNavigate={navigate} />}
      {effPage === "guard" && <Guard />}
      {effPage === "traces" && <Traces />}
      {effPage === "sessions" && <Sessions />}
      {effPage === "models" && <Models onNavigate={navigate} />}
      {effPage === "model-import" && <ModelImport onNavigate={navigate} />}
      {effPage === "playground" && <Playground initialModel={pgModel} />}
      {effPage === "eval" && <Eval />}
      {effPage === "endpoints" && <Endpoints onNavigate={navigate} />}
      {effPage === "gpu" && <Gpu />}
      {effPage === "traffic" && <Traffic />}
      {effPage === "settings" && <Settings />}
      {effPage === "credentials" && <Credentials />}
      {effPage === "keys" && <Keys />}
      {effPage === "diagnostics" && <Diagnostics onNavigate={navigate} />}
    </Layout>
  );
}
