import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import Layout, { type Page } from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import { PageSkeleton } from "./components/Skeleton";
import { pageFromPath, pathForPage, queryParam, capForPage, type NavParams } from "./router";
import { CapabilitiesProvider, useCap } from "./capabilities";
import { TimeRangeProvider } from "./timeRange";
import { ThemeProvider } from "./theme";

// 라우트 지연 로딩(IMP-85, direction 11) — 각 페이지를 별도 청크로 분할해 초기 eager 번들에서 뺀다.
// 관제 콘솔은 한 번에 한 화면만 보므로, 진입 화면 청크만 받고 나머지는 이동 시점에 받는다.
// 앱 셸(Layout/nav/providers/ErrorBoundary)은 정적 import 로 eager 유지 — 즉시 렌더된다.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Ontology = lazy(() => import("./pages/Ontology"));
const Usage = lazy(() => import("./pages/Usage"));
const Guard = lazy(() => import("./pages/Guard"));
const Traces = lazy(() => import("./pages/Traces"));
const Sessions = lazy(() => import("./pages/Sessions"));
const Models = lazy(() => import("./pages/Models"));
const ModelImport = lazy(() => import("./pages/ModelImport"));
const Playground = lazy(() => import("./pages/Playground"));
const Eval = lazy(() => import("./pages/Eval"));
const Endpoints = lazy(() => import("./pages/Endpoints"));
const Gpu = lazy(() => import("./pages/Gpu"));
const NodeMetrics = lazy(() => import("./pages/NodeMetrics"));
const Network = lazy(() => import("./pages/Network"));
const Topology = lazy(() => import("./pages/Topology"));
const Investigate = lazy(() => import("./pages/Investigate"));
const AiAgent = lazy(() => import("./pages/AiAgent"));
const Traffic = lazy(() => import("./pages/Traffic"));
const Settings = lazy(() => import("./pages/Settings"));
const Credentials = lazy(() => import("./pages/Credentials"));
const Keys = lazy(() => import("./pages/Keys"));
const Diagnostics = lazy(() => import("./pages/Diagnostics"));
const MetricSources = lazy(() => import("./pages/MetricSources"));

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
    <ErrorBoundary label="app">
      <Layout page={effPage} onNavigate={navigate}>
        {/* 페이지 단위 바운더리 — 한 화면의 렌더 throw 가 NAV/Layout 까지 죽이지 않게 격리.
            effPage 를 resetKey 로 두어 다른 화면으로 이동하면 자동 복구된다. */}
        <ErrorBoundary label={effPage} resetKey={effPage}>
          {/* 단일 Suspense — 지연 로딩되는 페이지 청크가 도착하기 전 CLS-safe PageSkeleton 을 아웃렛에 표시.
              resetKey=effPage 로 화면 전환마다 fallback 이 다시 뜬다(직전 화면 잔상 방지). */}
          <Suspense fallback={<PageSkeleton />}>
            {pageContent(effPage, navigate, pgModel)}
          </Suspense>
        </ErrorBoundary>
      </Layout>
    </ErrorBoundary>
  );
}

function pageContent(
  effPage: Page,
  navigate: (p: Page, params?: NavParams) => void,
  pgModel: string | undefined,
) {
  return (
    <>
      {effPage === "dashboard" && <Dashboard onNavigate={navigate} />}
      {effPage === "ontology" && <Ontology onNavigate={navigate} />}
      {effPage === "usage" && <Usage onNavigate={navigate} />}
      {effPage === "guard" && <Guard />}
      {effPage === "traces" && <Traces onNavigate={navigate} />}
      {effPage === "sessions" && <Sessions />}
      {effPage === "models" && <Models onNavigate={navigate} />}
      {effPage === "model-import" && <ModelImport onNavigate={navigate} />}
      {effPage === "playground" && <Playground initialModel={pgModel} />}
      {effPage === "eval" && <Eval />}
      {effPage === "endpoints" && <Endpoints onNavigate={navigate} />}
      {effPage === "gpu" && <Gpu />}
      {effPage === "nodes" && <NodeMetrics />}
      {effPage === "network" && <Network onNavigate={navigate} />}
      {effPage === "topology" && <Topology onNavigate={navigate} />}
      {effPage === "investigate" && <Investigate onNavigate={navigate} />}
      {effPage === "agent" && <AiAgent onNavigate={navigate} />}
      {effPage === "traffic" && <Traffic />}
      {effPage === "settings" && <Settings />}
      {effPage === "credentials" && <Credentials />}
      {effPage === "keys" && <Keys />}
      {effPage === "diagnostics" && <Diagnostics onNavigate={navigate} />}
      {effPage === "metric-sources" && <MetricSources onNavigate={navigate} />}
    </>
  );
}
