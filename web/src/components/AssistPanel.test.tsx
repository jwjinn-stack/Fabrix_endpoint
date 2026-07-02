import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

// IMP-103 — 전역 in-context Assist 패널 + Layout 배선 테스트.
//   ⌘/·헤더 트리거·자동 화면-컨텍스트·'이 화면 설명'·dialog a11y·StreamingLog·정직 mock·격리.

// capabilities: manage(전부 허용). 포털 의존 자식은 스텁(nav.test 패턴 재사용).
let mockCan = (_cap: string) => true;
const mockCaps = { profile: "manage", readonly: false, capabilities: {} as Record<string, boolean>, data_source: "", integrations: {} };
vi.mock("../capabilities", () => ({ useCap: () => ({ caps: mockCaps, can: mockCan }) }));
vi.mock("./Notifications", () => ({ default: () => null }));
vi.mock("./CommandPalette", () => ({ default: () => null }));

import Layout, { type Page } from "./Layout";

function renderLayout(page: Page = "dashboard") {
  const onNavigate = vi.fn();
  render(
    <Layout page={page} onNavigate={onNavigate}>
      <div>content</div>
    </Layout>,
  );
  return { onNavigate };
}

// ⌘/ chord 를 window 에 디스패치(useGlobalShortcutGuard 는 window keydown 을 듣는다).
function pressCmdSlash() {
  fireEvent.keyDown(window, { key: "/", metaKey: true });
}

async function openPanel() {
  const trigger = screen.getByRole("button", { name: /무엇이든 물어보기/ });
  fireEvent.click(trigger);
  return waitFor(() => screen.getByRole("dialog"));
}

describe("IMP-103 — 전역 Assist 진입점", () => {
  beforeEach(() => {
    mockCan = () => true;
    // matchMedia 미폴리필 jsdom — AssistPanel 은 미지원 시 즉시 commit(결정성).
  });

  it("헤더 스파클 트리거가 단축키를 노출하며 렌더된다(발견성)", () => {
    renderLayout();
    const trigger = screen.getByRole("button", { name: /무엇이든 물어보기 \(⌘\/\)/ });
    expect(trigger).toBeInTheDocument();
  });

  it("헤더 트리거 클릭 → dialog 패널이 열린다", async () => {
    renderLayout();
    const dialog = await openPanel();
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("무엇이든 물어보기")).toBeInTheDocument();
  });

  it("⌘/ 로 패널이 열린다(입력 밖)", async () => {
    renderLayout();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    pressCmdSlash();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("⌘/ 는 input 포커스·IME 조합 중에는 무시된다(오발화 방지)", async () => {
    renderLayout();
    // input 에 포커스를 준 뒤 그 input 을 target 으로 keydown → 가드가 삼킨다.
    const search = screen.getByRole("button", { name: "명령 팔레트 열기" });
    void search;
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "/", metaKey: true });
    // IME 조합 중.
    fireEvent.keyDown(window, { key: "/", metaKey: true, isComposing: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    input.remove();
  });

  it("dialog a11y(IMP-102) — role=dialog·aria-labelledby·초기 포커스 입력창·Esc 닫기", async () => {
    renderLayout();
    const dialog = await openPanel();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "assist-title");
    // 초기 포커스: 질문 입력창(useDialogA11y initialFocusRef, setTimeout 0).
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("질문 입력")));
    // Esc → 닫힘.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("닫을 때 포커스를 트리거로 복원(IMP-102 restore)", async () => {
    renderLayout();
    const trigger = screen.getByRole("button", { name: /무엇이든 물어보기/ });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("자동 화면-컨텍스트 주입 — 현재 route 화면명 + 마운트 위젯을 배너로 표기", async () => {
    renderLayout("dashboard");
    const dialog = await openPanel();
    const ctx = within(dialog).getByLabelText("현재 화면 컨텍스트");
    expect(within(ctx).getByText("관제")).toBeInTheDocument();
    // dashboard 마운트 위젯(IMP-105) 인용.
    expect(within(ctx).getByText(/실시간 트래픽/)).toBeInTheDocument();
  });

  it("'이 화면 설명' 프리셋 → 화면 기반 설명이 StreamingLog(role=log)에 렌더", async () => {
    renderLayout("dashboard");
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole("button", { name: "이 화면 설명" }));
    const log = within(dialog).getByRole("log");
    await waitFor(() => expect(within(log).getByText(/관제.*화면에는 다음 위젯/)).toBeInTheDocument());
  });

  it("용어 질문(‘TTFT란?’) → 큐레이션 정의가 log 에 렌더(mock rule-based)", async () => {
    renderLayout();
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole("button", { name: "TTFT란?" }));
    const log = within(dialog).getByRole("log");
    await waitFor(() => expect(within(log).getByText(/첫 토큰까지/)).toBeInTheDocument());
  });

  it("자유 입력 제출 → 답변이 log 에 렌더되고 입력이 비워진다", async () => {
    renderLayout();
    const dialog = await openPanel();
    const input = within(dialog).getByLabelText("질문 입력") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "p95" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "묻기" }));
    const log = within(dialog).getByRole("log");
    await waitFor(() => expect(within(log).getByText(/95백분위|95번째로 느린/)).toBeInTheDocument());
    expect(input.value).toBe("");
  });

  it("정직 mock — ModelStatusChip 이 'mock 모델'로 표기(green/연결됨 위장 금지)", async () => {
    renderLayout();
    const dialog = await openPanel();
    expect(within(dialog).getByText("mock 모델")).toBeInTheDocument();
  });

  it("읽기 전용 안내 문구 노출(mutation 경로 없음)", async () => {
    renderLayout();
    const dialog = await openPanel();
    expect(within(dialog).getByText(/읽기 전용/)).toBeInTheDocument();
  });
});

// ── 격리(IMP-88) — Assist 미오픈 시 앱 정상, 패널은 조건부 마운트 ──────────────
describe("IMP-103 — 기능 격리(IMP-88 green)", () => {
  beforeEach(() => { mockCan = () => true; });

  it("패널 미오픈 시 dialog 는 마운트되지 않는다(lazy·조건부 — 초기 번들/DOM 0)", () => {
    renderLayout();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // 앱 셸은 정상(nav·content).
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
    cleanup();
  });

  it("cap 극단(전부 off)에서도 Layout 렌더 생존 + Assist 트리거 존재", () => {
    mockCan = () => false;
    expect(() =>
      render(
        <Layout page="dashboard" onNavigate={() => {}}>
          <div>content</div>
        </Layout>,
      ),
    ).not.toThrow();
    expect(screen.getByText("content")).toBeInTheDocument();
    // Assist 트리거는 cap 게이팅 대상이 아니다(전역 진입점).
    expect(screen.getByRole("button", { name: /무엇이든 물어보기/ })).toBeInTheDocument();
  });
});
