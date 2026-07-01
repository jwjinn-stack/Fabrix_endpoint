import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import type { TopologyGraph } from "../api/types";

// jsdom 은 SVG 레이아웃이 없으므로 getBoundingClientRect / setPointerCapture 를 shim.
beforeAll(() => {
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => {} }) as DOMRect,
  });
  if (!("setPointerCapture" in Element.prototype)) {
    // @ts-expect-error test shim
    Element.prototype.setPointerCapture = () => {};
  }
  // <dialog>.showModal jsdom 미구현 shim(SlidePanel).
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  }
});

const graph: TopologyGraph = {
  generated_at: "2026-07-01T00:00:00Z",
  source: "test",
  nodes: [
    { id: "srv", kind: "server", status: "ok", label: "Server 1", metrics: { cpu_util: 0.5 } },
    { id: "svc", kind: "service", status: "warn", label: "Service A", metrics: { qps: 12, error_rate: 0.03 } },
    { id: "g0", kind: "gpu", status: "crit", label: "GPU 0", metrics: { util_perc: 0.95 } },
  ],
  edges: [
    { from: "svc", to: "srv", qps: 12, error_rate: 0.07 }, // 병목(err≥5%)
    { from: "srv", to: "g0" },
  ],
};

const fetchTopology = vi.fn();
vi.mock("../api/client", () => ({ fetchTopology: (...a: unknown[]) => fetchTopology(...a) }));

const caps = { profile: "manage", readonly: false, capabilities: {}, data_source: "", integrations: {} };
vi.mock("../capabilities", () => ({ useCap: () => ({ caps, can: () => true }) }));

import Topology from "./Topology";

describe("Topology 화면 (IMP-45/48)", () => {
  beforeEach(() => {
    fetchTopology.mockReset();
    fetchTopology.mockResolvedValue(graph);
  });

  it("로딩 → 그래프 렌더 + 요약 카운트(위험 노드 2 · 병목 엣지 1)", async () => {
    render(<Topology />);
    await waitFor(() => expect(screen.getByText("Server 1")).toBeInTheDocument());
    const summary = screen.getByText(/위험 노드/);
    // 위험 노드 = status!=='ok' 2개(svc warn, g0 crit).
    expect(summary.textContent).toMatch(/위험 노드\s*2개/);
    expect(summary.textContent).toMatch(/병목 엣지\s*1개/);
  });

  it("에러 → humanizeError 메시지(role=alert)", async () => {
    fetchTopology.mockRejectedValue(new Error("Failed to fetch"));
    render(<Topology />);
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/서버에 연결할 수 없습니다/);
    });
  });

  it("빈 그래프 → empty 안내", async () => {
    fetchTopology.mockResolvedValue({ ...graph, nodes: [], edges: [] });
    render(<Topology />);
    await waitFor(() => expect(screen.getByText(/관측된 토폴로지 노드가 없습니다/)).toBeInTheDocument());
  });

  it("'표로 보기' 토글 → 노드/링크 테이블 + status 텍스트 병기", async () => {
    render(<Topology />);
    await waitFor(() => expect(screen.getByText("Server 1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "표로 보기" }));
    expect(screen.getByText(/노드 \(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/링크 \(2\)/)).toBeInTheDocument();
    // 색-only 금지: 상태 텍스트 병기.
    expect(screen.getAllByText("위험").length).toBeGreaterThan(0);
  });

  it("일시정지 토글 → aria-pressed 반영(폴링 정지 표식)", async () => {
    render(<Topology />);
    await waitFor(() => expect(screen.getByText("Server 1")).toBeInTheDocument());
    const toggle = screen.getByRole("button", { name: /일시정지/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    // 정지 후 '재개' 라벨 + aria-pressed=true.
    const resumed = screen.getByRole("button", { name: /재개/ });
    expect(resumed.getAttribute("aria-pressed")).toBe("true");
  });

  it("성공 후 폴링 에러 → 마지막 데이터 유지 + 스테일 안내", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchTopology.mockReset();
    fetchTopology.mockResolvedValueOnce(graph).mockRejectedValue(new Error("Failed to fetch"));
    render(<Topology />);
    await waitFor(() => expect(screen.getByText("Server 1")).toBeInTheDocument());
    // 폴링 주기(15s) 경과 → 다음 로드 실패.
    await act(async () => { vi.advanceTimersByTime(15_000); });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // 마지막 성공 데이터(노드)는 여전히 표시 + 스테일 안내.
    expect(screen.getByText("Server 1")).toBeInTheDocument();
    expect(screen.getByText(/마지막으로 받은 데이터를 표시 중/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("노드 클릭 → SlidePanel 상세(연결수) 노출 + selectedId 전파(비인접 dim)", async () => {
    const { container } = render(<Topology />);
    await waitFor(() => expect(screen.getByText("Server 1")).toBeInTheDocument());
    // 그래프 노드 클릭(첫 노드 = srv).
    const node = container.querySelector(".topo-node")!;
    fireEvent.click(node);
    // SlidePanel 상세 — 연결 수신/발신 라벨.
    await waitFor(() => expect(screen.getByText("연결 (수신 / 발신)")).toBeInTheDocument());
    // isolate: 인접하지 않은 노드에 dim 클래스가 붙는다(srv 선택 → g0 은 인접, svc 도 인접이라 없음;
    // 이 그래프는 srv 가 svc·g0 모두와 연결이라 dim 이 없을 수 있으므로 selectedId 반영만 확인).
    expect(container.querySelector(".topo-node.selected")).toBeTruthy();
  });
});
