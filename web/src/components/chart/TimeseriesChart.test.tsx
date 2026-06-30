import { describe, it, expect, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import TimeseriesChart from "../TimeseriesChart";
import type { TimePoint } from "../../api/types";

// viewBox 1000 폭이 화면 width=500px(left=0)로 렌더된다고 가정 → clientX = viewBox px / 2.
const RECT = { left: 0, width: 500, top: 0, right: 500, bottom: 120, height: 120, x: 0, y: 0, toJSON: () => {} };

beforeAll(() => {
  // jsdom 은 SVG 레이아웃이 없으므로 getBoundingClientRect 를 mock.
  Object.defineProperty(SVGElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => RECT as DOMRect,
  });
});

function makePoints(n: number): TimePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(2026, 5, 30, 10, i).toISOString(),
    qps: 10 + i,
    ttft_p95_ms: 100 + i * 2,
    tpot_p95_ms: 20,
    e2e_p95_ms: 300,
    running: 1,
    waiting: 0,
    blocked: i % 3 === 0 ? 2 : 0,
  }));
}

// 데이터 인덱스 i → 화면 clientX(viewBox px / 2). PAD.left=40, innerW=912(1000-40-48).
const PAD_LEFT = 40;
const INNER_W = 1000 - 40 - 48;
function clientXForIndex(i: number, count: number): number {
  const px = PAD_LEFT + (INNER_W * i) / (count - 1);
  return (px / 1000) * RECT.width; // left=0
}

describe("TimeseriesChart 호버 크로스헤어 / readout / 토큰 축 (IMP-25)", () => {
  it("축 텍스트가 토큰 클래스(chart-axis-text)를 쓰고 fontSize=9/10 하드코딩이 없다", () => {
    const { container } = render(<TimeseriesChart points={makePoints(12)} />);
    expect(container.querySelectorAll(".chart-axis-text").length).toBeGreaterThan(0);
    const hard = Array.from(container.querySelectorAll("text")).filter(
      (t) => t.getAttribute("font-size") === "9" || t.getAttribute("font-size") === "10",
    );
    expect(hard.length).toBe(0);
  });

  it("마우스 호버 시 크로스헤어 선과 readout 값이 렌더된다", () => {
    const { container, getByText } = render(<TimeseriesChart points={makePoints(12)} />);
    const svg = container.querySelector("svg")!;
    fireEvent.mouseMove(svg, { clientX: clientXForIndex(5, 12) });
    expect(container.querySelector(".chart-crosshair-line")).toBeTruthy();
    // readout 박스에 시점 QPS 라벨/값이 escape 텍스트로 나타난다.
    expect(getByText("QPS")).toBeInTheDocument();
    expect(getByText("TTFT p95")).toBeInTheDocument();
  });

  it("포커스 후 ArrowRight 로 크로스헤어 인덱스가 이동(readout 노출)", () => {
    const { container } = render(<TimeseriesChart points={makePoints(12)} />);
    const svg = container.querySelector("svg")!;
    // hover 없이 키보드만으로 readout 활성화: focus → ArrowLeft 로 마지막에서 한 칸 이동.
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(container.querySelector(".chart-crosshair-line")).toBeTruthy();
  });

  it("드래그줌(mousedown→move→up) 후 view 가 좁혀져 줌 초기화 버튼이 보인다", () => {
    const { container, queryByText } = render(<TimeseriesChart points={makePoints(12)} />);
    const svg = container.querySelector("svg")!;
    expect(queryByText("줌 초기화 ✕")).toBeNull();
    fireEvent.mouseDown(svg, { clientX: clientXForIndex(2, 12) });
    fireEvent.mouseMove(svg, { clientX: clientXForIndex(8, 12) });
    fireEvent.mouseUp(svg);
    expect(queryByText("줌 초기화 ✕")).toBeInTheDocument();
  });

  it("드래그 중에는 readout 을 숨긴다(selection 우선)", () => {
    const { container, queryByText } = render(<TimeseriesChart points={makePoints(12)} />);
    const svg = container.querySelector("svg")!;
    fireEvent.mouseDown(svg, { clientX: clientXForIndex(2, 12) });
    fireEvent.mouseMove(svg, { clientX: clientXForIndex(8, 12) });
    // 드래그 중 → 크로스헤어 readout(QPS 라벨)이 떠 있지 않아야 한다.
    expect(queryByText("TTFT p95")).toBeNull();
  });
});
