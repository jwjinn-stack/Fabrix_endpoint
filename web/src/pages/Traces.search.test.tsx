import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import Traces from "./Traces";
import { ToastProvider } from "../toast";
import type { TraceListReport } from "../api/types";

const renderTraces = () => render(<ToastProvider><Traces /></ToastProvider>);

// IMP-32: 트레이스 전문검색(q) 검색창이 useUrlState(IMP-24)와 정합되게 동작하는지.
// fetchTraces 를 모킹해 q 가 filters 로 전달되는지 + URL 되쓰기(디바운스) + q 칩을 검증.

const EMPTY: TraceListReport = { range: "24h", generated_at: "2026-06-30T00:00:00Z", traces: [], source: "test" };
const fetchTraces = vi.fn();

vi.mock("../api/client", () => ({
  fetchTraces: (...a: unknown[]) => fetchTraces(...a),
  fetchTrace: vi.fn(),
  fetchTopology: vi.fn().mockResolvedValue({ generated_at: "2026-06-30T00:00:00Z", source: "test", nodes: [], edges: [] }),
  recordScore: vi.fn(),
}));

describe("Traces 전문검색(q) — IMP-32", () => {
  beforeEach(() => {
    fetchTraces.mockReset();
    fetchTraces.mockResolvedValue(EMPTY);
    window.history.replaceState(null, "", "/traces");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("검색창 입력 → URL state(q) 디바운스 되쓰기 + fetchTraces 가 q 전달", async () => {
    renderTraces();
    const box = screen.getByLabelText("트레이스 전문검색") as HTMLInputElement;

    await act(async () => {
      fireEvent.change(box, { target: { value: "환불" } });
    });
    // 입력은 즉시 반영(로컬 state).
    expect(box.value).toBe("환불");

    // 디바운스(300ms) 후 URL 에 q 가 되쓰여야 한다.
    await waitFor(() => expect(window.location.search).toContain("q=%ED%99%98%EB%B6%88"));

    // fetchTraces 가 q 를 담은 filters 로 호출됨.
    await waitFor(() =>
      expect(fetchTraces).toHaveBeenCalledWith(
        "24h",
        expect.objectContaining({ q: "환불" }),
        expect.anything(),
      ),
    );
  });

  it("q 활성 시 q 칩 노출 + 지우기 → q 제거", async () => {
    window.history.replaceState(null, "", "/traces?q=qwen3");
    renderTraces();

    // 시드된 q 칩 노출.
    expect(screen.getByText(/검색: "qwen3"/)).toBeInTheDocument();

    const clear = screen.getByLabelText("검색어 지우기");
    await act(async () => {
      fireEvent.click(clear);
    });
    // 칩이 사라지고 URL 에서 q 제거.
    await waitFor(() => expect(screen.queryByText(/검색: "qwen3"/)).not.toBeInTheDocument());
    expect(window.location.search).not.toContain("q=");
  });
});
