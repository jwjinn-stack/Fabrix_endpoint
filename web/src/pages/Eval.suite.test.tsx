import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import Eval from "./Eval";
import type { EvalDataset, Experiment, ModelCatalog } from "../api/types";

// IMP-39 — eval suite UI: 탭 전환(Single/Datasets/Experiments), 데이터셋 목록,
// experiment run×case 매트릭스, 두 run 비교 시 delta regression(▼) 표시.

const CATALOG: ModelCatalog = {
  generated_at: "2026-06-30T00:00:00Z",
  models: [
    { id: "gemma-3-27b-it", display_name: "Gemma 3 27B", provider: "google", type: "chat", context_window: 8192, serving: "vllm", namespace: "llm", status: "ready", playground: true },
  ],
};

const DS: EvalDataset = {
  id: "ds_1", name: "한국어 QA", version: 1, created_at: "2026-06-25T09:00:00Z", updated_at: "2026-06-25T09:00:00Z",
  items: [
    { id: "c1", input: "질문1", expected_output: "정답1" },
    { id: "c2", input: "질문2" },
  ],
};

// 두 run: B(최신)는 c1 회귀(5→3), c2 개선(2→4). 매트릭스/delta 검증용.
const EXP_A: Experiment = {
  id: "ex_a", dataset_id: "ds_1", dataset_name: "한국어 QA", dataset_version: 1,
  config: { model: "gemma-3-27b-it", judge_model: "gemma-3-27b-it", prompt_version: "v1", criteria: "정확성" },
  cases: [
    { item_id: "c1", input: "질문1", response: "a", score: 5, rationale: "", blocked: false },
    { item_id: "c2", input: "질문2", response: "b", score: 2, rationale: "", blocked: false },
  ],
  mean_score: 3.5, pass_rate: 0.5, created_at: "2026-06-30T01:00:00Z",
};
const EXP_B: Experiment = {
  id: "ex_b", dataset_id: "ds_1", dataset_name: "한국어 QA", dataset_version: 1,
  config: { model: "gemma-3-27b-it", judge_model: "gemma-3-27b-it", prompt_version: "v2", criteria: "정확성" },
  cases: [
    { item_id: "c1", input: "질문1", response: "a2", score: 3, rationale: "", blocked: false },
    { item_id: "c2", input: "질문2", response: "b2", score: 4, rationale: "", blocked: false },
  ],
  mean_score: 3.5, pass_rate: 0.5, created_at: "2026-06-30T02:00:00Z",
};

const fetchModels = vi.fn();
const fetchDatasets = vi.fn();
const fetchExperiments = vi.fn();
const createDataset = vi.fn();
const runExperiment = vi.fn();
const runEval = vi.fn();

vi.mock("../api/client", () => ({
  fetchModels: (...a: unknown[]) => fetchModels(...a),
  fetchDatasets: (...a: unknown[]) => fetchDatasets(...a),
  fetchExperiments: (...a: unknown[]) => fetchExperiments(...a),
  createDataset: (...a: unknown[]) => createDataset(...a),
  runExperiment: (...a: unknown[]) => runExperiment(...a),
  runEval: (...a: unknown[]) => runEval(...a),
}));

describe("Eval suite — IMP-39", () => {
  beforeEach(() => {
    fetchModels.mockResolvedValue(CATALOG);
    fetchDatasets.mockResolvedValue({ datasets: [DS] });
    fetchExperiments.mockResolvedValue({ experiments: [EXP_B, EXP_A] }); // 최신순
    createDataset.mockResolvedValue(DS);
    runExperiment.mockResolvedValue(EXP_B);
  });
  afterEach(() => vi.restoreAllMocks());

  it("탭 전환 — 기본 단건, 데이터셋 탭에서 목록 렌더", async () => {
    await act(async () => { render(<Eval />); });
    // 단건 탭 기본 — 평가 실행 카드.
    expect(screen.getByRole("tab", { name: "단건" })).toHaveAttribute("aria-selected", "true");

    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "데이터셋" })); });
    await waitFor(() => expect(screen.getByText("한국어 QA")).toBeInTheDocument());
    expect(screen.getByText("2개 케이스")).toBeInTheDocument();
  });

  it("실험 탭 — run×case 매트릭스 + run-vs-run delta(개선▲/회귀▼) 표시", async () => {
    await act(async () => { render(<Eval />); });
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "실험 · 회귀 비교" })); });

    await waitFor(() => expect(screen.getByText("회귀 비교 (run × case 매트릭스)")).toBeInTheDocument());

    // 기본 비교: A=EXP_A(과거), B=EXP_B(최신). c1 회귀(5→3 → ▼ -2.00), c2 개선(2→4 → ▲ +2.00).
    await waitFor(() => {
      const reg = screen.getAllByLabelText(/회귀/);
      const imp = screen.getAllByLabelText(/개선/);
      expect(reg.length).toBeGreaterThanOrEqual(1);
      expect(imp.length).toBeGreaterThanOrEqual(1);
    });
    // 회귀 셀에 ▼ 마커, 개선 셀에 ▲ 마커.
    expect(screen.getByLabelText("회귀 -2.00").textContent).toContain("▼");
    expect(screen.getByLabelText("개선 2.00").textContent).toContain("▲");
  });

  it("데이터셋 생성 — input 입력 후 저장 시 createDataset 호출", async () => {
    await act(async () => { render(<Eval />); });
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "데이터셋" })); });

    const inputs = await screen.findAllByPlaceholderText("질문/프롬프트");
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("예: 한국어 사실 QA"), { target: { value: "새셋" } });
      fireEvent.change(inputs[0], { target: { value: "케이스 입력" } });
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "데이터셋 저장" })); });

    await waitFor(() => expect(createDataset).toHaveBeenCalledTimes(1));
    const arg = createDataset.mock.calls[0][0] as { name: string; items: { input: string }[] };
    expect(arg.name).toBe("새셋");
    expect(arg.items[0].input).toBe("케이스 입력");
  });
});
