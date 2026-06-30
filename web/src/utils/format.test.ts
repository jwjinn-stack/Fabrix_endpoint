import { describe, it, expect } from "vitest";
import { compact, formatMetric } from "./format";

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
