// IMP-88 — 기능 격리 회귀 가드.
//
// FABRIX 는 고객사별로 화면·기능을 선택 활성화해 배포한다(direction 9 최우선). 한 기능을 빼거나
// (cap OFF / 라우트 미등록) 해도 **나머지 앱이 조용히 깨지면 안 된다**. 두-프로파일 게이팅
// (capabilities + PAGE_CAP)과 mock 파생(buildOntology 및 스코어카드/Kinetic 감지/스키마 그래프)이
// 강하게 얽혀 있어 IMP-90(/inbox·Task 제거)·향후 cap-off 작업이 회귀를 부를 위험이 있다.
//
// 이 스위트는 그 안전 전제를 기계적으로 못박는다:
//   (1) cap 매트릭스 × 핵심 화면 — App 의 effPage 폴백·pageFromPath·nav 필터가 크래시 없이 동작.
//   (2) "빼도 나머지 통과" — ontology off → dashboard/endpoints OK, endpoints off → ontology/dashboard OK.
//   (3) mock 파생 크래시 가드 — buildOntology 파생이 특정 객체 타입(Endpoint/Incident 등) 부재 시
//       throw/undefined-access 없이 graceful degrade(각 파생은 objects/links 배열을 받는 순수 함수라 직접 주입).
//
// TEST-ONLY(+ 실제 크래시 발견 시에만 최소 방어 가드). /inbox 제거는 하지 않는다(그건 IMP-90).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { OntologyLink, OntologyObject } from "./api/types";
import { capForPage, pageFromPath, pathForPage, PAGE_CAP, ROUTES, type NavParams } from "./router";
import type { Page } from "./components/Layout";
import { buildScorecard } from "./api/ontologyScorecard";
import { buildObjectTypeCatalog, buildSchemaGraph } from "./api/ontologySchema";
import { buildGraph } from "./api/ontologyGraph";
import { attributeDetections } from "./api/detection";

// ── 격리 대상: "핵심 화면" 집합 ──────────────────────────────────────────────
// 하나가 빠져도 나머지가 살아야 함을 검증할 대표 화면. 각기 다른 cap 을 물어 매트릭스가 의미 있게 흩어진다.
const CORE_PAGES: Page[] = ["dashboard", "ontology", "endpoints", "gpu", "traces"];

// 이 화면들이 참조하는 cap 의 합집합(중복 제거). cap 매트릭스는 이 각각을 한 번씩 OFF 로 돌린다.
const CORE_CAPS = Array.from(
  new Set(CORE_PAGES.map((p) => capForPage(p)).filter((c): c is string => !!c)),
);

// App.tsx 의 effPage 폴백을 순수 복제(단일 출처 로직 미러) — cap 불허 화면은 dashboard 로 강등.
//   (실제 App.AppInner: `!cap || can(cap) ? page : "dashboard"`.)
function effPage(page: Page, can: (cap: string) => boolean): Page {
  const cap = capForPage(page);
  return !cap || can(cap) ? page : "dashboard";
}

// 특정 cap 하나만 OFF 인 can(). 나머지는 전부 허용(cap 부재도 허용 — capabilities.tsx 폴백 규칙과 동형).
function canWithout(offCap: string): (cap: string) => boolean {
  return (cap: string) => cap !== offCap;
}

// ── (1) cap 매트릭스 × 핵심 화면: effPage 폴백이 크래시 없이 격리 ─────────────
describe("IMP-88 — cap 매트릭스 × 핵심 화면 (effPage 폴백 격리)", () => {
  for (const offCap of CORE_CAPS) {
    it(`cap '${offCap}' OFF — 모든 핵심 화면이 throw 없이 해석되고, 그 cap 화면만 dashboard 로 폴백`, () => {
      const can = canWithout(offCap);
      for (const page of CORE_PAGES) {
        // throw/undefined-access 없이 Page 를 돌려준다.
        expect(() => effPage(page, can)).not.toThrow();
        const eff = effPage(page, can);
        const needs = capForPage(page);
        if (needs === offCap) {
          // 이 화면의 cap 이 꺼졌으면 관제(dashboard)로 안전 폴백.
          expect(eff).toBe("dashboard");
        } else {
          // 무관한 화면은 자기 자신 유지(격리 — 남의 cap OFF 에 영향받지 않음).
          expect(eff).toBe(page);
        }
      }
    });
  }

  it("모든 cap 이 OFF 여도(readonly 극단) 핵심 화면 해석이 크래시하지 않는다 — 전부 dashboard 로 수렴", () => {
    const canNone = () => false;
    for (const page of CORE_PAGES) {
      expect(() => effPage(page, canNone)).not.toThrow();
      // dashboard 는 dashboard cap 을 물으므로 그것도 OFF → 여전히 dashboard(자기 자신)로 폴백.
      expect(effPage(page, canNone)).toBe("dashboard");
    }
  });
});

