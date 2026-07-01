import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { usePolling } from "./usePolling";

// 훅을 얇은 하네스 컴포넌트로 노출해 상태 전이를 DOM 으로 확인한다.
function Harness({ fetcher }: { fetcher: (s: AbortSignal) => Promise<string> }) {
  const { data, error, loading, paused, isStale, reload, setPaused } = usePolling<string>(
    fetcher,
    { intervalMs: 1000 },
  );
  return (
    <div>
      <span data-testid="data">{data ?? "none"}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <span data-testid="loading">{loading ? "y" : "n"}</span>
      <span data-testid="paused">{paused ? "y" : "n"}</span>
      <span data-testid="stale">{isStale ? "y" : "n"}</span>
      <button onClick={() => reload()}>reload</button>
      <button onClick={() => setPaused(!paused)}>toggle</button>
    </div>
  );
}

describe("usePolling (IMP-51)", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("최초 로드 → data 세팅 + loading 종료", async () => {
    const fetcher = vi.fn().mockResolvedValue("v1");
    render(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("v1"));
    expect(screen.getByTestId("loading").textContent).toBe("n");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("interval tick 마다 재조회한다", async () => {
    const fetcher = vi.fn().mockResolvedValue("v");
    render(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(async () => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it("정지 → interval tick 이 추가 호출하지 않음 / 재개 → 즉시 1회 로드", async () => {
    const fetcher = vi.fn().mockResolvedValue("v");
    render(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("toggle")); // pause
    await waitFor(() => expect(screen.getByTestId("paused").textContent).toBe("y"));
    const callsAtPause = fetcher.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(fetcher).toHaveBeenCalledTimes(callsAtPause); // 정지 중 tick 무시

    fireEvent.click(screen.getByText("toggle")); // resume
    await waitFor(() => expect(fetcher.mock.calls.length).toBe(callsAtPause + 1)); // 재개 즉시 1회
  });

  it("성공 후 에러 → 마지막 데이터 유지 + isStale=true", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("v1")
      .mockRejectedValue(new Error("Failed to fetch"));
    render(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("v1"));

    await act(async () => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(screen.getByTestId("error").textContent).toMatch(/서버에 연결할 수 없습니다/));
    // 에러가 나도 마지막 성공 데이터는 유지되고 stale 로 표시된다.
    expect(screen.getByTestId("data").textContent).toBe("v1");
    expect(screen.getByTestId("stale").textContent).toBe("y");
  });
});
