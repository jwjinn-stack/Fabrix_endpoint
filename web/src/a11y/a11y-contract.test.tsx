import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { useDialogA11y } from "./useDialogA11y";
import { useGlobalShortcutGuard } from "./useGlobalShortcutGuard";
import { useStreamingLog, shouldFollowScroll, STATUS_TEXT } from "./useStreamingLog";
import StreamingLog from "./StreamingLog";

afterEach(() => cleanup());

// ── 하네스: useDialogA11y 를 얹은 최소 다이얼로그(IMP-103 마운트 형태 미러) ──
function DialogHarness() {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { dialogRef } = useDialogA11y<HTMLDivElement>({ open, onClose: () => setOpen(false), initialFocusRef: inputRef });
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        트리거
      </button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="어시스트">
          <input ref={inputRef} aria-label="질문 입력" />
          <button type="button">보내기</button>
          <button type="button" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>
      )}
    </div>
  );
}

describe("IMP-102 — useDialogA11y (APG Dialog 계약)", () => {
  it("열릴 때 initialFocusRef(입력창)로 초기 포커스 이동", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "트리거" }));
    // setTimeout(…,0) 포커스가 흐르도록.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByRole("textbox", { name: "질문 입력" })).toHaveFocus();
  });

  it("Esc 로 닫힌다", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "트리거" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // 트랩은 우리 keydown 핸들러가 preventDefault + 순환 focus 를 건다. jsdom 의 user.tab() 은
  // preventDefault 를 무시하고 자체 포커스를 옮기므로(브라우저와 불일치), 실제 브라우저처럼
  // preventDefault 를 존중하는 원시 keydown dispatch 로 트랩 순환을 검증한다.
  it("포커스 트랩 — 마지막에서 Tab 은 처음(입력)으로 순환", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "트리거" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const input = screen.getByRole("textbox", { name: "질문 입력" });
    const close = screen.getByRole("button", { name: "닫기" });
    close.focus();
    expect(close).toHaveFocus();
    dispatchKey({ key: "Tab" }); // 마지막 요소에서 Tab → 처음으로 순환
    expect(input).toHaveFocus();
  });

  it("포커스 트랩 — 처음에서 Shift+Tab 은 마지막으로 순환", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "트리거" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const input = screen.getByRole("textbox", { name: "질문 입력" });
    const close = screen.getByRole("button", { name: "닫기" });
    input.focus();
    dispatchKey({ key: "Tab", shiftKey: true }); // 처음에서 Shift+Tab → 마지막으로 순환
    expect(close).toHaveFocus();
  });

  it("닫힐 때 트리거로 포커스 복원", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "트리거" });
    trigger.focus();
    await user.click(trigger);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
});

// ── useGlobalShortcutGuard ──────────────────────────────────────────────
function GuardHarness({ enabled = true, allowBareChar = true }: { enabled?: boolean; allowBareChar?: boolean }) {
  const [count, setCount] = useState(0);
  useGlobalShortcutGuard({ onTrigger: () => setCount((c) => c + 1), enabled, allowBareChar });
  return (
    <div>
      <span data-testid="count">{count}</span>
      <input aria-label="폼 입력" />
      <div contentEditable aria-label="편집영역" suppressContentEditableWarning>
        edit
      </div>
    </div>
  );
}

// activeElement 에서 dispatch → bubble 로 document·window 리스너 모두에 도달(트랩·가드 공용).
function dispatchKey(init: Partial<KeyboardEvent> & { key: string }) {
  act(() => {
    const target = (document.activeElement as HTMLElement) ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init } as KeyboardEventInit));
  });
}

