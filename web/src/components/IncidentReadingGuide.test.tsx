// IMP-97 — 인시던트 '읽는 법' 온보딩 + 상태 용어 InfoTip 테스트.
//  - 읽는 법 패널: default-collapsed / '?' 토글 / 1회 dismiss localStorage 기억(복귀 사용자 auto-expand 안 함)
//  - StatusInfoTip: 단일 glossary(statusGlossary) 소비 / 키보드 focus·Esc 접근성(hover-only 아님)
//  - 정보폭탄 금지: 읽는 법 패널은 EvidenceTimeline(first-anomaly 타임라인)을 렌더하지 않는다 / 자동 coach mark 없음
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IncidentReadingGuide from "./IncidentReadingGuide";
import StatusInfoTip from "./StatusInfoTip";
import { STATUS_GLOSSARY } from "../api/statusGlossary";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => cleanup());

describe("IncidentReadingGuide — default-collapsed 온보딩 + persistent '?'", () => {
  it("default-collapsed — 초기엔 3-step 본문이 안 보이고 '?' 트리거만 보인다", () => {
    render(<IncidentReadingGuide />);
    // persistent '?' 트리거는 항상 보임.
    const trigger = screen.getByRole("button", { name: /이 화면 읽는 법/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // 3-step 본문(신호/추정 원인/영향/조치)은 접혀 있어 안 보인다.
    expect(screen.queryByText(/신호\(무엇이 울렸나\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/조치\(무엇을 하나\)/)).not.toBeInTheDocument();
  });

  it("'?' 클릭 → 펼침(3-step 본문 표시), 다시 클릭 → 접힘", async () => {
    const user = userEvent.setup();
    render(<IncidentReadingGuide />);
    const trigger = screen.getByRole("button", { name: /이 화면 읽는 법/ });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/신호\(무엇이 울렸나\)/)).toBeInTheDocument();
    expect(screen.getByText(/조치\(무엇을 하나\)/)).toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/신호\(무엇이 울렸나\)/)).not.toBeInTheDocument();
  });

  it("dismiss → localStorage 플래그 기록 + 재마운트(복귀 사용자)해도 auto-expand 안 함", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<IncidentReadingGuide />);
    // 처음 사용자 — '처음이면 열어보기' 힌트가 있다.
    expect(screen.getByText(/처음이면 열어보기/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /이 화면 읽는 법/ }));
    await user.click(screen.getByRole("button", { name: /다시 자동 안내 안 함/ }));
    // 플래그 기록됨.
    expect(localStorage.getItem("fabrix.incidentGuide.dismissed")).toBe("1");
    unmount();

    // 복귀 사용자 — 재마운트. 여전히 collapsed(auto-expand 안 함) + '처음이면' 힌트 사라짐.
    render(<IncidentReadingGuide />);
    const trigger = screen.getByRole("button", { name: /이 화면 읽는 법/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/처음이면 열어보기/)).not.toBeInTheDocument();
    // '?' 트리거는 남아 재확인 가능.
    expect(trigger).toBeInTheDocument();
  });

  it("정보폭탄 금지 — 읽는 법 패널은 first-anomaly 타임라인(EvidenceTimeline)을 렌더하지 않는다", async () => {
    const user = userEvent.setup();
    const { container } = render(<IncidentReadingGuide />);
    await user.click(screen.getByRole("button", { name: /이 화면 읽는 법/ }));
    // 펼쳐도 근거 타임라인(.ev-tl)은 여기에 없음 — drill-down 층(EvidencePanel)에만.
    expect(container.querySelector(".ev-tl")).toBeNull();
    expect(screen.queryByLabelText("근거 타임라인")).not.toBeInTheDocument();
  });

  it("자동 coach mark 없음 — 마운트 시 자동 발화하는 dialog/overlay 가 없다", () => {
    render(<IncidentReadingGuide />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // aria-expanded=false 로 시작(자동 펼침 아님).
    expect(screen.getByRole("button", { name: /이 화면 읽는 법/ })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("StatusInfoTip — 단일 glossary 소비 + 접근성", () => {
  it("triggered/notready/backpressure 정의를 glossary 에서 꺼내 렌더한다", async () => {
    const user = userEvent.setup();
    // 한 번에 하나씩(pinned 는 바깥 클릭 시 닫히므로 개별 렌더로 검증).
    const cases: Array<[string, RegExp]> = [
      ["triggered", /발생·미확인/],
      ["notready", /파드 미기동\(NotReady\)/],
      ["backpressure", /유입>처리율/],
    ];
    for (const [key, re] of cases) {
      const { unmount } = render(<StatusInfoTip termKey={key} />);
      await user.click(screen.getByRole("button"));
      expect(screen.getByText(re)).toBeInTheDocument();
      unmount();
    }
  });

  it("미지 termKey 는 렌더하지 않는다(방어)", () => {
    const { container } = render(<StatusInfoTip termKey="nonexistent" />);
    expect(container.querySelector(".status-infotip")).toBeNull();
  });

  it("키보드 focus 로 열리고 Esc 로 닫힌다(hover-only 아님, WCAG 2.1.1/1.4.13)", async () => {
    const user = userEvent.setup();
    render(<StatusInfoTip termKey="crit" />);
    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    expect(screen.getByText(/위험\(crit\)/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/위험\(crit\)/)).not.toBeInTheDocument();
  });

  it("glossary 단일 출처 — 같은 termKey 는 어디서 렌더해도 동일 문구", async () => {
    // 코드 레벨 단일 출처 보증: 컴포넌트가 STATUS_GLOSSARY 를 읽는다.
    const user = userEvent.setup();
    render(<StatusInfoTip termKey="acked" />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(new RegExp(STATUS_GLOSSARY.acked.short.slice(0, 8)))).toBeInTheDocument();
  });
});
