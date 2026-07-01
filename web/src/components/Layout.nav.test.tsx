import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// capabilities 를 프로파일별로 주입 가능하게 mock. 기본 manage(전부 허용).
let mockCaps = { profile: "manage", readonly: false, capabilities: {} as Record<string, boolean>, data_source: "", integrations: {} };
let mockCan = (_cap: string) => true;
vi.mock("../capabilities", () => ({ useCap: () => ({ caps: mockCaps, can: mockCan }) }));
// nav 구조만 검증 — Toast/포털 의존 자식은 스텁.
vi.mock("./Notifications", () => ({ default: () => null }));
vi.mock("./CommandPalette", () => ({ default: () => null }));

import Layout from "./Layout";

function renderLayout(page: Parameters<typeof Layout>[0]["page"] = "dashboard") {
  const onNavigate = vi.fn();
  render(
    <Layout page={page} onNavigate={onNavigate}>
      <div>content</div>
    </Layout>,
  );
  return { onNavigate };
}

describe("Layout nav — 인프라·관측 그룹 (IMP-53)", () => {
  beforeEach(() => {
    mockCaps = { profile: "manage", readonly: false, capabilities: {}, data_source: "", integrations: {} };
    mockCan = () => true;
  });

  it("T1 — '인프라 · 관측' 그룹 부모가 렌더된다", () => {
    renderLayout();
    expect(screen.getByRole("button", { name: /인프라 · 관측/ })).toBeInTheDocument();
  });

  it("T2 — 그룹 부모 클릭 → 확장되어 children(노드·네트워크·토폴로지·GPU·트래픽) 노출", () => {
    renderLayout();
    const parent = screen.getByRole("button", { name: /인프라 · 관측/ });
    expect(parent.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(parent);
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });
    expect(within(nav).getByRole("button", { name: "노드" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "네트워크" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "토폴로지" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "GPU / MIG" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "트래픽" })).toBeInTheDocument();
  });

  it("T2b — 현재 페이지가 그룹 자식이면 그룹이 자동 확장된다", () => {
    renderLayout("nodes");
    const parent = screen.getByRole("button", { name: /인프라 · 관측/ });
    expect(parent.getAttribute("aria-expanded")).toBe("true");
  });

  it("T2c — 자식 클릭 → 해당 페이지로 이동(onNavigate)", () => {
    const { onNavigate } = renderLayout();
    fireEvent.click(screen.getByRole("button", { name: /인프라 · 관측/ }));
    fireEvent.click(screen.getByRole("button", { name: "네트워크" }));
    expect(onNavigate).toHaveBeenCalledWith("network");
  });

  it("T3 — observe(dashboard on, mutating off): 3 인프라 화면 노출 + '관제 전용' 배지", () => {
    // observe: dashboard=true, mutating 계열 미허용(readonly=true).
    mockCaps = {
      profile: "observe",
      readonly: true,
      capabilities: { dashboard: true, traces: true, guard: true, models: true },
      data_source: "mock",
      integrations: {},
    };
    mockCan = (cap: string) => (cap in mockCaps.capabilities ? !!mockCaps.capabilities[cap] : true);
    renderLayout();
    // 읽기전용 배지.
    expect(screen.getByText("관제 전용")).toBeInTheDocument();
    // 그룹 열고 3화면 노출 확인(전부 dashboard cap → observe 노출).
    fireEvent.click(screen.getByRole("button", { name: /인프라 · 관측/ }));
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });
    expect(within(nav).getByRole("button", { name: "노드" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "네트워크" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "토폴로지" })).toBeInTheDocument();
  });

  it("T3b — dashboard cap off 면 인프라 그룹 자체가 숨는다(children 전부 숨김)", () => {
    mockCaps = {
      profile: "observe",
      readonly: true,
      capabilities: { dashboard: false, traces: true },
      data_source: "mock",
      integrations: {},
    };
    mockCan = (cap: string) => (cap in mockCaps.capabilities ? !!mockCaps.capabilities[cap] : true);
    renderLayout();
    expect(screen.queryByRole("button", { name: /인프라 · 관측/ })).not.toBeInTheDocument();
  });
});