describe("IMP-102 — useGlobalShortcutGuard (WCAG 2.1.4)", () => {
  it("⌘/ chord 로 onTrigger 발화(primary)", () => {
    render(<GuardHarness />);
    document.body.focus();
    dispatchKey({ key: "/", metaKey: true });
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("Ctrl+/ 도 발화", () => {
    render(<GuardHarness />);
    dispatchKey({ key: "/", ctrlKey: true });
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("input 에 포커스면 무시(폼 타이핑 안 깸)", () => {
    render(<GuardHarness />);
    screen.getByRole("textbox", { name: "폼 입력" }).focus();
    dispatchKey({ key: "/", metaKey: true });
    dispatchKey({ key: "?" });
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("contenteditable 포커스면 무시", () => {
    render(<GuardHarness />);
    (screen.getByLabelText("편집영역") as HTMLElement).focus();
    dispatchKey({ key: "/", metaKey: true });
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("IME 조합 중(isComposing) 무시", () => {
    render(<GuardHarness />);
    dispatchKey({ key: "/", metaKey: true, isComposing: true });
    dispatchKey({ key: "?", keyCode: 229 });
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("enabled:false 면 무시(끄기 경로)", () => {
    render(<GuardHarness enabled={false} />);
    dispatchKey({ key: "/", metaKey: true });
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("bare '?'는 allowBareChar 이고 입력 밖일 때 발화", () => {
    render(<GuardHarness allowBareChar />);
    document.body.focus();
    dispatchKey({ key: "?" });
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("allowBareChar=false 면 bare '?' 무시", () => {
    render(<GuardHarness allowBareChar={false} />);
    document.body.focus();
    dispatchKey({ key: "?" });
    expect(screen.getByTestId("count").textContent).toBe("0");
  });
});

// ── useStreamingLog + StreamingLog (스트리밍 낭독 계약) ───────────────────
function StreamHarness() {
  const s = useStreamingLog();
  return (
    <div>
      <button type="button" onClick={() => { s.pushUser("질문"); s.begin(); }}>start</button>
      <button type="button" onClick={() => s.appendToken("토큰")}>token</button>
      <button type="button" onClick={() => s.commit()}>commit</button>
      <button type="button" onClick={() => s.fail()}>fail</button>
      <StreamingLog messages={s.messages} draft={s.draft} phase={s.phase} statusText={s.statusText} />
    </div>
  );
}

describe("IMP-102 — 스트리밍 낭독 계약(role=log 완료 낭독, 증분 aria-live 금지)", () => {
  it("role=log 컨테이너는 aria-live=polite, aria-atomic=false", () => {
    render(<StreamHarness />);
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveAttribute("aria-atomic", "false");
  });

  it("스트리밍 중 draft 버블은 aria-busy=true + aria-hidden(낭독 제외), log 확정에 미포함", async () => {
    const user = userEvent.setup();
    render(<StreamHarness />);
    await user.click(screen.getByRole("button", { name: "start" }));
    await user.click(screen.getByRole("button", { name: "token" }));
    await user.click(screen.getByRole("button", { name: "token" }));
    const draft = document.querySelector('[data-draft="true"]');
    expect(draft).not.toBeNull();
    expect(draft).toHaveAttribute("aria-busy", "true");
    expect(draft).toHaveAttribute("aria-hidden", "true");
    // 아직 확정 어시스턴트 메시지는 없다(증분이 log 노드로 쌓이지 않음).
    expect(document.querySelectorAll('.sl-assistant:not(.sl-draft)').length).toBe(0);
  });

  it("commit 후 완성 메시지가 log 에 정확히 1개 append(완료 낭독), draft 사라짐", async () => {
    const user = userEvent.setup();
    render(<StreamHarness />);
    await user.click(screen.getByRole("button", { name: "start" }));
    await user.click(screen.getByRole("button", { name: "token" }));
    await user.click(screen.getByRole("button", { name: "token" }));
    await user.click(screen.getByRole("button", { name: "commit" }));
    const committed = document.querySelectorAll('.sl-assistant:not(.sl-draft)');
    expect(committed.length).toBe(1);
    expect(committed[0].textContent).toBe("토큰토큰");
    expect(document.querySelector('[data-draft="true"]')).toBeNull();
  });

  it("role=status 진행 문구: streaming→'응답 생성 중', done→'완료', error→'연결 오류'", async () => {
    const user = userEvent.setup();
    render(<StreamHarness />);
    const status = screen.getByRole("status");
    await user.click(screen.getByRole("button", { name: "start" }));
    expect(status.textContent).toBe("응답 생성 중");
    await user.click(screen.getByRole("button", { name: "commit" }));
    expect(status.textContent).toBe("완료");
    await user.click(screen.getByRole("button", { name: "start" }));
    await user.click(screen.getByRole("button", { name: "fail" }));
    expect(status.textContent).toBe("연결 오류");
    expect(STATUS_TEXT.streaming).toBe("응답 생성 중");
  });

  it("fail 은 부분 응답을 확정하지 않는다(불완전 텍스트 미낭독)", async () => {
    const user = userEvent.setup();
    render(<StreamHarness />);
    await user.click(screen.getByRole("button", { name: "start" }));
    await user.click(screen.getByRole("button", { name: "token" }));
    await user.click(screen.getByRole("button", { name: "fail" }));
    expect(document.querySelectorAll('.sl-assistant:not(.sl-draft)').length).toBe(0);
    expect(document.querySelector('[data-draft="true"]')).toBeNull();
  });

  it("shouldFollowScroll — 하단 근처면 따라가고, 위로 스크롤 중이면 점프 안 함", () => {
    // 하단(거리 0) → follow
    expect(shouldFollowScroll({ scrollTop: 500, scrollHeight: 1000, clientHeight: 500 })).toBe(true);
    // 위로 스크롤(거리 400) → 유지(점프 방지)
    expect(shouldFollowScroll({ scrollTop: 100, scrollHeight: 1000, clientHeight: 500 })).toBe(false);
  });
});
