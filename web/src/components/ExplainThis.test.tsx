import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import type { ReactNode } from "react";

// IMP-104 — explain-this-selection(콕 집어 물어보기, 키보드 우선) 테스트.
//   data-explain-key focusable + ⓘ + Enter/우클릭 → AssistPanel 프리필; 선택 팝오버(secondary);
//   glossary term → 정의, 미등록 → 정직 폴백(환각 금지); progressive disclosure; a11y; 격리(IMP-88).

// capabilities: manage. 포털 의존 자식 스텁(nav.test 패턴).
let mockCan = (_cap: string) => true;
const mockCaps = { profile: "manage", readonly: false, capabilities: {} as Record<string, boolean>, data_source: "", integrations: {} };
vi.mock("../capabilities", () => ({ useCap: () => ({ caps: mockCaps, can: mockCan }) }));
vi.mock("./Notifications", () => ({ default: () => null }));
vi.mock("./CommandPalette", () => ({ default: () => null }));

import Layout from "./Layout";
import ExplainThis, { useExplain } from "./ExplainThis";
import { openExplain, subscribeExplain } from "./assistBus";

// Layout 은 children 만 렌더하므로(실 페이지 아님), explain-this 어포던스를 children 으로 직접 심어
//   전역 assistBus 구독(Layout)이 프리필 오픈으로 이어지는지 통합 검증한다.
function renderLayout(children?: ReactNode) {
  render(
    <Layout page="dashboard" onNavigate={() => {}}>
      {children ?? <div>content</div>}
    </Layout>,
  );
}

afterEach(() => cleanup());

