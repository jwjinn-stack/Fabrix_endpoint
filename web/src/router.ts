// 경량 경로 라우팅 — 의존성 없이 History API 로 화면별 고유 URL 제공.
// 좌측 nav 상태(Page) ↔ URL 경로를 1:1 동기화한다.
import type { Page } from "./components/Layout";

// Page ↔ 경로 매핑(단일 출처). 중첩 경로(/models/import 등)는 상위보다 먼저 매칭되도록 exact 비교.
export const ROUTES: Record<Page, string> = {
  dashboard: "/dashboard",
  usage: "/usage",
  guard: "/guard",
  traces: "/traces",
  sessions: "/sessions",
  models: "/models",
  "model-import": "/models/import",
  playground: "/playground",
  eval: "/eval",
  endpoints: "/endpoints",
  gpu: "/gpu",
  nodes: "/nodes",
  network: "/network",
  topology: "/topology",
  investigate: "/investigate",
  agent: "/agent",
  keys: "/keys",
  traffic: "/traffic",
  settings: "/settings",
  credentials: "/settings/credentials",
  diagnostics: "/diagnostics",
};

// 화면 ↔ 필요한 capability(기능 플래그). 배포 프로파일(observe/manage)로 메뉴·접근을 게이팅한다.
// undefined = 항상 허용. 값이 있으면 해당 cap 이 켜져야 노출/접근 가능(backend capability 키와 일치).
export const PAGE_CAP: Partial<Record<Page, string>> = {
  dashboard: "dashboard",
  usage: "dashboard",
  gpu: "dashboard",
  nodes: "dashboard",
  network: "dashboard",
  topology: "dashboard",
  investigate: "dashboard",
  // AI Agent(IMP-60) — 읽기 관제 권한이면 노출. mutating 은 카드의 ActionForm 이 별도로 게이팅(two-tier).
  agent: "dashboard",
  traffic: "dashboard",
  guard: "guard",
  traces: "traces",
  sessions: "traces",
  models: "models",
  "model-import": "models.write",
  playground: "playground",
  eval: "eval",
  endpoints: "endpoints",
  keys: "keys",
  settings: "users",
  credentials: "credentials",
};

// capForPage 는 해당 화면 노출/접근에 필요한 cap(없으면 undefined=항상 허용).
export function capForPage(page: Page): string | undefined {
  return PAGE_CAP[page];
}

const PATH_TO_PAGE: Record<string, Page> = Object.fromEntries(
  Object.entries(ROUTES).map(([page, path]) => [path, page as Page]),
) as Record<string, Page>;

// pageFromPath 는 경로명을 Page 로 해석한다. 미지/루트는 dashboard.
export function pageFromPath(pathname: string): Page {
  const p = pathname.replace(/\/+$/, ""); // 끝 슬래시 제거
  if (p === "" || p === "/") return "dashboard";
  return PATH_TO_PAGE[p] ?? "dashboard";
}

// pathForPage 는 Page(+옵션 query)를 URL 경로로 만든다.
export function pathForPage(page: Page, params?: Record<string, string | undefined>): string {
  const base = ROUTES[page] ?? "/dashboard";
  const qs = params
    ? Object.entries(params)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
        .join("&")
    : "";
  return qs ? `${base}?${qs}` : base;
}

// 현재 URL 의 query 파라미터 1개 읽기(플레이그라운드 model, drill-through 필터 등).
export function queryParam(name: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

// NavParams — 화면 간 drill-through 시 운반하는 필터 컨텍스트(공통 차원 기반).
// L1→L2→L3 이동에서 model/endpoint/namespace·시간·decision 을 URL 쿼리로 넘겨
// 도착 화면이 동일 컨텍스트로 좁혀 보이게 한다(deep-link 가능).
export type NavParams = {
  model?: string; // playground 모델 / 차원=model 선택값
  dim?: string; // groupby 차원: model|endpoint|namespace
  key?: string; // 선택된 차원 값(그룹)
  range?: string; // 시간 범위 코드(1h/6h/24h/7d)
  decision?: string; // allowed|flagged|blocked
  from?: string; // 시간窓 시작(RFC3339) — metric→trace 조인
  to?: string; // 시간窓 끝
  host?: string; // IMP-50: 인프라 host join key(토폴로지 server/gpu 노드 → Gpu/NodeMetrics 드릴다운)
};

// NavFn — 모든 화면이 공유하는 네비게이션 시그니처(필터 컨텍스트 운반).
export type NavFn = (page: Page, params?: NavParams) => void;
