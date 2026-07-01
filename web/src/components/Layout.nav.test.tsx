import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";

// capabilities 를 프로파일별로 주입 가능하게 mock. 기본 manage(전부 허용).
let mockCaps = { profile: "manage", readonly: false, capabilities: {} as Record<string, boolean>, data_source: "", integrations: {} };
let mockCan = (_cap: string) => true;
vi.mock("../capabilities", () => ({ useCap: () => ({ caps: mockCaps, can: mockCan }) }));
// nav 구조만 검증 — Toast/포털 의존 자식은 스텁.
vi.mock("./Notifications", () => ({ default: () => null }));
vi.mock("./CommandPalette", () => ({ default: () => null }));

import Layout, { type Page } from "./Layout";
import { ROUTES } from "../router";

function renderLayout(page: Page = "dashboard") {
  const onNavigate = vi.fn();
  render(
    <Layout page={page} onNavigate={onNavigate}>
      <div>content</div>
    </Layout>,
  );
  return { onNavigate };
}

function getNav() {
  return screen.getByRole("navigation", { name: "주 메뉴" });
}

// IMP-62 — 5 흐름 그룹(탐색/관측/추적/제어/연동)의 이름·소속(그룹 → 자식 label + 도달 page).
// doc §7 매핑. 이 표가 곧 소속 회귀 가드다(모든 기존 페이지가 어느 한 그룹에 정확히 한 번).
const GROUPS: { group: string; children: { label: string; page: Page }[] }[] = [
  { group: "탐색", children: [{ label: "온톨로지", page: "ontology" }] },
  {
    group: "관측",
    children: [
      { label: "관제", page: "dashboard" },
      { label: "사용량", page: "usage" },
      { label: "트레이스", page: "traces" },
      { label: "세션", page: "sessions" },
      { label: "GPU / MIG", page: "gpu" },
      { label: "노드", page: "nodes" },
      { label: "네트워크", page: "network" },
      { label: "토폴로지", page: "topology" },
      { label: "트래픽", page: "traffic" },
    ],
  },
  { group: "추적", children: [{ label: "근본원인 추적(COP)", page: "investigate" }] },
  {
    group: "제어",
    children: [
      { label: "AI Agent", page: "agent" },
      { label: "플레이그라운드", page: "playground" },
    ],
  },
  {
    group: "연동",
    children: [
      { label: "연동 상태", page: "diagnostics" },
      { label: "메트릭 소스", page: "metric-sources" },
      { label: "모델", page: "models" },
      { label: "모델 임포트", page: "model-import" },
      { label: "엔드포인트", page: "endpoints" },
      { label: "서드파티 자격증명", page: "credentials" },
      { label: "키·앱", page: "keys" },
      { label: "가드레일", page: "guard" },
      { label: "평가", page: "eval" },
      { label: "설정", page: "settings" },
    ],
  },
];