describe("IMP-104 — ExplainThis 어포던스(키보드 우선 PRIMARY)", () => {
  beforeEach(() => { mockCan = () => true; });

  it("data-explain-key 요소가 focusable(tabindex=0)이고 role=button·ⓘ 어포던스를 가진다", () => {
    render(<ExplainThis explainKey="ttft" label="TTFT p95">TTFT p95</ExplainThis>);
    const el = screen.getByRole("button", { name: /TTFT p95 설명 보기/ });
    expect(el).toHaveAttribute("tabindex", "0");
    expect(el).toHaveAttribute("data-explain-key", "ttft");
    // ⓘ 어포던스 존재(자동 발화 아님 — 마운트만으로 패널 안 열림).
    expect(el.textContent).toContain("ⓘ");
  });

  it("어포던스 마운트만으로는 패널이 열리지 않는다(no focus theft)", () => {
    renderLayout(<ExplainThis explainKey="ttft" label="TTFT p95">TTFT p95</ExplainThis>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Enter 키 → AssistPanel 이 프리필(용어 정의)로 열린다", async () => {
    renderLayout(<ExplainThis explainKey="ttft" label="TTFT p95">TTFT p95</ExplainThis>);
    const label = screen.getByRole("button", { name: /TTFT p95 설명 보기/ });
    fireEvent.keyDown(label, { key: "Enter" });
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    const log = within(dialog).getByRole("log");
    // glossary ttft 큐레이션 정의(환각 아님) — 정의 본문(라벨 "TTFT(첫 토큰까지 시간)"와 구분).
    await waitFor(() => expect(within(log).getByText(/첫 응답 토큰이 나오기까지/)).toBeInTheDocument());
  });

  it("우클릭(contextmenu) → 동일하게 프리필로 열린다", async () => {
    renderLayout(<ExplainThis explainKey="qps" label="QPS">QPS</ExplainThis>);
    const label = screen.getByRole("button", { name: /QPS 설명 보기/ });
    fireEvent.contextMenu(label);
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    const log = within(dialog).getByRole("log");
    await waitFor(() => expect(within(log).getByText(/초당 처리되는 요청/)).toBeInTheDocument());
  });

  it("등록 glossary term → 큐레이션 정의(grounded), progressive disclosure(정의 먼저 · why 이어짐)", async () => {
    renderLayout();
    act(() => { openExplain({ explainKey: "backpressure", label: "backpressure" }); });
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    const log = within(dialog).getByRole("log");
    await waitFor(() => expect(within(log).getByText(/대기 큐가 쌓이는/)).toBeInTheDocument());
    // why(왜 중요한가)가 이어짐 — progressive disclosure 상세.
    await waitFor(() => expect(within(log).getByText(/왜 중요한가/)).toBeInTheDocument());
  });

  it("미등록 term → 정직 폴백(환각 없음)", async () => {
    renderLayout();
    act(() => { openExplain({ label: "존재하지않는용어zzz" }); });
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    const log = within(dialog).getByRole("log");
    await waitFor(() =>
      expect(within(log).getByText(/등록된 용어 정의를 찾지 못했습니다/)).toBeInTheDocument(),
    );
  });

  it("Esc 로 프리필 패널이 닫힌다(a11y dismiss)", async () => {
    renderLayout();
    act(() => { openExplain({ explainKey: "ttft" }); });
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("IMP-104 — 텍스트 선택 팝오버(SECONDARY, 마우스 편의)", () => {
  beforeEach(() => { mockCan = () => true; });

  it("텍스트 선택 시 'ⓘ 설명' 버튼 등장 → 클릭 시 프리필 오픈(키보드 경로는 별도 존재 = secondary)", async () => {
    // 키보드 PRIMARY 경로(data-explain-key)도 함께 마운트 — 선택 팝오버가 유일 경로가 아님을 검증.
    renderLayout(<ExplainThis explainKey="ttft" label="TTFT p95">TTFT p95</ExplainThis>);
    // 선택 시뮬레이션: getSelection().toString() 이 텍스트를 반환하도록 스텁.
    const fakeSel = {
      toString: () => "backpressure",
      rangeCount: 1,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 100, top: 50, width: 40, height: 16 }) }),
    };
    const spy = vi.spyOn(window, "getSelection").mockReturnValue(fakeSel as unknown as Selection);
    fireEvent.mouseUp(document);
    const popBtn = await waitFor(() => screen.getByRole("button", { name: /선택한 .*backpressure.* 설명 보기/ }));
    // 키보드 PRIMARY 경로가 여전히 존재함(선택 없이도 도달 가능) — data-explain-key 요소.
    expect(screen.getAllByRole("button", { name: /설명 보기/ }).length).toBeGreaterThan(1);
    fireEvent.click(popBtn);
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    const log = within(dialog).getByRole("log");
    await waitFor(() => expect(within(log).getByText(/대기 큐가 쌓이는/)).toBeInTheDocument());
    spy.mockRestore();
  });
});

describe("IMP-104 — 격리(IMP-88) · 읽기전용", () => {
  it("구독자 없이 openExplain 호출해도 throw 하지 않는다(격리 no-op)", () => {
    expect(() => openExplain({ explainKey: "ttft" })).not.toThrow();
  });

  it("subscribeExplain 은 해지 함수를 반환하고, 해지 후엔 콜백이 호출되지 않는다", () => {
    const cb = vi.fn();
    const off = subscribeExplain(cb);
    act(() => { openExplain({ explainKey: "ttft" }); });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    openExplain({ explainKey: "p95" });
    expect(cb).toHaveBeenCalledTimes(1); // 해지 후 미호출
  });

  it("useExplain 훅이 focusable/키보드/우클릭 핸들러 묶음을 반환한다(커스텀 마크업 배선)", () => {
    let captured: ReturnType<typeof useExplain> | null = null;
    function Probe() {
      captured = useExplain({ explainKey: "p95", label: "p95" });
      return <span {...captured.handlers}>p95</span>;
    }
    render(<Probe />);
    expect(captured!.handlers.tabIndex).toBe(0);
    expect(captured!.handlers.role).toBe("button");
    expect(captured!.handlers["data-explain-key"]).toBe("p95");
  });
});
