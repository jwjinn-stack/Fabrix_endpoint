import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import NotificationsDrawer from "./Notifications";
import { ToastProvider } from "../toast";
import type { Incident } from "../api/types";

// api/client 모킹 — 인시던트 인박스가 호출하는 fetch/액션 stub(IMP-38).
const mockFetch = vi.fn();
const mockAck = vi.fn();
const mockResolve = vi.fn();
const mockSnooze = vi.fn();
vi.mock("../api/client", () => ({
  fetchIncidents: (...a: unknown[]) => mockFetch(...a),
  ackIncident: (...a: unknown[]) => mockAck(...a),
  resolveIncident: (...a: unknown[]) => mockResolve(...a),
  snoozeIncident: (...a: unknown[]) => mockSnooze(...a),
}));

// capabilities — write cap 보유(manage) 로 가정(resolve/snooze 버튼 노출).
let canWrite = true;
vi.mock("../capabilities", () => ({
  useCap: () => ({ can: (c: string) => (c === "incident.write" ? canWrite : true), caps: {} }),
}));

const INC: Incident[] = [
  { id: "inc_a", dedup_key: "dk-a", severity: "critical", title: "엔드포인트 NotReady", state: "triggered", first_seen: "2026-06-30T08:00:00Z", last_seen: "2026-06-30T09:00:00Z", count: 3 },
  { id: "inc_b", dedup_key: "dk-b", severity: "info", title: "차단 급증", state: "resolved", first_seen: "2026-06-30T07:00:00Z", last_seen: "2026-06-30T08:30:00Z", count: 1, resolved_by: "op" },
];
const COUNTS = { triggered: 1, acked: 0, resolved: 1, snoozed: 0 };

function renderDrawer(props: { open?: boolean; onClose?: () => void } = {}) {
  return render(
    <ToastProvider>
      <NotificationsDrawer open={props.open ?? true} onClose={props.onClose ?? (() => {})} />
    </ToastProvider>,
  );
}

describe("NotificationsDrawer 인시던트 인박스 (IMP-38)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canWrite = true;
    mockFetch.mockResolvedValue({ incidents: INC, counts: COUNTS });
    mockAck.mockResolvedValue({ ...INC[0], state: "acked" });
    mockResolve.mockResolvedValue({ ...INC[0], state: "resolved" });
    mockSnooze.mockResolvedValue({ ...INC[0], state: "snoozed" });
  });

  it("닫힘 상태에서는 렌더링하지 않는다", () => {
    renderDrawer({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("open 시 비-모달 show() 로 열리고 인박스를 그린다(IMP-31 비회귀)", async () => {
    const show = vi.spyOn(HTMLDialogElement.prototype, "show");
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    renderDrawer();
    await waitFor(() => expect(show).toHaveBeenCalled());
    expect(showModal).not.toHaveBeenCalled();
    expect(screen.getByLabelText("인시던트 인박스")).toBeInTheDocument();
    show.mockRestore();
    showModal.mockRestore();
  });

  it("미처리 탭(기본)에 triggered 인시던트와 발생횟수를 표시한다", async () => {
    renderDrawer();
    await screen.findByText("엔드포인트 NotReady");
    expect(screen.getByText("×3")).toBeInTheDocument(); // 발생 횟수
    expect(screen.queryByText("차단 급증")).not.toBeInTheDocument(); // resolved 는 미처리 탭에 없음
  });

  it("해소 탭으로 전환하면 resolved 인시던트만 보인다", async () => {
    renderDrawer();
    await screen.findByText("엔드포인트 NotReady");
    fireEvent.click(screen.getByRole("tab", { name: /해소/ }));
    await screen.findByText("차단 급증");
    expect(screen.queryByText("엔드포인트 NotReady")).not.toBeInTheDocument();
  });

  it("처리중 버튼 클릭 → ackIncident 호출 후 재조회", async () => {
    renderDrawer();
    await screen.findByText("엔드포인트 NotReady");
    fireEvent.click(screen.getByRole("button", { name: "처리중" }));
    await waitFor(() => expect(mockAck).toHaveBeenCalledWith("inc_a"));
    // 액션 후 목록 재조회(최초 1 + 액션 후 1).
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it("write cap 없으면(observe) 해소 버튼을 숨긴다(ack 만 노출)", async () => {
    canWrite = false;
    renderDrawer();
    await screen.findByText("엔드포인트 NotReady");
    expect(screen.getByRole("button", { name: "처리중" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "해소" })).not.toBeInTheDocument();
  });

  it("Escape 키로 onClose 가 호출된다(비-모달 수동 보강)", async () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    await screen.findByText("엔드포인트 NotReady");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
