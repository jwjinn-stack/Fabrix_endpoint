import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AlertWebhookCard } from "./Settings";
import { ToastProvider } from "../toast";

// IMP-15 — 아웃바운드 알림 Webhook 카드 라이트 테스트.
// 마운트 시 fetchAlertConfig 호출, URL 입력+등록 시 setAlertWebhook 호출을 확인.
const mockFetch = vi.fn();
const mockSet = vi.fn();
vi.mock("../api/client", () => ({
  fetchAlertConfig: (...a: unknown[]) => mockFetch(...a),
  setAlertWebhook: (...a: unknown[]) => mockSet(...a),
}));

function renderCard() {
  return render(
    <ToastProvider>
      <AlertWebhookCard />
    </ToastProvider>,
  );
}

describe("AlertWebhookCard (IMP-15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ enabled: true, webhook_configured: false, audit: [] });
    mockSet.mockResolvedValue({ webhook_configured: true, warnings: [] });
  });

  it("Webhook URL 입력 필드와 등록 버튼을 렌더링한다", async () => {
    renderCard();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.getByPlaceholderText(/relay/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "등록" })).toBeInTheDocument();
  });

  it("URL 입력 후 등록하면 setAlertWebhook 을 호출한다", async () => {
    renderCard();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const input = screen.getByPlaceholderText(/relay/i);
    fireEvent.change(input, { target: { value: "https://relay.internal.example.com/hook" } });
    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith("https://relay.internal.example.com/hook"));
  });
});
