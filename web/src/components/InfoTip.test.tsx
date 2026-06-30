import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InfoTip from "./InfoTip";

describe("InfoTip (접근 가능한 toggletip)", () => {
  it("renders a focusable button, collapsed by default", () => {
    render(<InfoTip>도움말 내용</InfoTip>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("도움말 내용")).not.toBeInTheDocument();
  });

  it("toggles the bubble open on click and shows content", async () => {
    const user = userEvent.setup();
    render(<InfoTip>도움말 내용</InfoTip>);
    const btn = screen.getByRole("button");
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("도움말 내용")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<InfoTip>도움말 내용</InfoTip>);
    const btn = screen.getByRole("button");
    await user.click(btn);
    expect(screen.getByText("도움말 내용")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("도움말 내용")).not.toBeInTheDocument();
  });
});
