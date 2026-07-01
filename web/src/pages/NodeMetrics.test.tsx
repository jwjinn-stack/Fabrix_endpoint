import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { NodeMetrics, NodePoint } from "../api/types";

// <dialog>.showModal jsdom 미구현 shim(SlidePanel).
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  }
});

// 상태를 강제할 수 있게 마지막 point 값을 파라미터로 받는 헬퍼.
function makeNode(host: string, overrides: Partial<NodePoint>): NodeMetrics {
  const base: NodePoint = {
    ts: "2026-07-01T00:00:00Z",
    cpu_util: 0.3, mem_util: 0.4, disk_util: 0.3,
    load1: 4, swap_used_perc: 0.02, disk_io_perc: 0.2,
    net_rx_mbps: 500, net_tx_mbps: 400, net_err_per_s: 0.5,
  };
  const p0 = { ...base, ts: "2026-07-01T00:00:00Z" };
  const p1 = { ...base, ...overrides, ts: "2026-07-01T00:01:00Z" };
  return { generated_at: "2026-07-01T00:01:00Z", host, status: "ok", points: [p0, p1], source: "node-exporter (mock)" };
}

const fetchNodeMetrics = vi.fn();
// IMP-71 — HostDetail 하단에 Metric Explorer(<details>)가 있어 fetchObjectMetricTree 를 호출한다. 빈 트리로 스텁.
vi.mock("../api/client", () => ({
  fetchNodeMetrics: (...a: unknown[]) => fetchNodeMetrics(...a),
  fetchObjectMetricTree: (id: string) => Promise.resolve({
    generated_at: "t", object_id: id, object_type: "Node", range: "1h",
    categories: [], facet_keys: [], source: "metric-explorer (mock)",
  }),
}));

// 페이지가 요청한 host 로 결정적 응답을 준다. 01=정상, 02=위험(swap crit), 03=주의(cpu warn).
function respond(host: string): NodeMetrics {
  if (host === "gpu-node-02") return makeNode(host, { swap_used_perc: 0.6 }); // crit
  if (host === "gpu-node-03") return makeNode(host, { cpu_util: 0.85 }); // warn
  return makeNode(host, {}); // ok
}

import NodeMetricsPage from "./NodeMetrics";

