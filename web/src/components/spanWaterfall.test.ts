import { describe, it, expect } from "vitest";
import { spanGeometry, spanDepth, selfMs, kindCounts } from "./spanWaterfall";
import type { SpanKind, TraceSpan } from "../api/types";

function sp(p: Partial<TraceSpan> & { span_id: string }): TraceSpan {
  return {
    span_id: p.span_id,
    parent_id: p.parent_id,
    name: p.name ?? p.span_id,
    kind: (p.kind ?? "span") as SpanKind,
    source: p.source ?? "otel",
    start_ms: p.start_ms ?? 0,
    duration_ms: p.duration_ms ?? 0,
    status: p.status ?? "ok",
    attributes: p.attributes ?? {},
  };
}

describe("spanGeometry", () => {
  it("offset/duration → left/width %", () => {
    const g = spanGeometry(sp({ span_id: "a", start_ms: 250, duration_ms: 500 }), 1000);
    expect(g.leftPct).toBeCloseTo(25);
    expect(g.widthPct).toBeCloseTo(50);
  });

  it("총합 0 이면 1 로 나눠 NaN 방지", () => {
    const g = spanGeometry(sp({ span_id: "a", start_ms: 0, duration_ms: 0 }), 0);
    expect(g.leftPct).toBe(0);
    expect(g.widthPct).toBeGreaterThan(0); // 최소폭 보장
  });

  it("아주 짧은 span 도 최소폭으로 보인다", () => {
    const g = spanGeometry(sp({ span_id: "a", start_ms: 0, duration_ms: 1 }), 100000);
    expect(g.widthPct).toBeGreaterThanOrEqual(0.8);
  });

  it("막대가 우측으로 넘치지 않게 폭 제한", () => {
    const g = spanGeometry(sp({ span_id: "a", start_ms: 900, duration_ms: 500 }), 1000);
    expect(g.leftPct).toBeCloseTo(90);
    expect(g.leftPct + g.widthPct).toBeLessThanOrEqual(100.001);
  });

  it("left 는 0..100 클램프", () => {
    const g = spanGeometry(sp({ span_id: "a", start_ms: 5000, duration_ms: 10 }), 1000);
    expect(g.leftPct).toBe(100);
  });
});

describe("spanDepth", () => {
  const a = sp({ span_id: "a" });
  const b = sp({ span_id: "b", parent_id: "a" });
  const c = sp({ span_id: "c", parent_id: "b" });
  const byId = new Map([a, b, c].map((x) => [x.span_id, x]));

  it("부모 없으면 0", () => expect(spanDepth(a, byId)).toBe(0));
  it("1단계", () => expect(spanDepth(b, byId)).toBe(1));
  it("다단계", () => expect(spanDepth(c, byId)).toBe(2));

  it("사이클이어도 무한루프 없이 종료", () => {
    const x = sp({ span_id: "x", parent_id: "y" });
    const y = sp({ span_id: "y", parent_id: "x" });
    const m = new Map([x, y].map((s) => [s.span_id, s]));
    expect(spanDepth(x, m)).toBeLessThan(3);
  });
});

describe("selfMs", () => {
  it("자식 없으면 duration 그대로", () => {
    const a = sp({ span_id: "a", duration_ms: 300 });
    expect(selfMs(a, [a])).toBe(300);
  });

  it("직속 자식 duration 합을 차감", () => {
    const a = sp({ span_id: "a", duration_ms: 300 });
    const b = sp({ span_id: "b", parent_id: "a", duration_ms: 120 });
    const c = sp({ span_id: "c", parent_id: "a", duration_ms: 80 });
    expect(selfMs(a, [a, b, c])).toBe(100);
  });

  it("자식이 부모보다 길면 0 클램프", () => {
    const a = sp({ span_id: "a", duration_ms: 50 });
    const b = sp({ span_id: "b", parent_id: "a", duration_ms: 200 });
    expect(selfMs(a, [a, b])).toBe(0);
  });

  it("손자(간접)는 차감하지 않음 — 직속만", () => {
    const a = sp({ span_id: "a", duration_ms: 300 });
    const b = sp({ span_id: "b", parent_id: "a", duration_ms: 100 });
    const c = sp({ span_id: "c", parent_id: "b", duration_ms: 90 });
    expect(selfMs(a, [a, b, c])).toBe(200); // 300 - 100, c 는 손자라 무시
  });
});

describe("kindCounts", () => {
  it("등장 순서를 보존하고 개수를 센다", () => {
    const spans = [
      sp({ span_id: "1", kind: "guardrail" }),
      sp({ span_id: "2", kind: "generation" }),
      sp({ span_id: "3", kind: "generation" }),
      sp({ span_id: "4", kind: "retriever" }),
    ];
    expect(kindCounts(spans)).toEqual([
      { kind: "guardrail", count: 1 },
      { kind: "generation", count: 2 },
      { kind: "retriever", count: 1 },
    ]);
  });

  it("빈 배열은 빈 결과", () => expect(kindCounts([])).toEqual([]));
});
