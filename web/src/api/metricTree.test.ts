// 엔티티-앵커 Metric Explorer(IMP-71) mock 계약 테스트.
// 프로젝트 ethos(백엔드 0개): installMockFetch 로 실제 라우터를 통과시켜 client 경로를 검증한다.
//  - GpuDevice/Node 전량 카테고리 트리(단위·타입·상태·facet·points) · 결정성 · bad-input · 미존재 id · 엔티티 아님.
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch } from "./mock";
import { fetchObjectMetricTree, fetchOntologyObjects } from "./client";
import type { ObjectType } from "./types";

beforeAll(() => {
  installMockFetch();
});

// 스냅샷에서 실제 존재하는 첫 GpuDevice/Node id 를 찾아 사용(하드코딩 대신 계약에서 도출).
async function firstIdOfType(t: ObjectType): Promise<string> {
  const res = await fetchOntologyObjects(t);
  expect(res.objects.length).toBeGreaterThan(0);
  return res.objects[0].id;
}

describe("GET /ontology/objects/:id/metric-tree — GpuDevice normal", () => {
  it("GPU 엔티티는 Utilization~Per-process 카테고리와 단위·타입·points·facet 을 갖는다", async () => {
    const id = await firstIdOfType("GpuDevice");
    const tree = await fetchObjectMetricTree(id, "1h");
    expect(tree.object_type).toBe("GpuDevice");
    expect(tree.source).toContain("mock");
    expect(tree.range).toBe("1h");

    const catKeys = tree.categories.map((c) => c.key);
    // 핵심 카테고리(hw 있는 GPU) — Utilization/Memory/Clocks/Power·Thermal/Interconnect/Errors/Throttle.
    for (const k of ["utilization", "memory", "clocks", "power_thermal", "interconnect", "errors", "throttle"]) {
      expect(catKeys).toContain(k);
    }
    // 모든 행: 단위·타입·points(≥2, 끝=value)·facet(gpu/instance/job/device).
    const rows = tree.categories.flatMap((c) => c.rows);
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      expect(r.unit).toBeDefined();
      expect(["gauge", "counter", "rate"]).toContain(r.type);
      expect(["ok", "warn", "crit", "none"]).toContain(r.status);
      expect(r.points.length).toBeGreaterThanOrEqual(2);
      expect(r.points[r.points.length - 1]).toBe(r.value);
      expect(r.freshness_sec).toBeGreaterThanOrEqual(0);
    }
    // facet — gpu=UUID, instance=host:9400, job=dcgm-exporter.
    expect(tree.facet_keys).toContain("gpu");
    const anyRow = rows[0];
    expect(anyRow.facets.job).toBe("dcgm-exporter");
    expect(anyRow.facets.instance).toMatch(/:9400$/);
    // 단위가 실제로 쓰인다(bytes/MHz/W/count/%) — raw 값은 단위 없이 무의미.
    const units = new Set(rows.map((r) => r.unit));
    expect(units.has("bytes")).toBe(true);
    expect(units.has("MHz")).toBe(true);
    expect(units.has("%")).toBe(true);
  });
});

describe("GET /ontology/objects/:id/metric-tree — Node normal", () => {
  it("Node 엔티티는 CPU/Memory/Disk/Filesystem/Network/Load/Systemd 카테고리를 갖는다", async () => {
    const id = await firstIdOfType("Node");
    const tree = await fetchObjectMetricTree(id, "6h");
    expect(tree.object_type).toBe("Node");
    const catKeys = tree.categories.map((c) => c.key);
    for (const k of ["cpu", "memory", "disk", "filesystem", "network", "load", "systemd"]) {
      expect(catKeys).toContain(k);
    }
    const rows = tree.categories.flatMap((c) => c.rows);
    for (const r of rows) {
      expect(r.unit).toBeDefined();
      expect(["gauge", "counter", "rate"]).toContain(r.type);
    }
    // facet — node exporter instance/job.
    expect(rows[0].facets.job).toBe("node-exporter");
    expect(rows[0].facets.instance).toMatch(/:9100$/);
  });
});

describe("metric-tree — 결정성 / bad-input / 미존재 / 엔티티 아님", () => {
  it("retry/deterministic: 같은 id+range 반복 시 카테고리·메트릭 key·unit 동일", async () => {
    const id = await firstIdOfType("GpuDevice");
    const a = await fetchObjectMetricTree(id, "1h");
    const b = await fetchObjectMetricTree(id, "1h");
    const keysOf = (t: typeof a) => t.categories.map((c) => `${c.key}:${c.rows.map((r) => `${r.key}/${r.unit}/${r.type}`).join(",")}`);
    expect(keysOf(a)).toEqual(keysOf(b));
  });

  it("bad-input: 알 수 없는 range → 기본(1h)로 정규화, 200 + 스키마 유지", async () => {
    const id = await firstIdOfType("Node");
    const tree = await fetchObjectMetricTree(id, "999y");
    expect(tree.range).toBe("1h");
    expect(tree.categories.length).toBeGreaterThan(0);
  });

  it("failure: 미존재 id → 404 throw", async () => {
    await expect(fetchObjectMetricTree("gpu:does-not-exist/gpu9")).rejects.toThrow();
    await expect(fetchObjectMetricTree("nope:zzz")).rejects.toThrow();
  });

  it("env-missing/엔티티 아님: 비-GPU/Node 객체(Model)는 빈 categories(엔티티 앵커 아님)", async () => {
    const id = await firstIdOfType("Model");
    const tree = await fetchObjectMetricTree(id);
    expect(tree.object_type).toBe("Model");
    expect(tree.categories).toEqual([]);
    expect(tree.facet_keys).toEqual([]);
  });

  it("Gpu SlidePanel 경로: 온톨로지에 없는 GPU id(gpu:<host>/gpu<N>)도 genGPU 로 합성 해석된다", async () => {
    // topology 는 host 당 2 GPU 만 승격하지만, genGPU 페이지는 8개 — gpu2+ 도 explorer 가 열려야 한다.
    const tree = await fetchObjectMetricTree("gpu:gpu-node-01/gpu5", "1h");
    expect(tree.object_type).toBe("GpuDevice");
    expect(tree.categories.length).toBeGreaterThan(0);
    expect(tree.categories.map((c) => c.key)).toContain("utilization");
  });
});
