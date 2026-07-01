import { describe, it, expect } from "vitest";
import { compact, formatMetric, relativeTime } from "./format";

describe("compact", () => {
  it("formats millions with M suffix", () => {
    expect(compact(2_500_000)).toBe("2.5M");
  });
  it("formats thousands with K suffix", () => {
    expect(compact(1_500)).toBe("1.5K");
  });
  it("formats small numbers with locale grouping", () => {
    expect(compact(999)).toBe("999");
    expect(compact(12_000)).toBe("12.0K");
  });
  it("rounds sub-thousand values", () => {
    expect(compact(12.7)).toBe("13");
  });
});

describe("formatMetric", () => {
  it("ms unit appends ms and rounds", () => {
    expect(formatMetric("ms", 149.6)).toBe("150ms");
  });
  it("ratio unit renders percent", () => {
    expect(formatMetric("ratio", 0.655)).toBe("66%");
  });
  it("req/s unit keeps two decimals", () => {
    expect(formatMetric("req/s", 51.04)).toBe("51.04");
  });
  it("unknown unit falls back to compact", () => {
    expect(formatMetric("tokens", 2_500_000)).toBe("2.5M");
  });
});

describe("relativeTime (IMP-43)", () => {
  const now = Date.parse("2026-06-30T12:00:00Z");
  it("returns dash for empty/invalid", () => {
    expect(relativeTime(undefined, now)).toBe("—");
    expect(relativeTime("nonsense", now)).toBe("—");
  });
  it("shows 방금 전 for very recent", () => {
    expect(relativeTime("2026-06-30T11:59:40Z", now)).toBe("방금 전");
  });
  it("shows minutes/hours/days 전 for past", () => {
    expect(relativeTime("2026-06-30T11:30:00Z", now)).toBe("30분 전");
    expect(relativeTime("2026-06-30T09:00:00Z", now)).toBe("3시간 전");
    expect(relativeTime("2026-06-28T12:00:00Z", now)).toBe("2일 전");
  });
  it("uses 후 suffix for future (snooze ~까지)", () => {
    expect(relativeTime("2026-06-30T13:00:00Z", now)).toBe("1시간 후");
  });
});
