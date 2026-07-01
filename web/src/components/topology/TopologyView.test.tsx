import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, fireEvent, createEvent } from "@testing-library/react";
import TopologyView from "./TopologyView";
import { layoutTopology } from "./layout";
import type { TopologyGraph } from "../../api/types";

// jsdom 의 PointerEvent 는 clientX/Y 를 생성자에서 버린다 → 좌표를 강제 주입해 발사.
type PointerName = "pointerDown" | "pointerMove" | "pointerUp";
function firePointer(el: Element, name: PointerName, coords: { clientX?: number; clientY?: number; pointerId?: number } = {}) {
  const ev = createEvent[name](el, coords);
  if (coords.clientX != null) Object.defineProperty(ev, "clientX", { value: coords.clientX });
  if (coords.clientY != null) Object.defineProperty(ev, "clientY", { value: coords.clientY });
  fireEvent(el, ev);
}

// SVG 는 viewBox `0 0 W H` 가 화면 width=W, height=H px(left=0,top=0)로 렌더된다고 가정
// → client 좌표 == viewBox 좌표(1:1). getBoundingClientRect 를 그에 맞춰 mock.
beforeAll(() => {
  // jsdom 은 SVG 레이아웃이 없으므로 getBoundingClientRect 를 mock(Element.prototype 체인).
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function () {
      // TopologyView 는 svg width=100% + viewBox. 테스트에서는 레이아웃 width/height 로 1:1 매핑.
      return { left: 0, top: 0, width: RECT.w, height: RECT.h, right: RECT.w, bottom: RECT.h, x: 0, y: 0, toJSON: () => {} } as DOMRect;
    },
  });
  // jsdom 미구현 API guard.
  if (!("setPointerCapture" in Element.prototype)) {
    // @ts-expect-error test shim
    Element.prototype.setPointerCapture = () => {};
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
    { from: "srv", to: "svc" },
    { from: "svc", to: "g0" },
  ],
};

// 레이아웃에서 나온 실제 viewBox 크기(1:1 매핑용).
const L = layoutTopology(graph.nodes, graph.edges);
const RECT = { w: Math.max(L.width, 1), h: Math.max(L.height, 1) };

