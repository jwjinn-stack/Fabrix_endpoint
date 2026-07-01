import { describe, it, expect } from "vitest";
import {
  nodeNavTarget,
  correlateInfra,
  modelForEndpoint,
  hostOfGpuNode,
} from "./correlation";
import type { TopologyGraph, TopologyNode } from "./types";

// IMP-50 — correlation moat 순수 seam 테스트: 노드 kind별 드릴다운 매핑 + endpoint→infra saturation.

const graph: TopologyGraph = {
  generated_at: "2026-07-01T00:00:00Z",
  source: "test",
  nodes: [
    { id: "gpu-node-01", kind: "server", status: "warn", label: "gpu-node-01", metrics: { cpu_util: 0.82 } },
    { id: "gpu-node-01/gpu0", kind: "gpu", status: "crit", label: "GPU0", metrics: { util_perc: 0.95 } },
    { id: "gpu-node-01/gpu1", kind: "gpu", status: "ok", label: "GPU1", metrics: { util_perc: 0.4 } },
    { id: "gpu-node-02", kind: "server", status: "ok", label: "gpu-node-02", metrics: { cpu_util: 0.35 } },
    { id: "gpu-node-02/gpu0", kind: "gpu", status: "ok", label: "GPU0", metrics: { util_perc: 0.3 } },
    { id: "gemma-3-27b-it", kind: "service", status: "ok", label: "Gemma", metrics: { qps: 12, error_rate: 0.01 } },
    { id: "qwen3-32b-router", kind: "service", status: "ok", label: "Qwen", metrics: { qps: 8, error_rate: 0.0 } },
  ],
  edges: [
    { from: "gpu-node-01", to: "gpu-node-01/gpu0" },
    { from: "gpu-node-01", to: "gpu-node-01/gpu1" },
    { from: "gpu-node-02", to: "gpu-node-02/gpu0" },
    { from: "gemma-3-27b-it", to: "gpu-node-01", qps: 12, error_rate: 0.01 },
    { from: "qwen3-32b-router", to: "gpu-node-02", qps: 8, error_rate: 0.0 },
  ],
};

describe("nodeNavTarget — 노드 kind별 기존 화면 드릴다운", () => {
  it("service → Traces(모델 필터 시드)", () => {
    const svc: TopologyNode = { id: "qwen3-32b-router", kind: "service", status: "ok", label: "Qwen" };
    const t = nodeNavTarget(svc);
    expect(t?.page).toBe("traces");
    expect(t?.params?.model).toBe("qwen3-32b"); // endpoint → model 매핑
  });

  it("gpu → Gpu 화면(host 시드)", () => {
    const g: TopologyNode = { id: "gpu-node-01/gpu0", kind: "gpu", status: "crit", label: "GPU0" };
    const t = nodeNavTarget(g);
    expect(t?.page).toBe("gpu");
    expect(t?.params?.host).toBe("gpu-node-01");
  });

  it("server → NodeMetrics(host 시드)", () => {
    const s: TopologyNode = { id: "gpu-node-02", kind: "server", status: "ok", label: "gpu-node-02" };
    const t = nodeNavTarget(s);
    expect(t?.page).toBe("nodes");
    expect(t?.params?.host).toBe("gpu-node-02");
  });
});

describe("helpers", () => {
  it("hostOfGpuNode 는 gpu id 에서 host 접두어를 뽑는다", () => {
    expect(hostOfGpuNode("gpu-node-03/gpu1")).toBe("gpu-node-03");
    expect(hostOfGpuNode("solo")).toBe("solo");
  });
  it("modelForEndpoint 는 미지 endpoint 는 그대로 반환(graceful)", () => {
    expect(modelForEndpoint("gemma-3-27b-it")).toBe("gemma-3-27b-it");
    expect(modelForEndpoint("unknown-ep")).toBe("unknown-ep");
  });
});

describe("correlateInfra — endpoint(service) → host/GPU saturation 상관", () => {
  it("압박 있는 호스트: pressure=true, host/GPU status 및 note 반환", () => {
    const c = correlateInfra("gemma-3-27b-it", graph);
    expect(c).not.toBeNull();
    expect(c?.host).toBe("gpu-node-01");
    expect(c?.hostStatus).toBe("warn");
    expect(c?.worstGpuStatus).toBe("crit"); // gpu0 crit 이 최악
    expect(c?.pressure).toBe(true);
    expect(c?.note).toContain("gpu-node-01");
  });

  it("정상 호스트: pressure=false", () => {
    const c = correlateInfra("qwen3-32b-router", graph);
    expect(c?.host).toBe("gpu-node-02");
    expect(c?.pressure).toBe(false);
  });

  it("미지 endpoint / graph 없음 → null(graceful)", () => {
    expect(correlateInfra("no-such-ep", graph)).toBeNull();
    expect(correlateInfra("gemma-3-27b-it", null)).toBeNull();
  });
});
