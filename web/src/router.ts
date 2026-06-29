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
  let p = pathname.replace(/\/+$/, ""); // 끝 슬래시 제거
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

// 현재 URL 의 query 파라미터 1개 읽기(플레이그라운드 model 등).
export function queryParam(name: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}
