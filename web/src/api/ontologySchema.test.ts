// IMP-63 — Ontology 스키마 파생(순수) 테스트.
// buildObjectTypeCatalog / buildSchemaGraph 는 순수 → DOM 없이 결정성·엣지케이스를 가드한다.
import { describe, it, expect } from "vitest";
import { buildObjectTypeCatalog, buildSchemaGraph, OBJECT_TYPES } from "./ontologySchema";
import type { OntologyLink, OntologyObject } from "./types";

// §5.2 척추 일부를 그대로 반영한 소형 픽스처: Service→Endpoint→Model→GpuDevice→Node + Incident affects.
function fixtureObjects(): OntologyObject[] {
  return [
    { id: "service:svc-a", type: "Service", title: "Svc A", props: {}, status: "ok", revision: 1 },
    { id: "endpoint:ep-a", type: "Endpoint", title: "EP A", props: {}, status: "crit", revision: 1 },
    { id: "endpoint:ep-b", type: "Endpoint", title: "EP B", props: {}, status: "ok", revision: 1 },
    { id: "model:m-a", type: "Model", title: "Model A", props: {}, status: "warn", revision: 1 },
    { id: "gpu:g0", type: "GpuDevice", title: "GPU 0", props: {}, status: "crit", revision: 1 },
    { id: "node:n0", type: "Node", title: "Node 0", props: {}, status: "ok", revision: 1 },
    { id: "incident:i0", type: "Incident", title: "인시던트 0", props: {}, status: "warn", revision: 1 },
  ];
}
function fixtureLinks(): OntologyLink[] {
  return [
    { from: "service:svc-a", to: "endpoint:ep-a", linkKind: "consumes" },
    { from: "endpoint:ep-a", to: "model:m-a", linkKind: "serves" },
    { from: "endpoint:ep-b", to: "model:m-a", linkKind: "serves" }, // 같은 타입쌍 두 번 → count=2
    { from: "model:m-a", to: "gpu:g0", linkKind: "runsOn" },
    { from: "gpu:g0", to: "node:n0", linkKind: "hostedBy" },
    { from: "incident:i0", to: "endpoint:ep-a", linkKind: "affects" },
  ];
}

describe("buildObjectTypeCatalog", () => {
  it("타입당 1장, OBJECT_TYPES 순서 고정 + 라이브 인스턴스 수", () => {
    const cat = buildObjectTypeCatalog(fixtureObjects());
    expect(cat.map((c) => c.type)).toEqual(OBJECT_TYPES);
    const byType = Object.fromEntries(cat.map((c) => [c.type, c.count]));
    expect(byType.Endpoint).toBe(2);
    expect(byType.Model).toBe(1);
    expect(byType.Trace).toBe(0); // 인스턴스 0 타입도 카드로 포함
  });

  it("상태 분포·worst·대표 인스턴스(나쁜 상태 우선)", () => {
    const cat = buildObjectTypeCatalog(fixtureObjects());
    const ep = cat.find((c) => c.type === "Endpoint")!;
    expect(ep.statusCounts.crit).toBe(1);
    expect(ep.statusCounts.ok).toBe(1);
    expect(ep.worst).toBe("crit"); // crit 이 있으면 worst=crit
    expect(ep.samples[0].status).toBe("crit"); // 대표는 나쁜 상태 우선
  });

  it("bad-input: 빈 objects → 모든 카드 count 0(그리드 유지, throw 없음)", () => {
    const cat = buildObjectTypeCatalog([]);
    expect(cat).toHaveLength(OBJECT_TYPES.length);
    expect(cat.every((c) => c.count === 0 && c.worst === "unknown")).toBe(true);
  });
});

describe("buildSchemaGraph", () => {
  it("Object 타입=노드, 존재하는 타입쌍=엣지(§5.2), 인스턴스 링크 수를 qps 로", () => {
    const { graph, edges } = buildSchemaGraph(fixtureObjects(), fixtureLinks());
    // 노드는 링크에 등장한 타입만(전부 등장) — type: 접두.
    expect(graph.nodes.map((n) => n.id)).toContain("type:Model");
    expect(graph.nodes.every((n) => n.id.startsWith("type:"))).toBe(true);
    // Endpoint→Model 은 두 인스턴스 링크 → count=2.
    const epModel = edges.find((e) => e.fromType === "Endpoint" && e.toType === "Model");
    expect(epModel?.kind).toBe("serves");
    expect(epModel?.count).toBe(2);
    // graph 엣지에도 qps=count 로 인코딩.
    const ge = graph.edges.find((e) => e.from === "type:Endpoint" && e.to === "type:Model");
    expect(ge?.qps).toBe(2);
  });

  it("retry(결정성): 같은 입력 재호출 시 동일 노드·엣지 순서/카운트", () => {
    const a = buildSchemaGraph(fixtureObjects(), fixtureLinks());
    const b = buildSchemaGraph(fixtureObjects(), fixtureLinks());
    expect(a.graph.nodes.map((n) => n.id)).toEqual(b.graph.nodes.map((n) => n.id));
    expect(a.edges.map((e) => `${e.fromType}-${e.kind}-${e.toType}-${e.count}`))
      .toEqual(b.edges.map((e) => `${e.fromType}-${e.kind}-${e.toType}-${e.count}`));
  });

  it("bad-input: 링크 없음 → 빈 그래프(노드·엣지 0, throw 없음)", () => {
    const { graph, edges } = buildSchemaGraph(fixtureObjects(), []);
    expect(graph.nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it("dangling(타입 미해석) 링크는 무시 — 알 수 없는 id 는 엣지 안 됨", () => {
    const { edges } = buildSchemaGraph(fixtureObjects(), [
      { from: "ghost:x", to: "model:m-a", linkKind: "serves" },
    ]);
    expect(edges).toHaveLength(0);
  });
});
