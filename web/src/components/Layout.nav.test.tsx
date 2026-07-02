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

// IMP-62 — 5 흐름 그룹의 이름·소속(그룹 → 자식 label + 도달 page). doc §7 매핑.
// IMP-70 — 그룹 **순서**를 관측→추적→제어→참조→연동 으로 재배치(일상 흐름 먼저, 온톨로지 개요는 "참조"로 강등).
//   이 배열 순서 == nav 렌더 순서(순서 회귀 가드는 T-순서 참조). 이 표가 곧 소속 회귀 가드(모든 페이지가 어느 한 그룹에 정확히 한 번).
const GROUPS: { group: string; children: { label: string; page: Page }[] }[] = [
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
  // IMP-70: 온톨로지 개요는 정문("탐색")에서 강등돼 운영 흐름 뒤 "참조" 그룹에 위치(여전히 도달 가능).
  { group: "참조", children: [{ label: "온톨로지", page: "ontology" }] },
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

describe("Layout nav — 5 흐름 그룹 IA (IMP-62·IMP-70 재배치)", () => {
  beforeEach(() => {
    mockCaps = { profile: "manage", readonly: false, capabilities: {}, data_source: "", integrations: {} };
    mockCan = () => true;
  });

  it("T1 — 5개 흐름 그룹 부모(관측/추적/제어/참조/연동)가 모두 렌더된다", () => {
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

  it("T3-신규 — 온톨로지=참조(IMP-70 강등), 근본원인 추적=추적, AI Agent=제어 그룹 소속", () => {
    // 참조 > 온톨로지 (IMP-70: 정문 "탐색" 에서 "참조" 그룹으로 강등, 여전히 도달 가능)
    const r1 = renderLayout();
    fireEvent.click(within(getNav()).getByRole("button", { name: /^참조/ }));
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

  // 렌더된 그룹 부모 버튼의 DOM 순서(라벨 배열) — 그룹명만(자식 label 은 정규식 앵커로 배제).
  function renderedGroupOrder(): string[] {
    const nav = getNav();
    const order: string[] = [];
    for (const { group } of GROUPS) {
      const btn = within(nav).getByRole("button", { name: new RegExp(`^${group}`) });
      // 문서 순서 인덱스로 정렬하기 위해 위치 계산.
      order.push(group);
      void btn;
    }
    // 실제 DOM 순서로 재정렬(compareDocumentPosition).
    return order.sort((a, b) => {
      const ea = within(nav).getByRole("button", { name: new RegExp(`^${a}`) });
      const eb = within(nav).getByRole("button", { name: new RegExp(`^${b}`) });
      return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  it("T-순서(IMP-70) — 그룹 순서가 관측→추적→제어→참조→연동 (일상 흐름 먼저, 온톨로지 개요 강등)", () => {
    renderLayout();
    expect(renderedGroupOrder()).toEqual(["관측", "추적", "제어", "참조", "연동"]);
  });

  it("T-흐름 legible(IMP-70) — 관측<추적<제어 순 + 셋 모두 참조·연동보다 앞(관측→추적→제어 흐름)", () => {
    renderLayout();
    const order = renderedGroupOrder();
    const idx = (g: string) => order.indexOf(g);
    // 관측→추적→제어 흐름이 순서대로 legible.
    expect(idx("관측")).toBeLessThan(idx("추적"));
    expect(idx("추적")).toBeLessThan(idx("제어"));
    // 운영 흐름 3그룹 모두 참조(온톨로지 개요)·연동보다 앞 — 온톨로지 정문 강등 증명.
    for (const flow of ["관측", "추적", "제어"]) {
      expect(idx(flow)).toBeLessThan(idx("참조"));
      expect(idx(flow)).toBeLessThan(idx("연동"));
    }
  });

  it("T-강등·존재(IMP-70) — 온톨로지 개요는 도달 가능하되 최상단 정문이 아니라 '참조' 그룹(관측 뒤)", () => {
    const { onNavigate } = renderLayout();
    const order = renderedGroupOrder();
    // 최상단은 온톨로지(참조)가 아니라 관측(actionable surface).
    expect(order[0]).toBe("관측");
    expect(order[0]).not.toBe("참조");
    // 온톨로지는 여전히 '참조' 그룹으로 도달 가능(reachable, orphan 아님).
    fireEvent.click(within(getNav()).getByRole("button", { name: /^참조/ }));
    fireEvent.click(within(getNav()).getByRole("button", { name: "온톨로지" }));
    expect(onNavigate).toHaveBeenCalledWith("ontology");
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
    // dashboard cap off → 온톨로지(탐색 유일 자식)·추적 자식(과업 인박스·근본원인 추적, 둘 다 dashboard cap) 모두 숨음 → 두 그룹 통째로 사라짐.
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