// ── (2) 라우트 미등록/미지 경로 폴백: pageFromPath 는 절대 throw 하지 않는다 ────
describe("IMP-88 — 라우트 미등록·미지 경로 폴백", () => {
  it("미등록/미지/빈 경로 → dashboard 폴백(throw 없음)", () => {
    for (const path of ["/no-such-route", "/inbox/removed", "/", "", "/models/import/extra", "///"]) {
      expect(() => pageFromPath(path)).not.toThrow();
      expect(pageFromPath(path)).toBe("dashboard");
    }
  });

  it("핵심 화면 경로는 왕복(round-trip) 유지 — 미등록 회귀 시 여기서 드러난다", () => {
    for (const page of CORE_PAGES) {
      const path = pathForPage(page);
      expect(pageFromPath(path)).toBe(page);
    }
  });
});

// ── (3) "빼도 나머지 통과" — 제거 대상(IMP-90 inbox 등) 대비 격리 회귀 가드 ────
describe("IMP-88 — 빼도 나머지 통과 (제거·게이팅 안전 전제)", () => {
  it("ontology cap 이 꺼져도 dashboard·endpoints 는 여전히 접근/유지", () => {
    // ontology 는 dashboard cap 을 공유하므로, "ontology 를 격리 제거"의 실제 형태는 라우트 미등록이다.
    // 라우트 미등록 시뮬레이션: ontology 경로가 사라져도 나머지 라우팅은 무영향.
    expect(effPage("dashboard", () => true)).toBe("dashboard");
    expect(effPage("endpoints", () => true)).toBe("endpoints");
    // ontology 경로를 미지로 취급 → dashboard 폴백(나머지 화면 라우팅 정상).
    expect(pageFromPath("/ontology-removed")).toBe("dashboard");
    expect(pageFromPath(pathForPage("endpoints"))).toBe("endpoints");
  });

  it("endpoints cap 이 꺼져도 ontology·dashboard 는 여전히 접근/유지", () => {
    const can = canWithout("endpoints");
    expect(effPage("endpoints", can)).toBe("dashboard"); // 빠진 화면만 폴백
    expect(effPage("ontology", can)).toBe("ontology"); // 나머지 격리 유지
    expect(effPage("dashboard", can)).toBe("dashboard");
  });

  it("inbox 라우트 미등록(IMP-90 완료) → /inbox 딥링크는 dashboard 폴백, 나머지 라우팅 무영향", () => {
    // IMP-90 로 /inbox 는 실제 제거됨 — pageFromPath 는 dashboard 로 폴백(딥링크 방어). 나머지 화면 왕복 유지.
    expect(pageFromPath("/inbox")).toBe("dashboard"); // 미등록 → 폴백(제거 완료).
    for (const page of CORE_PAGES) {
      expect(pageFromPath(pathForPage(page))).toBe(page);
    }
  });
});

// ── nav 필터가 cap-off 에서 크래시 없이 렌더(Layout) ──────────────────────────
// capabilities 를 주입 가능하게 mock(Layout.nav.test 패턴 재사용). 포털 의존 자식은 스텁.
let mockCan: (cap: string) => boolean = () => true;
const mockCaps = { profile: "manage", readonly: false, capabilities: {} as Record<string, boolean>, data_source: "", integrations: {} };
vi.mock("./capabilities", () => ({ useCap: () => ({ caps: mockCaps, can: mockCan }) }));
vi.mock("./components/Notifications", () => ({ default: () => null }));
vi.mock("./components/CommandPalette", () => ({ default: () => null }));

// vi.mock 은 vitest 가 hoist 하므로 이 import 가 mock 뒤에 와도 안전(플랫 config 에 import/first 규칙 없음).
import Layout from "./components/Layout";

