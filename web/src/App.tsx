import { useCallback, useEffect, useState } from "react";
import Layout, { type Page } from "./components/Layout";
import { pageFromPath, pathForPage, queryParam } from "./router";
import Dashboard from "./pages/Dashboard";
import Usage from "./pages/Usage";
import Guard from "./pages/Guard";
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

export default function App() {
  // URL 경로 ↔ 화면 상태 동기화(History API, 라이브러리 없음).
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [pgModel, setPgModel] = useState<string | undefined>(() =>
    pageFromPath(window.location.pathname) === "playground" ? queryParam("model") : undefined,
  );

  const navigate = useCallback((p: Page, model?: string) => {
    if (p === "playground") setPgModel(model);
    setPage(p);
    const path = pathForPage(p, p === "playground" ? { model } : undefined);
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

  return (
    <Layout page={page} onNavigate={navigate}>
      {page === "dashboard" && <Dashboard onNavigate={navigate} />}
      {page === "usage" && <Usage onNavigate={navigate} />}
      {page === "guard" && <Guard />}
      {page === "models" && <Models onNavigate={navigate} />}
      {page === "model-import" && <ModelImport onNavigate={navigate} />}
      {page === "playground" && <Playground initialModel={pgModel} />}
      {page === "eval" && <Eval />}
      {page === "endpoints" && <Endpoints onNavigate={navigate} />}
      {page === "gpu" && <Gpu />}
      {page === "traffic" && <Traffic />}
      {page === "settings" && <Settings />}
      {page === "credentials" && <Credentials />}
      {page === "keys" && <Keys />}
    </Layout>
  );
}
