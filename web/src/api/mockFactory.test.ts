import { describe, it, expect } from "vitest";
import {
  buildNetwork, buildNodeMetrics, buildTopology,
  hash, seededSeries, statusFromThresholds, worstStatus,
} from "./mockFactory";

describe("seededSeries", () => {
  it("is deterministic for the same seed", () => {
    const a = seededSeries(1234, 20, 60);
    const b = seededSeries(1234, 20, 60);
    expect(a.map((p) => p.value)).toEqual(b.map((p) => p.value));
  });
  it("differs for a different seed", () => {
    const a = seededSeries(1, 20, 60).map((p) => p.value);
    const b = seededSeries(2, 20, 60).map((p) => p.value);
    expect(a).not.toEqual(b);
  });
  it("produces exactly `points` samples", () => {
    expect(seededSeries(7, 48, 60)).toHaveLength(48);
    expect(seededSeries(7, 1, 60)).toHaveLength(1);
  });
  it("clamps every value within [min,max]", () => {
    const s = seededSeries(99, 100, 60, { base: 0.9, amp: 0.5, spike: 0.8, min: 0, max: 1 });
    for (const p of s) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(1);
    }
  });
  it("emits oldest-to-newest timestamps", () => {
    const s = seededSeries(5, 10, 60);
    for (let i = 1; i < s.length; i++) {
      expect(new Date(s[i].ts).getTime()).toBeGreaterThan(new Date(s[i - 1].ts).getTime());
    }
  });
});

describe("statusFromThresholds — higher-is-worse (warn < crit)", () => {
  it("below warn is ok", () => expect(statusFromThresholds(0.5, 0.8, 0.9)).toBe("ok"));
  it("at warn boundary is warn", () => expect(statusFromThresholds(0.8, 0.8, 0.9)).toBe("warn"));
  it("between warn and crit is warn", () => expect(statusFromThresholds(0.85, 0.8, 0.9)).toBe("warn"));
  it("at crit boundary is crit", () => expect(statusFromThresholds(0.9, 0.8, 0.9)).toBe("crit"));
  it("above crit is crit", () => expect(statusFromThresholds(0.99, 0.8, 0.9)).toBe("crit"));
});

describe("statusFromThresholds — lower-is-worse (warn > crit)", () => {
  // 예: 캐시 적중률·가용 대역 — 낮을수록 나쁨.
  it("above warn is ok", () => expect(statusFromThresholds(0.9, 0.5, 0.2)).toBe("ok"));
  it("at warn boundary is warn", () => expect(statusFromThresholds(0.5, 0.5, 0.2)).toBe("warn"));
  it("between warn and crit is warn", () => expect(statusFromThresholds(0.3, 0.5, 0.2)).toBe("warn"));
  it("at crit boundary is crit", () => expect(statusFromThresholds(0.2, 0.5, 0.2)).toBe("crit"));
  it("below crit is crit", () => expect(statusFromThresholds(0.1, 0.5, 0.2)).toBe("crit"));
});

describe("worstStatus", () => {
  it("picks crit over warn/ok", () => expect(worstStatus(["ok", "warn", "crit"])).toBe("crit"));
  it("picks warn over ok", () => expect(worstStatus(["ok", "warn", "ok"])).toBe("warn"));
  it("defaults to ok when empty", () => expect(worstStatus([])).toBe("ok"));
});

describe("buildTopology", () => {
  const g = buildTopology(hash("topology"));

  it("is deterministic for the same seed", () => {
    const a = buildTopology(42);
    const b = buildTopology(42);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
  });
  it("has all three node kinds", () => {
    const kinds = new Set(g.nodes.map((n) => n.kind));
    expect(kinds).toEqual(new Set(["server", "service", "gpu"]));
  });
  it("every edge references existing node ids", () => {
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });
  it("every node status is a valid ThresholdStatus", () => {
    for (const n of g.nodes) expect(["ok", "warn", "crit"]).toContain(n.status);
  });
  it("has a deterministic node/edge count", () => {
    // 3 servers + 3*2 gpu + 3 services = 12 nodes; 6 server-gpu + 3 service-host + 1 chain = 10 edges.
    expect(g.nodes).toHaveLength(12);
    expect(g.edges).toHaveLength(10);
  });
});

describe("buildNodeMetrics", () => {
  it("produces `points` USE-set samples with a derived status", () => {
    const nm = buildNodeMetrics("gpu-node-01", 30, 60);
    expect(nm.points).toHaveLength(30);
    expect(nm.host).toBe("gpu-node-01");
    expect(["ok", "warn", "crit"]).toContain(nm.status);
    const p = nm.points[0];
    for (const v of [p.cpu_util, p.mem_util, p.disk_util, p.swap_used_perc, p.disk_io_perc]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("is deterministic per host", () => {
    expect(buildNodeMetrics("h1", 10, 60).points.map((p) => p.cpu_util))
      .toEqual(buildNodeMetrics("h1", 10, 60).points.map((p) => p.cpu_util));
  });
});

describe("buildNetwork", () => {
  const links = buildNetwork(24, 300);
  it("returns links with time-aligned samples", () => {
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l.points).toHaveLength(24);
      expect(["ok", "warn", "crit"]).toContain(l.status);
      const p = l.points[l.points.length - 1];
      expect(p.latency_p95_ms).toBeGreaterThanOrEqual(p.latency_p50_ms);
      expect(p.latency_p99_ms).toBeGreaterThanOrEqual(p.latency_p95_ms);
      expect(p.rx_mbps).toBeLessThanOrEqual(l.capacity_mbps);
    }
  });
});
