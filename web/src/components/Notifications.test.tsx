import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import NotificationsDrawer from "./Notifications";

// api/client 모킹 — 알림 드로어가 마운트 시 호출하는 두 fetch 를 stub.
vi.mock("../api/client", () => ({
  fetchOverview: vi.fn().mockResolvedValue({ alarms: [] }),
  fetchGuardAudit: vi.fn().mockResolvedValue({ rows: [] }),
}));

describe("NotificationsDrawer (비-모달 <dialog>, IMP-31)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("닫힘 상태에서는 렌더링하지 않는다", () => {
    render(<NotificationsDrawer open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("open 시 비-모달 show() 로 열린다(showModal 아님)", async () => {
    const show = vi.spyOn(HTMLDialogElement.prototype, "show");
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<NotificationsDrawer open onClose={() => {}} />);
    await waitFor(() => expect(show).toHaveBeenCalled());
    expect(showModal).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByLabelText("알림")).toBeInTheDocument();
    show.mockRestore();
    showModal.mockRestore();
  });

  it("Escape 키로 onClose 가 호출된다(비-모달 수동 보강)", async () => {
    const onClose = vi.fn();
    render(<NotificationsDrawer open onClose={onClose} />);
    await screen.findByText("새 알림이 없습니다."); // 초기 비동기 load 플러시
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("닫기 버튼으로 onClose 가 호출된다", async () => {
    const onClose = vi.fn();
    render(<NotificationsDrawer open onClose={onClose} />);
    await screen.findByText("새 알림이 없습니다.");
    fireEvent.click(screen.getByLabelText("닫기"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