describe("Layout nav — 5 흐름 그룹 IA (IMP-62)", () => {
  beforeEach(() => {
    mockCaps = { profile: "manage", readonly: false, capabilities: {}, data_source: "", integrations: {} };
    mockCan = () => true;
  });

  it("T1 — 5개 흐름 그룹 부모(탐색/관측/추적/제어/연동)가 모두 렌더된다", () => {
    renderLayout();
    const nav = getNav();
    for (const { group } of GROUPS) {
      // 정규식 ^ 앵커로 그룹명 부모 버튼만 매칭(자식 label 과 혼동 방지).
      expect(within(nav).getByRole("button", { name: new RegExp(`^${group}`) })).toBeInTheDocument();
    }
  });

  it("T2 — 각 그룹은 groupless(부모 클릭 시 이동하지 않고 확장/접힘만)", () => {
    // dashboard(관측 소속)로 렌더 → 관측은 자동확장되므로, 자동확장 안 되는 '추적' 그룹으로 접힘→펼침 검증.
    const { onNavigate } = renderLayout("dashboard");
    const parent = within(getNav()).getByRole("button", { name: /^추적/ });
    expect(parent.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(parent);
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    // groupless — 부모 클릭은 페이지 이동을 유발하지 않는다.
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("T2-retry — 부모 두 번 클릭 → 열림→닫힘 토글", () => {
    renderLayout();
    const parent = within(getNav()).getByRole("button", { name: /^제어/ });
    fireEvent.click(parent);
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(parent);
    expect(parent.getAttribute("aria-expanded")).toBe("false");
  });

  // 그룹마다 독립 렌더(RTL cleanup)로 소속·도달성을 검증 — 루프 내 DOM 오염 방지.
  it.each(GROUPS)("T3 — '$group' 그룹의 자식이 노출되고 클릭 시 해당 page 로 이동한다", ({ group, children }) => {
    const { onNavigate } = renderLayout();
    const parent = within(getNav()).getByRole("button", { name: new RegExp(`^${group}`) });
    fireEvent.click(parent);
    const nav = getNav();
    for (const { label, page } of children) {
      const item = within(nav).getByRole("button", { name: label });
      expect(item).toBeInTheDocument();
      fireEvent.click(item);
      expect(onNavigate).toHaveBeenCalledWith(page);
    }
    cleanup();
  });

  it("T3-신규 — 온톨로지=탐색, 근본원인 추적=추적, AI Agent=제어 그룹 소속", () => {
    // 탐색 > 온톨로지
    const r1 = renderLayout();
    fireEvent.click(within(getNav()).getByRole("button", { name: /^탐색/ }));
    fireEvent.click(within(getNav()).getByRole("button", { name: "온톨로지" }));
    expect(r1.onNavigate).toHaveBeenCalledWith("ontology");
    cleanup();
    // 추적 > 근본원인 추적(COP)
    const r2 = renderLayout();
    fireEvent.click(within(getNav()).getByRole("button", { name: /^추적/ }));
    fireEvent.click(within(getNav()).getByRole("button", { name: /근본원인 추적/ }));
    expect(r2.onNavigate).toHaveBeenCalledWith("investigate");
    cleanup();
    // 제어 > AI Agent
    const r3 = renderLayout();
    fireEvent.click(within(getNav()).getByRole("button", { name: /^제어/ }));
    fireEvent.click(within(getNav()).getByRole("button", { name: "AI Agent" }));
    expect(r3.onNavigate).toHaveBeenCalledWith("agent");
  });

  it("T4 — 모든 라우트가 정확히 한 번 어느 그룹 아래 등장한다(orphan 0, 중복 0)", () => {
    // GROUPS 표에 나열된 page 집합이 ROUTES 전체와 정확히 일치해야 한다.
    const inNav = GROUPS.flatMap((g) => g.children.map((c) => c.page));
    const allRoutes = Object.keys(ROUTES) as Page[];
    expect([...inNav].sort()).toEqual([...allRoutes].sort());
    // 중복 없음.
    expect(new Set(inNav).size).toBe(inNav.length);
  });

  it("T5-자동확장 — 현재 페이지가 그룹 자식이면 그 그룹이 자동 확장 + 자식 active highlight", () => {
    renderLayout("nodes"); // nodes ∈ 관측
    const parent = within(getNav()).getByRole("button", { name: /^관측/ });
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    const active = within(getNav()).getByRole("button", { name: "노드" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.className).toContain("active");
  });

  it("T6-게이팅(observe) — mutating cap off 항목은 숨고 dashboard cap 화면은 노출 + '관제 전용' 배지", () => {
    // observe: dashboard/traces=on, 그 외(playground/guard/models…)는 미허용.
    mockCaps = {
      profile: "observe",
      readonly: true,
      capabilities: { dashboard: true, traces: true },
      data_source: "mock",
      integrations: {},
    };
    mockCan = (cap: string) => (cap in mockCaps.capabilities ? !!mockCaps.capabilities[cap] : false);
    renderLayout();
    expect(screen.getByText("관제 전용")).toBeInTheDocument();
    // 관측 그룹 열기 → dashboard cap 인프라 화면 노출.
    fireEvent.click(within(getNav()).getByRole("button", { name: /^관측/ }));
    expect(within(getNav()).getByRole("button", { name: "노드" })).toBeInTheDocument();
    expect(within(getNav()).getByRole("button", { name: "토폴로지" })).toBeInTheDocument();
    // 제어 그룹: AI Agent(dashboard cap)=노출, 플레이그라운드(playground cap off)=숨음.
    fireEvent.click(within(getNav()).getByRole("button", { name: /^제어/ }));
    expect(within(getNav()).getByRole("button", { name: "AI Agent" })).toBeInTheDocument();
    expect(within(getNav()).queryByRole("button", { name: "플레이그라운드" })).not.toBeInTheDocument();
    // 연동 그룹: 가드레일(guard cap off)=숨음.
    fireEvent.click(within(getNav()).getByRole("button", { name: /^연동/ }));
    expect(within(getNav()).queryByRole("button", { name: "가드레일" })).not.toBeInTheDocument();
  });

  it("T7-빈그룹 숨김 — 그룹의 보이는 자식이 0이면 그룹 헤더 자체가 사라진다", () => {
    // dashboard cap off → 온톨로지(탐색 유일 자식)·근본원인 추적(추적 유일 자식) 모두 숨음 → 두 그룹 통째로 사라짐.
    mockCaps = {
      profile: "observe",
      readonly: true,
      capabilities: { dashboard: false, traces: true },
      data_source: "mock",
      integrations: {},
    };
    mockCan = (cap: string) => (cap in mockCaps.capabilities ? !!mockCaps.capabilities[cap] : false);
    renderLayout();
    expect(screen.queryByRole("button", { name: /^탐색/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^추적/ })).not.toBeInTheDocument();
  });
});
