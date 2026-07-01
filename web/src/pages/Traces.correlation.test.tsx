import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Traces from "./Traces";
import { ToastProvider } from "../toast";
import type { TraceListReport, TraceDetail, TopologyGraph } from "../api/types";

// IMP-50 — trace ↔ infra 상관: 트레이스 상세에 "이 요청 시각 GPU/호스트 pressure" 한 줄 요약 + 인프라 드릴다운.

// SlidePanel <dialog>.showModal jsdom shim.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  }
});

// endpoint = "qwen3-32b-router" (토폴로지 service 노드 id 와 join).
const LIST: TraceListReport = {
  range: "24h", generated_at: "2026-06-30T00:00:00Z", source: "test",
  traces: [{
    trace_id: "t_corr", ts: "2026-06-30T00:00:00Z", model: "qwen3-32b", endpoint: "qwen3-32b-router",
    app_id: "app1", dept_id: "d1", api_key_id: "k1", total_ms: 800, ttft_ms: 120, queue_ms: 5,
    decode_ms: 600, prompt_tokens: 40, completion_tokens: 80, cached_tokens: 0, tokens_per_sec: 50,
    total_cost_krw: 12, input_cost_krw: 4, output_cost_krw: 8, status: "ok", decision: "allowed",
    finish_reason: "stop", http_status: 200, stream: true,
  }],
};
const DETAIL: TraceDetail = {
  summary: LIST.traces[0],
  spans: [{ span_id: "s0", name: "chat", kind: "generation", source: "langfuse", start_ms: 0, duration_ms: 800, status: "ok", attributes: {} }],
  input_preview: "질문", output_preview: "답변",
};

// host gpu-node-01 이 warn + GPU crit → pressure.
const GRAPH: TopologyGraph = {
  generated_at: "2026-06-30T00:00:00Z", source: "test",
  nodes: [
    { id: "gpu-node-01", kind: "server", status: "warn", label: "gpu-node-01", metrics: { cpu_util: 0.82 } },
    { id: "gpu-node-01/gpu0", kind: "gpu", status: "crit", label: "GPU0", metrics: { util_perc: 0.95 } },
    { id: "qwen3-32b-router", kind: "service", status: "ok", label: "Qwen", metrics: { qps: 8, error_rate: 0.0 } },
  ],
  edges: [
    { from: "gpu-node-01", to: "gpu-node-01/gpu0" },
    { from: "qwen3-32b-router", to: "gpu-node-01", qps: 8, error_rate: 0.0 },
  ],
};

const fetchTraces = vi.fn();
const fetchTrace = vi.fn();
const fetchTopology = vi.fn();
vi.mock("../api/client", () => ({
  fetchTraces: (...a: unknown[]) => fetchTraces(...a),
  fetchTrace: (...a: unknown[]) => fetchTrace(...a),
  fetchTopology: (...a: unknown[]) => fetchTopology(...a),
  recordScore: vi.fn(),
}));
vi.mock("../capabilities", () => ({ useCap: () => ({ caps: { readonly: false }, can: () => true }) }));

async function openDetail() {
  const cell = await screen.findByText("qwen3-32b-router");
  await act(async () => { fireEvent.click(cell.closest("tr")!); });
}

describe("Traces ↔ infra 상관 (IMP-50)", () => {
  beforeEach(() => {
    fetchTraces.mockReset(); fetchTrace.mockReset(); fetchTopology.mockReset();
    fetchTraces.mockResolvedValue(LIST);
    fetchTrace.mockResolvedValue(DETAIL);
    fetchTopology.mockResolvedValue(GRAPH);
    window.history.replaceState(null, "", "/traces");
  });

  it("상관 요약 한 줄 + 인프라 압박 태그를 렌더한다", async () => {
    render(<ToastProvider><Traces onNavigate={vi.fn()} /></ToastProvider>);
    await openDetail();
    expect(await screen.findByText("인프라 압박")).toBeInTheDocument();
    expect(screen.getByText(/gpu-node-01/)).toBeInTheDocument();
  });

  it("'인프라 상세로' 버튼 → onNavigate(nodes, {host})", async () => {
    const onNavigate = vi.fn();
    render(<ToastProvider><Traces onNavigate={onNavigate} /></ToastProvider>);
    await openDetail();
    const btn = await screen.findByRole("button", { name: /인프라 상세로/ });
    await act(async () => { fireEvent.click(btn); });
    expect(onNavigate).toHaveBeenCalledWith("nodes", { host: "gpu-node-01" });
  });
});