describe("NodeMetrics 화면 (IMP-46 · USE/골든시그널)", () => {
  beforeEach(() => {
    fetchNodeMetrics.mockReset();
    fetchNodeMetrics.mockImplementation((host: string) => Promise.resolve(respond(host)));
  });

  it("로딩 → USE 세트 호스트 카드(3대) 렌더 + mock 배지 표시", async () => {
    render(<NodeMetricsPage />);
    await waitFor(() => expect(screen.getByText("gpu-node-01")).toBeInTheDocument());
    expect(screen.getByText("gpu-node-02")).toBeInTheDocument();
    expect(screen.getByText("gpu-node-03")).toBeInTheDocument();
    // mock 배지 + cause/RED 구분 안내.
    expect(screen.getByText("mock 데이터")).toBeInTheDocument();
    expect(screen.getByText(/원인\(cause\)/)).toBeInTheDocument();
    // 핵심 USE 라벨(fleet 카드) — CPU·메모리·Load·Swap 등.
    expect(screen.getAllByText("CPU").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Swap").length).toBeGreaterThan(0);
  });

  it("임계 초과 호스트가 상단 정렬(위험 > 주의 > 정상)", async () => {
    render(<NodeMetricsPage />);
    await waitFor(() => expect(screen.getByText("gpu-node-01")).toBeInTheDocument());
    const cards = document.querySelectorAll(".node-card h3");
    const order = Array.from(cards).map((el) => el.textContent);
    // node-02(crit) 먼저, node-03(warn) 다음, node-01(ok) 마지막.
    expect(order).toEqual(["gpu-node-02", "gpu-node-03", "gpu-node-01"]);
  });

  it("색-only 금지: 상태 텍스트(위험/주의/정상) 병기", async () => {
    render(<NodeMetricsPage />);
    await waitFor(() => expect(screen.getByText("gpu-node-01")).toBeInTheDocument());
    expect(screen.getAllByText("위험").length).toBeGreaterThan(0);
    expect(screen.getAllByText("주의").length).toBeGreaterThan(0);
    expect(screen.getAllByText("정상").length).toBeGreaterThan(0);
  });

  it("카드 클릭 → SlidePanel 상세(전체 USE 스파크라인 + 그룹) 노출", async () => {
    render(<NodeMetricsPage />);
    await waitFor(() => expect(screen.getByText("gpu-node-02")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /gpu-node-02 상세/ }));
    await waitFor(() => expect(screen.getByText(/노드 상세 — gpu-node-02/)).toBeInTheDocument());
    const dialog = screen.getByRole("dialog");
    // USE 그룹 제목 + 전체 신호(Disk IO·Net RX 등 fleet 카드엔 없는 것도).
    expect(within(dialog).getByText(/포화 \(Saturation\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/트래픽 \(Traffic\)/)).toBeInTheDocument();
    expect(within(dialog).getByText("Net RX")).toBeInTheDocument();
  });

  // ── IMP-80 — 3층 위계 레이아웃(요약 스트립 → 카테고리 카드 그리드 → 전체 메트릭) ──
  it("IMP-80 Tier1: 상세 상단 요약 스트립에 KPI 게이지(상태 텍스트 병기 aria) 렌더", async () => {
    render(<NodeMetricsPage />);
    await waitFor(() => expect(screen.getByText("gpu-node-02")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /gpu-node-02 상세/ }));
    await waitFor(() => expect(screen.getByText(/노드 상세 — gpu-node-02/)).toBeInTheDocument());
    const dialog = screen.getByRole("dialog");
    const strip = within(dialog).getByRole("group", { name: "핵심 지표 요약" });
    // 게이지(role=img) ≥1, aria-label 에 상태 텍스트(정상/주의/위험) 병기(색-only 아님).
    const gauges = within(strip).getAllByRole("img");
    expect(gauges.length).toBeGreaterThan(0);
    expect(gauges.every((g) => /정상|주의|위험/.test(g.getAttribute("aria-label") ?? ""))).toBe(true);
  });

  it("IMP-80 Tier2: USE 카테고리 카드 4장 그리드 + 헤더 접기/펼치기", async () => {
    render(<NodeMetricsPage />);
    await waitFor(() => expect(screen.getByText("gpu-node-02")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /gpu-node-02 상세/ }));
    await waitFor(() => expect(screen.getByText(/노드 상세 — gpu-node-02/)).toBeInTheDocument());
    const dialog = screen.getByRole("dialog");
    const cards = dialog.querySelectorAll(".metric-cat-card");
    expect(cards.length).toBe(4); // Utilization / Saturation / Errors / Traffic
    // 접기/펼치기 — Utilization 카드 헤더 클릭 시 aria-expanded 토글.
    const utilHead = within(dialog).getByRole("button", { name: /사용량 \(Utilization\)/ });
    expect(utilHead).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(utilHead);
    expect(utilHead).toHaveAttribute("aria-expanded", "false");
  });

  it("IMP-80 Tier2: 각 카테고리 카드 헤더에 mini 스파크라인(svg)", async () => {
    render(<NodeMetricsPage />);
    await waitFor(() => expect(screen.getByText("gpu-node-02")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /gpu-node-02 상세/ }));
    await waitFor(() => expect(screen.getByText(/노드 상세 — gpu-node-02/)).toBeInTheDocument());
    const dialog = screen.getByRole("dialog");
    const sparks = dialog.querySelectorAll(".metric-cat-spark svg.sparkline");
    expect(sparks.length).toBe(4); // 카테고리 카드마다 대표 신호 스파크라인.
  });

  it("IMP-80: 색-only 금지 — 위험 노드 상세에 '위험' 상태 텍스트 병기", async () => {
    render(<NodeMetricsPage />);
    await waitFor(() => expect(screen.getByText("gpu-node-02")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /gpu-node-02 상세/ }));
    await waitFor(() => expect(screen.getByText(/노드 상세 — gpu-node-02/)).toBeInTheDocument());
    const dialog = screen.getByRole("dialog");
    // node-02 는 swap crit → 상세 어딘가에 '위험' 텍스트(요약 스트립 + Saturation 카드 행).
    expect(within(dialog).getAllByText(/위험/).length).toBeGreaterThan(0);
  });

  it("IMP-80 Tier3: '전체 메트릭' disclosure(IMP-71 explorer) 유지 — 회귀 없음", async () => {
    render(<NodeMetricsPage />);
    await waitFor(() => expect(screen.getByText("gpu-node-02")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /gpu-node-02 상세/ }));
    await waitFor(() => expect(screen.getByText(/노드 상세 — gpu-node-02/)).toBeInTheDocument());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/전체 메트릭/)).toBeInTheDocument();
  });

  it("에러(모든 호스트 실패) → humanizeError 메시지(role=alert)", async () => {
    fetchNodeMetrics.mockRejectedValue(new Error("Failed to fetch"));
    render(<NodeMetricsPage />);
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/서버에 연결할 수 없습니다/);
    });
  });

  it("빈(0 포인트) → empty 안내", async () => {
    fetchNodeMetrics.mockImplementation((host: string) =>
      Promise.resolve({ ...respond(host), points: [] }),
    );
    render(<NodeMetricsPage />);
    await waitFor(() => expect(screen.getByText(/관측된 노드 메트릭이 없습니다/)).toBeInTheDocument());
  });
});
