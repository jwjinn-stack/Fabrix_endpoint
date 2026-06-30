import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { ToastProvider, useToast, type ToastApi } from "./toast";

// 테스트 하네스 — useToast 로 받은 API 를 ref 로 노출해 외부에서 토스트를 띄운다.
function Harness({ apiRef }: { apiRef: { current: ToastApi | null } }) {
  const api = useToast();
  apiRef.current = api;
  return null;
}

function setup() {
  const apiRef: { current: ToastApi | null } = { current: null };
  render(
    <ToastProvider>
      <Harness apiRef={apiRef} />
    </ToastProvider>,
  );
  return apiRef;
}

// polite/assertive region 조회 헬퍼.
const politeRegion = () => screen.getByRole("status");
const alertRegion = () => screen.getByRole("alert");

describe("ToastProvider / useToast (IMP-29)", () => {
  it("성공 토스트는 polite(role=status) region 에 렌더된다", () => {
    const api = setup();
    act(() => { api.current!.success("저장되었습니다"); });
    expect(within(politeRegion()).getByText("저장되었습니다")).toBeInTheDocument();
    // assertive region 에는 없어야 한다.
    expect(within(alertRegion()).queryByText("저장되었습니다")).not.toBeInTheDocument();
  });

  it("오류 토스트는 assertive(role=alert) region 에 렌더 + humanizeError 로 정규화된다", () => {
    const api = setup();
    // raw 백엔드 문자열을 promise.error 경로(기본 매퍼=humanizeError)로 흘려보낸다.
    act(() => {
      void api.current!.promise(Promise.reject(new Error("API 503 server error")), {
        pending: "처리 중…",
        success: "완료",
      }).catch(() => {});
    });
    return waitFor(() => {
      const region = alertRegion();
      expect(within(region).getByText("서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.")).toBeInTheDocument();
      // raw 내부 문자열("503", "server error")이 그대로 노출되면 안 된다.
      expect(within(region).queryByText(/503|server error/)).not.toBeInTheDocument();
    });
  });

  it("수동 닫기 버튼으로 토스트가 제거된다", () => {
    const api = setup();
    act(() => { api.current!.success("안녕"); });
    expect(screen.getByText("안녕")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("알림 닫기"));
    expect(screen.queryByText("안녕")).not.toBeInTheDocument();
  });

  describe("자동 dismiss 타이머(fake timers)", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("success 는 시간이 지나면 자동 소거된다", () => {
      const api = setup();
      act(() => { api.current!.success("끝", { duration: 1000 }); });
      expect(screen.getByText("끝")).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(1100); });
      expect(screen.queryByText("끝")).not.toBeInTheDocument();
    });

    it("호버하면 자동 dismiss 타이머가 일시정지되고, 벗어나면 재개된다", () => {
      const api = setup();
      act(() => { api.current!.success("머무름", { duration: 1000 }); });
      const card = screen.getByText("머무름").closest(".toast")!;
      // 절반 경과 후 호버 → 일시정지.
      act(() => { vi.advanceTimersByTime(600); });
      fireEvent.mouseEnter(card);
      act(() => { vi.advanceTimersByTime(5000); }); // 호버 중엔 만료 안 됨
      expect(screen.getByText("머무름")).toBeInTheDocument();
      // 벗어나면 남은 시간(타이머 재시작)으로 다시 카운트.
      fireEvent.mouseLeave(card);
      act(() => { vi.advanceTimersByTime(1100); });
      expect(screen.queryByText("머무름")).not.toBeInTheDocument();
    });

    it("error 토스트는 자동 소거되지 않는다(중요건 — 수동 닫기 전까지 유지)", () => {
      const api = setup();
      act(() => { api.current!.error("문제 발생"); });
      act(() => { vi.advanceTimersByTime(30000); });
      expect(screen.getByText("문제 발생")).toBeInTheDocument();
    });
  });

  it("promise 토스트: pending → resolve 시 동일 노드가 success 로 전이된다", async () => {
    const api = setup();
    let resolve!: (v: string) => void;
    const p = new Promise<string>((r) => { resolve = r; });
    act(() => { void api.current!.promise(p, { pending: "적용 중…", success: (v) => `적용됨: ${v}` }); });
    expect(screen.getByText("적용 중…")).toBeInTheDocument();
    await act(async () => { resolve("v2"); await p; });
    expect(screen.queryByText("적용 중…")).not.toBeInTheDocument();
    expect(screen.getByText("적용됨: v2")).toBeInTheDocument();
  });

  it("스택 상한(MAX=4) 초과 시 가장 오래된 토스트가 제거된다", () => {
    const api = setup();
    act(() => {
      for (let i = 1; i <= 6; i++) api.current!.info(`알림${i}`);
    });
    // 최신 4개만 유지: 알림3~6.
    expect(screen.queryByText("알림1")).not.toBeInTheDocument();
    expect(screen.queryByText("알림2")).not.toBeInTheDocument();
    expect(screen.getByText("알림3")).toBeInTheDocument();
    expect(screen.getByText("알림6")).toBeInTheDocument();
  });
});
