import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AlertRulesCard } from "./Settings";
import { ToastProvider } from "../toast";

// IMP-36 — 지표 기반 알림 룰 패널 라이트 테스트.
// 마운트 시 fetchAlertRules + preview, 생성폼·live preview, observe 읽기전용(편집 버튼 숨김)을 확인.
const mockRules = vi.fn();
const mockPreview = vi.fn();
const mockCreate = vi.fn();
const mockDelete = vi.fn();
vi.mock("../api/client", () => ({
  fetchAlertRules: (...a: unknown[]) => mockRules(...a),
  fetchAlertRulePreview: (...a: unknown[]) => mockPreview(...a),
  createAlertRule: (...a: unknown[]) => mockCreate(...a),
  deleteAlertRule: (...a: unknown[]) => mockDelete(...a),
}));

const METRICS = [
  { key: "error_rate", title: "에러율", unit: "ratio", lower_better: true },
  { key: "ttft_p95", title: "TTFT p95", unit: "ms", lower_better: true },
];
const RULES = [
  { id: "rule_1", name: "에러율 임계", metric: "error_rate", op: "gt", alert_threshold: 0.05, window: "5m", severity: "critical", enabled: true, state: "OK" },
];

function renderCard(canEdit: boolean) {
  return render(
    <ToastProvider>
      <AlertRulesCard canEdit={canEdit} />
    </ToastProvider>,
  );
}

describe("AlertRulesCard (IMP-36)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRules.mockResolvedValue({ rules: RULES, metrics: METRICS, enabled: true });
    mockPreview.mockResolvedValue({ metric: "error_rate", window: "5m", value: 0.012, has_data: true });
    mockCreate.mockResolvedValue({ id: "rule_2" });
  });

  it("룰 목록을 렌더링한다", async () => {
    renderCard(true);
    await waitFor(() => expect(mockRules).toHaveBeenCalled());
    expect(screen.getByText("에러율 임계")).toBeInTheDocument();
  });

  it("manage 에서 생성 폼과 live preview 를 보여준다", async () => {
    renderCard(true);
    await waitFor(() => expect(mockRules).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "+ 룰 추가" }));
    // preview 가 현재 값을 표시한다(신뢰 UX).
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("rule-preview")).toHaveTextContent(/0.012/));
  });

  it("생성 폼 제출 시 createAlertRule 을 호출한다", async () => {
    renderCard(true);
    await waitFor(() => expect(mockRules).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "+ 룰 추가" }));
    fireEvent.change(screen.getByPlaceholderText(/에러율 급증/), { target: { value: "새 룰" } });
    fireEvent.click(screen.getByRole("button", { name: "룰 추가" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ name: "새 룰", metric: "error_rate" });
  });

  it("observe(읽기전용)에서는 편집 버튼을 숨긴다", async () => {
    renderCard(false);
    await waitFor(() => expect(mockRules).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "+ 룰 추가" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
  });
});
