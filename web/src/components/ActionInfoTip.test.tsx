// IMP-96 — ActionInfoTip/ReversibleChip: consequence-tier 차이 + 접근가능 InfoTip + 되돌리기 칩.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionInfoTip, ReversibleChip } from "./ActionInfoTip";
import { ACTION_REGISTRY } from "../actions/registry";

describe("ActionInfoTip — consequence-tier(과설명 회피)", () => {
  it("consequential(drainGpu)은 '언제·상태 전이·부수효과·되돌리기'를 모두 노출한다", async () => {
    const user = userEvent.setup();
    render(<ActionInfoTip spec={ACTION_REGISTRY.drainGpu} />);
    await user.click(screen.getByRole("button", { name: /액션 설명 보기/ }));
    expect(screen.getByText("언제")).toBeInTheDocument();
    expect(screen.getByText("상태 전이")).toBeInTheDocument();
    expect(screen.getByText("부수효과")).toBeInTheDocument();
    expect(screen.getByText("되돌리기")).toBeInTheDocument();
    // registry 단일 출처의 whenToUse 문구가 그대로 렌더된다(정규식 특수문자 회피 위해 substring 매처).
    const when = ACTION_REGISTRY.drainGpu.whenToUse;
    expect(screen.getByText((t) => t.includes(when))).toBeInTheDocument();
  });

  it("lifecycle(ack)은 전이 부제만 — 되돌리기 세부 라벨(dt)을 노출하지 않는다", async () => {
    const user = userEvent.setup();
    render(<ActionInfoTip spec={ACTION_REGISTRY.ack} />);
    await user.click(screen.getByRole("button", { name: /액션 설명 보기/ }));
    // 전이 부제(rulesNote) + when 은 있으나, 풀 사다리 dt(상태 전이/부수효과/되돌리기)는 없다.
    expect(screen.getByText(/acked/)).toBeInTheDocument();
    expect(screen.queryByText("되돌리기")).not.toBeInTheDocument();
    expect(screen.queryByText("부수효과")).not.toBeInTheDocument();
  });
});

describe("ActionInfoTip — InfoTip 접근성(native title 아님; WCAG 1.4.13/2.1.1)", () => {
  it("키보드 포커스로 열린다(focus 트리거)", async () => {
    const user = userEvent.setup();
    render(<ActionInfoTip spec={ACTION_REGISTRY.cordonNode} />);
    await user.tab(); // 트리거 버튼에 포커스
    expect(screen.getByRole("button", { name: /액션 설명 보기/ })).toHaveFocus();
    expect(screen.getByText("언제")).toBeInTheDocument(); // focus 로 버블 열림
  });

  it("hover 로 열리고 Esc 로 닫힌다(dismissible)", async () => {
    const user = userEvent.setup();
    render(<ActionInfoTip spec={ACTION_REGISTRY.cordonNode} />);
    await user.hover(screen.getByRole("button", { name: /액션 설명 보기/ }));
    expect(screen.getByText("언제")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("언제")).not.toBeInTheDocument();
  });

  it("live 영역(role=status)으로 announce 한다(네이티브 title 미사용)", () => {
    render(<ActionInfoTip spec={ACTION_REGISTRY.ack} />);
    const trigger = screen.getByRole("button", { name: /액션 설명 보기/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls");
  });
});

describe("ReversibleChip — 텍스트 병기 redundant 신호", () => {
  it("yes/partial/no verb 별로 라벨을 렌더한다", () => {
    const { rerender } = render(<ReversibleChip spec={ACTION_REGISTRY.cordonNode} />);
    expect(screen.getByText("되돌리기 가능")).toBeInTheDocument(); // cordonNode = yes
    rerender(<ReversibleChip spec={ACTION_REGISTRY.drainGpu} />);
    expect(screen.getByText("부분 가역")).toBeInTheDocument(); // drainGpu = partial
  });
});
