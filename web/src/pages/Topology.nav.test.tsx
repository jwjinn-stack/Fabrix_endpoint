import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { TopologyGraph } from "../api/types";

// IMP-50 — correlation moat: 토폴로지 노드 → 기존 화면 드릴다운(kind별 onNavigate) + LLM-aware 포지셔닝.

// jsdom SVG/dialog shim(SlidePanel · TopologyView).
beforeAll(() => {
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => {} }) as DOMRect,
  });
  if (!("setPointerCapture" in Element.prototype)) {
    // @ts-expect-error test shim
    Element.prototype.setPointerCapture = () => {};
  }
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  }
});

// 노드 순서: [0]=server, [1]=service, [2]=gpu — 인덱스로 클릭 대상 선택.
const graph: TopologyGraph = {
  generated_at: "2026-07-01T00:00:00Z",
  source: "test",
  nodes: [
    { id: "gpu-node-01", kind: "server", status: "warn", label: "gpu-node-01", metrics: { cpu_util: 0.82 } },
    { id: "qwen3-32b-router", kind: "service", status: "ok", label: "Qwen 서비스", metrics: { qps: 8, error_rate: 0.0 } },
    { id: "gpu-node-01/gpu0", kind: "gpu", status: "crit", label: "GPU0", metrics: { util_perc: 0.95 } },
  ],
  edges: [
    { from: "qwen3-32b-router", to: "gpu-node-01", qps: 8, error_rate: 0.0 },
    { from: "gpu-node-01", to: "gpu-node-01/gpu0" },
  ],
};

const fetchTopology = vi.fn();
// ObjectView(IMP-57) 가 온톨로지 fetch 를 호출하므로 함께 스텁(id 미존재 → 빈 상태, escape hatch 는 유지).
vi.mock("../api/client", () => ({
  fetchTopology: (...a: unknown[]) => fetchTopology(...a),
  fetchOntologyObject: () => Promise.reject(new Error("API 404")),
  fetchOntologyLinks: () => Promise.reject(new Error("API 404")),
  fetchOntologyObjects: () => Promise.resolve({ generated_at: "t", objects: [], source: "mock" }),
}));

const caps = { profile: "manage", readonly: false, capabilities: {}, data_source: "", integrations: {} };
vi.mock("../capabilities", () => ({ useCap: () => ({ caps, can: () => true }) }));

import Topology from "./Topology";

async function selectNode(container: HTMLElement, index: number) {
  const nodes = container.querySelectorAll(".topo-node");
  fireEvent.click(nodes[index]);
  // ObjectView(IMP-57) 오픈 → escape hatch('전체 페이지 열기')가 footer 에 노출.
  await waitFor(() => expect(screen.getByRole("button", { name: /전체 페이지 열기/ })).toBeInTheDocument());
}

describe("Topology 드릴다운 (IMP-50 correlation moat)", () => {
  const onNavigate = vi.fn();
  beforeEach(() => {
    fetchTopology.mockReset();
    onNavigate.mockReset();
    fetchTopology.mockResolvedValue(graph);
  });

  it("LLM-aware 포지셔닝 문구를 상단에 렌더한다", async () => {
    render(<Topology onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText("gpu-node-01")).toBeInTheDocument());
    expect(screen.getByText(/LLM-aware 인프라 관측/)).toBeInTheDocument();
  });

  it("service 노드 → Traces(모델 필터 시드)", async () => {
    const { container } = render(<Topology onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText("Qwen 서비스")).toBeInTheDocument());
    await selectNode(container, 1); // service
    fireEvent.click(screen.getByRole("button", { name: /전체 페이지 열기/ }));
    expect(onNavigate).toHaveBeenCalledWith("traces", { model: "qwen3-32b" });
  });

  it("gpu 노드 → Gpu 화면(host 시드)", async () => {
    const { container } = render(<Topology onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText("GPU0")).toBeInTheDocument());
    await selectNode(container, 2); // gpu
    fireEvent.click(screen.getByRole("button", { name: /전체 페이지 열기/ }));
    expect(onNavigate).toHaveBeenCalledWith("gpu", { host: "gpu-node-01" });
  });

  it("server 노드 → NodeMetrics(host 시드)", async () => {
    const { container } = render(<Topology onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText("gpu-node-01")).toBeInTheDocument());
    await selectNode(container, 0); // server
    fireEvent.click(screen.getByRole("button", { name: /전체 페이지 열기/ }));
    expect(onNavigate).toHaveBeenCalledWith("nodes", { host: "gpu-node-01" });
  });
});
