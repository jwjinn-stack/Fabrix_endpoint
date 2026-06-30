import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  decodeState,
  encodeState,
  useUrlState,
  strField,
  enumField,
  csvField,
  rangeField,
} from "./urlState";

const SCHEMA = {
  range: rangeField,
  decision: enumField(["all", "allowed", "flagged", "blocked"] as const, "all"),
  model: strField("all"),
  tags: csvField([]),
} as const;

// History/location 을 jsdom 기본으로 두되, 각 테스트 전 깨끗한 경로로 리셋.
function resetUrl(search = "") {
  window.history.replaceState(null, "", "/traces" + (search ? `?${search}` : ""));
}

describe("urlState — 순수 인코더/디코더 (IMP-24)", () => {
  it("url→state: 마운트 시 querystring 에서 필터를 복원한다", () => {
    const s = decodeState(SCHEMA, "?model=gpt&decision=blocked&range=1h");
    expect(s.model).toBe("gpt");
    expect(s.decision).toBe("blocked");
    expect(s.range).toBe("1h");
  });

  it("default 와 같은 값은 생략 → 깨끗한 URL", () => {
    const s = decodeState(SCHEMA, "");
    expect(encodeState(SCHEMA, s)).toBe("");
  });

  it("range whitelist: 미허용 값은 default(24h)로 폴백(throw 없음)", () => {
    const s = decodeState(SCHEMA, "?range=999d");
    expect(s.range).toBe("24h");
  });

  it("csv roundtrip: 배열 ↔ a,b, 빈 배열은 생략", () => {
    const s = decodeState(SCHEMA, "?tags=a,b");
    expect(s.tags).toEqual(["a", "b"]);
    expect(encodeState(SCHEMA, s)).toBe("tags=a%2Cb");
    expect(encodeState(SCHEMA, { ...s, tags: [] })).toBe("");
  });
});

describe("useUrlState 훅 (IMP-24)", () => {
  let replaceSpy: ReturnType<typeof vi.spyOn>;
  let pushSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetUrl();
    replaceSpy = vi.spyOn(window.history, "replaceState");
    pushSpy = vi.spyOn(window.history, "pushState");
  });
  afterEach(() => {
    replaceSpy.mockRestore();
    pushSpy.mockRestore();
    vi.useRealTimers();
  });

  function Harness({ ref }: { ref: { current: ReturnType<typeof useUrlState<typeof SCHEMA>> | null } }) {
    const tuple = useUrlState(SCHEMA);
    ref.current = tuple;
    return <div data-testid="decision">{tuple[0].decision}</div>;
  }

  it("마운트 시 URL 에서 state 를 시드한다", () => {
    resetUrl("model=claude&range=6h");
    const ref: { current: ReturnType<typeof useUrlState<typeof SCHEMA>> | null } = { current: null };
    render(<Harness ref={ref} />);
    expect(ref.current![0].model).toBe("claude");
    expect(ref.current![0].range).toBe("6h");
  });

  it("state→url: patch 는 replaceState 로 되쓰고 pushState 는 부르지 않는다", () => {
    const ref: { current: ReturnType<typeof useUrlState<typeof SCHEMA>> | null } = { current: null };
    render(<Harness ref={ref} />);
    act(() => ref.current![1]({ decision: "blocked" }));
    expect(screen.getByTestId("decision").textContent).toBe("blocked");
    expect(window.location.search).toContain("decision=blocked");
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("debounce: opts.debounce 면 ~300ms 후에 1회만 되쓴다", () => {
    vi.useFakeTimers();
    const ref: { current: ReturnType<typeof useUrlState<typeof SCHEMA>> | null } = { current: null };
    render(<Harness ref={ref} />);
    replaceSpy.mockClear();
    act(() => ref.current![1]({ model: "x" }, { debounce: true }));
    // 즉시는 URL 되쓰기 없음(state 만 갱신).
    expect(replaceSpy).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(window.location.search).toContain("model=x");
  });

  it("schema 외 query 키는 보존된다(드릴다운 from/to 등)", () => {
    resetUrl("from=2026-01-01&decision=flagged");
    const ref: { current: ReturnType<typeof useUrlState<typeof SCHEMA>> | null } = { current: null };
    render(<Harness ref={ref} />);
    act(() => ref.current![1]({ decision: "blocked" }));
    expect(window.location.search).toContain("decision=blocked");
    expect(window.location.search).toContain("from=2026-01-01");
  });
});
