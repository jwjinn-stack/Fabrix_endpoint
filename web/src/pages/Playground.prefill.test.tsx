import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Playground from "./Playground";
import type { ModelCatalog } from "../api/types";
import { setPrefill, takePrefill } from "./playgroundPrefill";

// IMP-37: replay 핸드오프(setPrefill) 가 Playground 마운트 시 input/model/params 로 시드되는지 검증.

const CATALOG: ModelCatalog = {
  generated_at: "2026-06-30T00:00:00Z",
  models: [
    { id: "qwen3-32b", display_name: "Qwen3 32B", provider: "x", type: "chat", context_window: 32768, serving: "vllm", namespace: "ns", status: "ready", playground: true },
    { id: "other", display_name: "Other", provider: "x", type: "chat", context_window: 8192, serving: "vllm", namespace: "ns", status: "ready", playground: true },
  ],
};

const fetchModels = vi.fn();
vi.mock("../api/client", () => ({
  fetchModels: (...a: unknown[]) => fetchModels(...a),
  playgroundChat: vi.fn(),
}));

beforeEach(() => {
  fetchModels.mockReset();
  fetchModels.mockResolvedValue(CATALOG);
  takePrefill(); // 잔여 핸드오프 비우기
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
  }
  // jsdom 미구현 — 오토스크롤(scrollToBottom)이 마운트 effect 에서 호출됨.
  if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = vi.fn() as never;
  }
});
afterEach(() => vi.restoreAllMocks());

describe("Playground replay prefill (IMP-37)", () => {
  it("T3: prefill → input·params 시드 + 출처 배너", async () => {
    setPrefill({ prompt: "이 코드의 버그를 찾아줘", model: "qwen3-32b", temperature: 0.3, maxTokens: 512, origin: "트레이스 t_x" });
    render(<Playground initialModel="qwen3-32b" />);

    // 입력 시드.
    const ta = screen.getByPlaceholderText(/메시지를 입력하세요/) as HTMLTextAreaElement;
    expect(ta.value).toBe("이 코드의 버그를 찾아줘");

    // 파라미터 슬라이더 라벨에 시드 값 반영.
    expect(screen.getByText(/max_tokens · 512/)).toBeInTheDocument();
    expect(screen.getByText(/temperature · 0\.3/)).toBeInTheDocument();

    // 출처 배너.
    expect(screen.getByText(/트레이스 t_x/)).toBeInTheDocument();

    // 모델 선택값 복원(카탈로그 로드 후).
    await waitFor(() => {
      const sel = screen.getByDisplayValue("Qwen3 32B") as HTMLSelectElement;
      expect(sel.value).toBe("qwen3-32b");
    });
  });

  it("T5: prefill 없으면 기본값(빈 입력·기본 params·배너 없음)", () => {
    render(<Playground />);
    const ta = screen.getByPlaceholderText(/메시지를 입력하세요/) as HTMLTextAreaElement;
    expect(ta.value).toBe("");
    expect(screen.getByText(/max_tokens · 256/)).toBeInTheDocument();
    expect(screen.queryByText(/에서 재현/)).not.toBeInTheDocument();
  });

  it("takePrefill 은 1회성 — 두 번째 마운트는 재시드되지 않음", () => {
    setPrefill({ prompt: "once", origin: "트레이스 t_y" });
    const { unmount } = render(<Playground />);
    expect((screen.getByPlaceholderText(/메시지를 입력하세요/) as HTMLTextAreaElement).value).toBe("once");
    unmount();
    render(<Playground />);
    expect((screen.getByPlaceholderText(/메시지를 입력하세요/) as HTMLTextAreaElement).value).toBe("");
  });
});
