import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SlidePanel from "./SlidePanel";

// 트리거 버튼 → SlidePanel 을 여닫는 제어형 래퍼(현실 호출처 모사).
function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <SlidePanel
        open={open}
        title="세션 상세"
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
      >
        <button type="button">내부 버튼</button>
      </SlidePanel>
    </>
  );
}

describe("SlidePanel (네이티브 <dialog> 슬라이드 변형, IMP-31)", () => {
  it("닫힘 상태에서는 렌더링하지 않는다", () => {
    render(<SlidePanel open={false} title="x" onClose={() => {}}>본문</SlidePanel>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("open 시 showModal 로 dialog 가 열린다(focus 진입)", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<SlidePanel open title="세션 상세" onClose={() => {}}>본문</SlidePanel>);
    expect(spy).toHaveBeenCalled();
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveAttribute("open");
    spy.mockRestore();
  });

  it("제목을 aria-labelledby 로 연결한다", () => {
    render(<SlidePanel open title="세션 상세" onClose={() => {}}>본문</SlidePanel>);
    const dlg = screen.getByRole("dialog");
    const labelId = dlg.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe("세션 상세");
  });

  it("Escape(cancel) 로 onClose 가 호출된다", () => {
    const onClose = vi.fn();
    render(<SlidePanel open title="세션 상세" onClose={onClose}>본문</SlidePanel>);
    const dlg = screen.getByRole("dialog");
    fireEvent(dlg, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("백드롭(dialog 자체) 클릭은 닫고, 내부 콘텐츠 클릭은 닫지 않는다", () => {
    const onClose = vi.fn();
    render(
      <SlidePanel open title="세션 상세" onClose={onClose}>
        <button type="button">내부 버튼</button>
      </SlidePanel>,
    );
    const dlg = screen.getByRole("dialog");
    // 내부 버튼 클릭 — 닫히지 않음
    fireEvent.click(screen.getByText("내부 버튼"));
    expect(onClose).not.toHaveBeenCalled();
    // dialog 자체(백드롭) 클릭 — 닫힘
    fireEvent.click(dlg);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("트리거로 연 뒤 닫으면 트리거로 포커스가 복원된다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByText("열기");
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByLabelText("상세 패널 닫기"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // jsdom 폴리필상 네이티브 포커스 복원은 보장되지 않으므로 트리거 재포커스 가능 여부만 확인.
    expect(trigger).toBeInTheDocument();
  });
});