describe("IMP-88 — nav 필터 격리(cap-off 에서 크래시 없이 렌더)", () => {
  beforeEach(() => { mockCan = () => true; });
  afterEach(() => cleanup());

  for (const offCap of CORE_CAPS) {
    it(`cap '${offCap}' OFF — Layout 이 throw 없이 렌더되고 주 메뉴는 여전히 존재`, () => {
      mockCan = canWithout(offCap);
      expect(() =>
        render(
          <Layout page="dashboard" onNavigate={() => {}}>
            <div>content</div>
          </Layout>,
        ),
      ).not.toThrow();
      // 남은 nav 는 여전히 보인다(그룹 전멸 시 그룹째 숨김도 정상). 콘텐츠도 렌더.
      expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
      expect(screen.getByText("content")).toBeInTheDocument();
    });
  }

  it("모든 cap OFF(readonly 극단) 에서도 Layout 렌더 생존(콘텐츠 표시)", () => {
    mockCan = () => false;
    expect(() =>
      render(
        <Layout page="dashboard" onNavigate={() => {}}>
          <div>content</div>
        </Layout>,
      ),
    ).not.toThrow();
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});

// ── (4) mock 파생 크래시 가드: 특정 객체 타입 부재 시 degrade, not crash ──────
// buildOntology 파생(스코어카드/Kinetic 감지/스키마 그래프/카탈로그/그래프)은 objects·links 배열을
// 받는 순수 함수다. 특정 기능/타입을 빼면(필터·미등록) 이 배열에서 해당 타입이 사라질 수 있으므로,
// 타입 부재·빈 스냅샷에서 throw/undefined-access 없이 결과를 내는지 직접 주입해 가드한다.
//
// 대표 척추 스냅샷(Service→Endpoint→Model→GpuDevice→Node + Trace/Incident). (IMP-90: Task 제거.)
const FULL_OBJECTS: OntologyObject[] = [
  { id: "service:svc-a", type: "Service", title: "Svc A", props: { name: "svc-a", qps: 12, error_rate: 0.01 }, status: "ok", revision: 1 },
  { id: "endpoint:ep-a", type: "Endpoint", title: "EP A", props: { replicas: 2, backend: "vllm", ready: false, app_id: "a1" }, status: "crit", revision: 1 },
  { id: "model:m-a", type: "Model", title: "Model A", props: { provider: "Google", context_window: 4096, pattern: "agg", gpu: 1, replicas: 2 }, status: "warn", revision: 1 },
  { id: "gpu:g0", type: "GpuDevice", title: "GPU 0", props: { device: "n0/g0", util_perc: 0.95, mem_perc: 0.7, temp_c: 90, xid_recent: 0, throttle: "열 제약" }, status: "crit", revision: 1 },
  { id: "node:n0", type: "Node", title: "Node 0", props: { hostname: "n0", cpu_util: 0.9 }, status: "warn", revision: 1 },
  { id: "trace:t-1", type: "Trace", title: "trace 1", props: { model: "m-a", endpoint: "ep-a", total_ms: 900, ttft_ms: 300, decision: "allowed" }, status: "ok", revision: 1 },
  { id: "incident:i-1", type: "Incident", title: "Incident 1", props: { severity: "high", state: "firing", count: 3 }, status: "crit", revision: 1 },
  // IMP-89: App(소비자) — app_id 를 traversable 객체로 승격. Endpoint --routes--> App.
  { id: "app:a1", type: "App", title: "앱 1", props: { app_id: "a1", name: "앱 1", endpoints: 1, request_count: 5 }, status: "crit", revision: 1 },
];
const FULL_LINKS: OntologyLink[] = [
  { from: "service:svc-a", to: "endpoint:ep-a", linkKind: "consumes" },
  { from: "endpoint:ep-a", to: "model:m-a", linkKind: "serves" },
  { from: "model:m-a", to: "gpu:g0", linkKind: "runsOn" },
  { from: "gpu:g0", to: "node:n0", linkKind: "hostedBy" },
  { from: "trace:t-1", to: "endpoint:ep-a", linkKind: "routedTo" },
  { from: "incident:i-1", to: "endpoint:ep-a", linkKind: "affects" },
  { from: "endpoint:ep-a", to: "app:a1", linkKind: "routes" }, // IMP-89 — Endpoint→App
];

// objects 에서 주어진 타입들을 제거하고, dangling 이 되는 링크도 함께 제거(무결성 — buildOntology 규약과 동형).
function withoutTypes(types: string[]): { objects: OntologyObject[]; links: OntologyLink[] } {
  const drop = new Set(types);
  const objects = FULL_OBJECTS.filter((o) => !drop.has(o.type));
  const ids = new Set(objects.map((o) => o.id));
  const links = FULL_LINKS.filter((l) => ids.has(l.from) && ids.has(l.to));
  return { objects, links };
}

// 모든 파생을 한 번에 돌려 throw 여부만 본다(개별 assert 는 아래 케이스가 추가로 확인).
function runAllDerivations(objects: OntologyObject[], links: OntologyLink[]) {
  buildScorecard(objects);
  buildObjectTypeCatalog(objects);
  buildSchemaGraph(objects, links);
  buildGraph(objects, links);
  attributeDetections(objects, links);
}

describe("IMP-88 — mock 파생 크래시 가드(타입 부재 → degrade, not crash)", () => {
  it("완전 스냅샷에서 모든 파생이 정상 동작(기준선)", () => {
    expect(() => runAllDerivations(FULL_OBJECTS, FULL_LINKS)).not.toThrow();
    // 카탈로그는 알려진 §5.1 타입당 카드 유지(타입 존재/부재와 무관하게 그리드 고정).
    expect(buildObjectTypeCatalog(FULL_OBJECTS).length).toBeGreaterThan(0);
  });

  // 각 객체 타입을 하나씩 제거해도(그 기능만 배포 제외 = 그 타입 부재) 파생이 크래시하지 않는지 전수 확인.
  const ALL_TYPES = ["Service", "Endpoint", "Model", "GpuDevice", "Node", "Trace", "Incident", "App"];
  for (const t of ALL_TYPES) {
    it(`'${t}' 타입 부재 — 모든 파생이 throw 없이 degrade`, () => {
      const { objects, links } = withoutTypes([t]);
      expect(() => runAllDerivations(objects, links)).not.toThrow();
      // 스코어카드는 부재 타입을 채점 대상에서 제외(SCORABLE filter) — 남은 것만, throw 없이.
      expect(() => buildScorecard(objects).summary).not.toThrow();
      // 카탈로그 카드 수는 타입 부재와 무관하게 고정(그리드 유지 — count 0 카드).
      expect(buildObjectTypeCatalog(objects).length).toBe(buildObjectTypeCatalog(FULL_OBJECTS).length);
    });
  }

  it("Endpoint 부재 스냅샷(엔드포인트 기능 미배포) — 스코어카드·감지·스키마 그래프 graceful", () => {
    const { objects, links } = withoutTypes(["Endpoint"]);
    const sc = buildScorecard(objects);
    // Endpoint 인스턴스가 없으니 채점 대상에서 사라질 뿐, 나머지 타입은 정상 채점(요약도 유효).
    expect(sc.instances.every((i) => i.object.type !== "Endpoint")).toBe(true);
    expect(sc.summary.scored).toBeGreaterThanOrEqual(0);
    // 감지는 Endpoint 를 진입점 근거로만 쓰므로 부재해도 나머지(Model/GPU/Node) 귀속이 crash 없이 나온다.
    expect(() => attributeDetections(objects, links)).not.toThrow();
    // 스키마 그래프: dangling(부재 타입 참조) 링크는 방어적으로 제외 → throw 없음.
    expect(() => buildSchemaGraph(objects, links)).not.toThrow();
  });

  it("Incident 만 있는 스냅샷 — 비-SCORABLE 단독에서도 파생이 크래시하지 않는다(IMP-90 Task 제거 후 회귀 가드)", () => {
    const incidentOnly = FULL_OBJECTS.filter((o) => o.type === "Incident");
    // Incident 만 남기면 affects 링크의 반대편(Endpoint)이 사라져 전부 dangling → 빈 링크.
    const ids = new Set(incidentOnly.map((o) => o.id));
    const links = FULL_LINKS.filter((l) => ids.has(l.from) && ids.has(l.to));
    expect(() => runAllDerivations(incidentOnly, links)).not.toThrow();
    // 스코어카드는 Incident 를 채점하지 않으므로(SCORABLE 제외) scored=0, allPass=false(공허 참).
    expect(buildScorecard(incidentOnly).summary.scored).toBe(0);
  });

  it("완전히 빈 스냅샷(모든 기능 미배포) — 모든 파생이 빈 결과로 graceful", () => {
    expect(() => runAllDerivations([], [])).not.toThrow();
    expect(buildScorecard([]).summary.scored).toBe(0);
    expect(buildSchemaGraph([], []).graph.nodes.length).toBe(0);
    // 카탈로그는 여전히 알려진 타입당 카드(전부 count 0) — 그리드 붕괴 없음.
    expect(buildObjectTypeCatalog([]).every((c) => c.count === 0)).toBe(true);
  });

  it("Trace·Incident(비-SCORABLE) 만 남긴 스냅샷 — 스코어카드는 채점 0, 파생은 crash 없음", () => {
    const { objects, links } = withoutTypes(["Service", "Endpoint", "Model", "GpuDevice", "Node"]);
    expect(() => runAllDerivations(objects, links)).not.toThrow();
    expect(buildScorecard(objects).summary.scored).toBe(0);
  });
});

// ── PAGE_CAP 정합 회귀(격리의 정적 기반) ──────────────────────────────────────
describe("IMP-88 — 핵심 화면 cap 매핑 존재(격리 매트릭스의 정적 기반)", () => {
  it("핵심 화면은 모두 ROUTES + PAGE_CAP 에 등록돼 있다", () => {
    for (const page of CORE_PAGES) {
      expect(ROUTES[page]).toBeTruthy();
      expect(PAGE_CAP[page]).toBeTruthy();
    }
    // NavParams 타입 사용(미사용 import 방지) — drill-through 컨텍스트 형태 스모크.
    const params: NavParams = { entity: "endpoint:ep-a" };
    expect(pathForPage("investigate", params as Record<string, string | undefined>)).toContain("entity");
  });
});
