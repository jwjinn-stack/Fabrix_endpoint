import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ViewBar from "./ViewBar";
import { ToastProvider } from "../toast";

function renderBar(canSave: boolean, onApply = vi.fn()) {
  return render(
    <ToastProvider>
      <ViewBar page="traces" canSave={canSave} onApply={onApply} />
    </ToastProvider>,
  );
}

describe("ViewBar — 링크 복사 + 저장된 뷰 (IMP-24)", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/traces?decision=blocked&range=1h");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copy-link: 버튼 클릭 → clipboard.writeText(location.href) + 토스트", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderBar(false); // observe(읽기전용)여도 복사 버튼은 보인다
    const btn = screen.getByText(/뷰 링크 복사/);
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    await waitFor(() => expect(screen.getByText(/링크 복사됨/)).toBeInTheDocument());
  });

  it("canSave=false 면 저장 입력이 숨겨진다(복사만 허용)", () => {
    renderBar(false);
    fireEvent.click(screen.getByText(/★ 저장된 뷰/));
    expect(screen.queryByLabelText("저장할 뷰 이름")).not.toBeInTheDocument();
    expect(screen.getByText(/manage 프로파일에서만/)).toBeInTheDocument();
  });

  it("canSave=true: 뷰 저장 → 목록에 나타나고 클릭 시 onApply(query)", () => {
    const onApply = vi.fn();
    renderBar(true, onApply);
    fireEvent.click(screen.getByText(/★ 저장된 뷰/));
    const input = screen.getByLabelText("저장할 뷰 이름");
    fireEvent.change(input, { target: { value: "차단 뷰" } });
    fireEvent.click(screen.getByText("저장"));

    const applyBtn = screen.getByText("차단 뷰");
    expect(applyBtn).toBeInTheDocument();
    fireEvent.click(applyBtn);
    expect(onApply).toHaveBeenCalledWith("decision=blocked&range=1h");
  });
});
