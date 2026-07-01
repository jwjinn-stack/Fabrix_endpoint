import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Traces from "./Traces";
import { ToastProvider } from "../toast";
import type { TraceListReport, TraceDetail } from "../api/types";
import { takePrefill } from "./playgroundPrefill";

// IMP-37: 트레이스 상세 → "플레이그라운드에서 재현" 버튼이
//   (1) onNavigate("playground", { model }) 를 호출하고
//   (2) 모듈 핸드오프(setPrefill)에 prompt/model 을 담는지,
//   (3) observe(can("playground")=false)면 disable 되는지 검증.

const LIST: TraceListReport = {
  range: "24h",
  generated_at: "2026-06-30T00:00:00Z",
  source: "test",
  traces: [
    {
      trace_id: "t_replay", ts: "2026-06-30T00:00:00Z", model: "qwen3-32b", endpoint: "/v1/chat",
      app_id: "app1", dept_id: "d1", api_key_id: "k1", total_ms: 800, ttft_ms: 120, queue_ms: 5,
      decode_ms: 600, prompt_tokens: 40, completion_tokens: 80, cached_tokens: 0, tokens_per_sec: 50,
      total_cost_krw: 12, input_cost_krw: 4, output_cost_krw: 8, status: "ok", decision: "allowed",
      finish_reason: "stop", http_status: 200, stream: true,
    },
  ],
};

const DETAIL: TraceDetail = {
  summary: LIST.traces[0],
  spans: [
    {
      span_id: "s0", name: "chat qwen3-32b", kind: "generation", source: "langfuse",
      start_ms: 0, duration_ms: 800, status: "ok",
      attributes: { "gen_ai.request.model": "qwen3-32b", "gen_ai.request.temperature": 0.3, "gen_ai.request.max_tokens": 512 },
    },
  ],
  input_preview: "다음 함수의 시간복잡도를 분석해줘.",
  output_preview: "분석 결과는 다음과 같습니다.",
};

const fetchTraces = vi.fn();
const fetchTrace = vi.fn();
let canImpl = (_cap: string) => true;

vi.mock("../api/client", () => ({
  fetchTraces: (...a: unknown[]) => fetchTraces(...a),
  fetchTrace: (...a: unknown[]) => fetchTrace(...a),
  fetchTopology: vi.fn().mockResolvedValue({ generated_at: "2026-06-30T00:00:00Z", source: "test", nodes: [], edges: [] }),
  recordScore: vi.fn(),
}));

vi.mock("../capabilities", () => ({
  useCap: () => ({ caps: { readonly: false }, can: (c: string) => canImpl(c) }),
}));

const renderTraces = (onNavigate?: (...a: unknown[]) => void) =>
  render(<ToastProvider><Traces onNavigate={onNavigate as never} /></ToastProvider>);

async function openDetail() {
  // endpoint 셀("/v1/chat")은 표에서 유일 → 그 행을 클릭해 상세를 연다.
  const cell = await screen.findByText("/v1/chat");
  await act(async () => { fireEvent.click(cell.closest("tr")!); });
  await screen.findByText(/플레이그라운드에서 재현/);
}

describe("Traces replay → Playground (IMP-37)", () => {
  beforeEach(() => {
    fetchTraces.mockReset();
    fetchTrace.mockReset();
    fetchTraces.mockResolvedValue(LIST);
    fetchTrace.mockResolvedValue(DETAIL);
    canImpl = () => true;
    takePrefill(); // 이전 테스트 잔여 핸드오프 비우기
    window.history.replaceState(null, "", "/traces");
  });
  afterEach(() => vi.restoreAllMocks());

  it("T1/T2: 재현 버튼 클릭 → onNavigate(playground,{model}) + setPrefill(prompt/model/params)", async () => {
    const onNavigate = vi.fn();
    renderTraces(onNavigate);
    await openDetail();

    const btn = screen.getByRole("button", { name: /플레이그라운드에서 재현/ });
    expect(btn).not.toBeDisabled();
    await act(async () => { fireEvent.click(btn); });

    expect(onNavigate).toHaveBeenCalledWith("playground", { model: "qwen3-32b" });
    const p = takePrefill();
    expect(p).not.toBeNull();
    expect(p!.prompt).toBe("다음 함수의 시간복잡도를 분석해줘.");
    expect(p!.model).toBe("qwen3-32b");
    // span attributes 에서 추출된 params.
    expect(p!.temperature).toBe(0.3);
    expect(p!.maxTokens).toBe(512);
  });

  it("T4: observe(can('playground')=false) 면 재현 버튼 disabled", async () => {
    canImpl = (c: string) => c !== "playground";
    renderTraces(vi.fn());
    await openDetail();
    expect(screen.getByRole("button", { name: /플레이그라운드에서 재현/ })).toBeDisabled();
  });

  it("차단 트레이스 replay → prompt 빈 문자열 + note 안내", async () => {
    const blocked: TraceDetail = {
      ...DETAIL,
      summary: { ...DETAIL.summary, decision: "blocked" },
      input_preview: "[차단됨] …",
    };
    fetchTrace.mockResolvedValue(blocked);
    const onNavigate = vi.fn();
    renderTraces(onNavigate);
    await openDetail();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /플레이그라운드에서 재현/ })); });
    const p = takePrefill();
    expect(p!.prompt).toBe("");
    expect(p!.note).toMatch(/원문이 보존되지/);
  });
});