describe("TopologyView — hand-rolled SVG 렌더러 (IMP-47)", () => {
  it("노드 수만큼 status 링과 엣지 path 를 렌더한다", () => {
    const { container } = render(<TopologyView graph={graph} />);
    expect(container.querySelectorAll(".topo-node").length).toBe(3);
    expect(container.querySelectorAll(".topo-edge").length).toBe(2);
    // 공유 화살촉 마커 1개.
    expect(container.querySelector("marker#topo-arrow")).toBeTruthy();
  });

  it("노드 위 hover → ChartTooltip 에 라벨/지표가 escape 텍스트로 노출", () => {
    const { container, getByText } = render(<TopologyView graph={graph} />);
    const svg = container.querySelector("svg")!;
    const p = L.positions.get("svc")!;
    firePointer(svg, "pointerMove", { clientX: p.x, clientY: p.y });
    // 툴팁은 foreignObject 안 .chart-tooltip. "qps" 지표 행이 escape 텍스트로 노출.
    expect(getByText("qps")).toBeInTheDocument();
    expect(container.querySelector(".chart-tooltip")).toBeTruthy();
  });

  it("노드 클릭 → onSelect(nodeId) 호출", () => {
    const onSelect = vi.fn();
    const { container } = render(<TopologyView graph={graph} onSelect={onSelect} />);
    const node = container.querySelectorAll(".topo-node")[0];
    fireEvent.click(node);
    expect(onSelect).toHaveBeenCalledWith("srv");
  });

  it("interactive=false(observe read-only): 노드 drag 로 위치가 바뀌지 않는다", () => {
    const { container } = render(<TopologyView graph={graph} interactive={false} />);
    const svg = container.querySelector("svg")!;
    const p = L.positions.get("srv")!;
    const before = container.querySelector(".topo-node")!.getAttribute("transform");
    firePointer(svg, "pointerDown", { clientX: p.x, clientY: p.y, pointerId: 1 });
    firePointer(svg, "pointerMove", { clientX: p.x + 80, clientY: p.y + 40, pointerId: 1 });
    firePointer(svg, "pointerUp", { pointerId: 1 });
    const after = container.querySelector(".topo-node")!.getAttribute("transform");
    // read-only 에서는 배경 pan 만 되고 노드 override 는 발생하지 않음 → transform 동일.
    expect(after).toBe(before);
  });

  it("interactive=true: 노드 drag 로 위치 override 가 적용된다", () => {
    const { container } = render(<TopologyView graph={graph} interactive={true} />);
    const svg = container.querySelector("svg")!;
    const p = L.positions.get("srv")!;
    const before = container.querySelector(".topo-node")!.getAttribute("transform");
    firePointer(svg, "pointerDown", { clientX: p.x, clientY: p.y, pointerId: 1 });
    firePointer(svg, "pointerMove", { clientX: p.x + 80, clientY: p.y + 40, pointerId: 1 });
    firePointer(svg, "pointerUp", { pointerId: 1 });
    const after = container.querySelector(".topo-node")!.getAttribute("transform");
    expect(after).not.toBe(before);
  });

  it("키보드 roving focus: ArrowRight 후 Enter → 첫 노드 onSelect", () => {
    const onSelect = vi.fn();
    const { container } = render(<TopologyView graph={graph} onSelect={onSelect} />);
    const svg = container.querySelector("svg")!;
    fireEvent.keyDown(svg, { key: "ArrowRight" }); // focusIdx 0
    fireEvent.keyDown(svg, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("srv");
  });

  // ── IMP-48 시각 완성도 ──
  it("micro-metric: service 노드에 qps·error% 가 body 안에 임베드된다", () => {
    const { container } = render(<TopologyView graph={graph} />);
    expect(container.querySelectorAll(".topo-node-metric").length).toBeGreaterThan(0);
    // status 글리프도 색-only 금지 위해 병기.
    expect(container.querySelectorAll(".topo-node-glyph").length).toBe(3);
  });

  it("directional 엣지: 트래픽(qps) 비례로 stroke-width 가 달라진다", () => {
    const wide: TopologyGraph = {
      generated_at: "t", source: "test",
      nodes: [
        { id: "a", kind: "service", status: "ok", label: "A" },
        { id: "b", kind: "service", status: "ok", label: "B" },
        { id: "c", kind: "service", status: "ok", label: "C" },
      ],
      edges: [
        { from: "a", to: "b", qps: 40 }, // 굵게
        { from: "b", to: "c", qps: 1 }, // 얇게
      ],
    };
    const { container } = render(<TopologyView graph={wide} />);
    const paths = Array.from(container.querySelectorAll<SVGPathElement>(".topo-edge"));
    const widths = paths.map((p) => parseFloat(p.getAttribute("stroke-width") || "0"));
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths));
  });

  it("click-isolate: selectedId 의 비인접 노드는 dim 클래스가 붙는다", () => {
    const iso: TopologyGraph = {
      generated_at: "t", source: "test",
      nodes: [
        { id: "a", kind: "service", status: "ok", label: "A" },
        { id: "b", kind: "service", status: "ok", label: "B" },
        { id: "z", kind: "service", status: "ok", label: "Z" }, // a 와 비인접
      ],
      edges: [{ from: "a", to: "b" }],
    };
    const { container } = render(<TopologyView graph={iso} selectedId="a" />);
    // a 선택 → a·b 는 인접, z 는 dim.
    const zNode = Array.from(container.querySelectorAll(".topo-node")).find((g) =>
      g.getAttribute("aria-label")?.startsWith("Z"),
    );
    expect(zNode?.classList.contains("dim")).toBe(true);
    expect(container.querySelector(".topo-node.selected")).toBeTruthy();
  });
});
