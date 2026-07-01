// IMP-66 — 온톨로지 그래프 helper(순수) 테스트.
// neighbors/out/in(kind 필터) · bfs(depth·linkKind·direction) · shortestPath(found/none) ·
// subgraph · 미존재 id → 빈 결과 · cycle-safe(무한 루프 없음) · 결정성.
import { describe, it, expect } from "vitest";
import { OntologyGraph, buildGraph } from "./ontologyGraph";
import type { OntologyLink, OntologyObject } from "./types";

// 척추 그래프: endpoint:e --serves--> model:m --runsOn--> gpu:g --hostedBy--> node:n.
// service:s --consumes--> endpoint:e (상류). incident:i --affects--> endpoint:e.
const OBJECTS: OntologyObject[] = [
  { id: "endpoint:e", type: "Endpoint", title: "EP", props: {}, status: "crit", revision: 1 },
  { id: "model:m", type: "Model", title: "M", props: {}, status: "warn", revision: 1 },
  { id: "gpu:g", type: "GpuDevice", title: "GPU", props: {}, status: "crit", revision: 1 },
  { id: "node:n", type: "Node", title: "Node", props: {}, status: "warn", revision: 1 },
  { id: "service:s", type: "Service", title: "Svc", props: {}, status: "ok", revision: 1 },
  { id: "incident:i", type: "Incident", title: "Inc", props: {}, status: "crit", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "endpoint:e", to: "model:m", linkKind: "serves" },
  { from: "model:m", to: "gpu:g", linkKind: "runsOn" },
  { from: "gpu:g", to: "node:n", linkKind: "hostedBy" },
  { from: "service:s", to: "endpoint:e", linkKind: "consumes" },
  { from: "incident:i", to: "endpoint:e", linkKind: "affects" },
];

const g = () => buildGraph(OBJECTS, LINKS);

describe("OntologyGraph — 투영/링크 조회", () => {
  it("has/object/type 조회", () => {
    const graph = g();
    expect(graph.has("model:m")).toBe(true);
    expect(graph.has("nope")).toBe(false);
    expect(graph.object("gpu:g")?.title).toBe("GPU");
    expect(graph.type("node:n")).toBe("Node");
    expect(graph.type("nope")).toBeUndefined();
    expect(graph.objects().length).toBe(OBJECTS.length);
  });

  it("outLinks/inLinks 방향·kind 필터", () => {
    const graph = g();
    // endpoint:e — out: serves(→model). in: consumes(service), affects(incident).
    expect(graph.outLinks("endpoint:e").map((l) => l.linkKind).sort()).toEqual(["serves"]);
    expect(graph.inLinks("endpoint:e").map((l) => l.linkKind).sort()).toEqual(["affects", "consumes"]);
    // kind 필터.
    expect(graph.inLinks("endpoint:e", "affects").map((l) => l.from)).toEqual(["incident:i"]);
    expect(graph.outLinks("endpoint:e", "runsOn")).toEqual([]); // 없는 kind → []
    // 배열 kind 필터.
    expect(graph.inLinks("endpoint:e", ["affects", "consumes"]).length).toBe(2);
  });

  it("bad-input: 미존재 id → 빈 링크", () => {
    const graph = g();
    expect(graph.outLinks("nope")).toEqual([]);
    expect(graph.inLinks("nope")).toEqual([]);
  });
});

describe("OntologyGraph — neighbors(방향 무관)", () => {
  it("양방향 이웃 dedup·id 정렬", () => {
    const graph = g();
    // endpoint:e 의 이웃: model:m(out), service:s·incident:i(in) → id 정렬.
    expect(graph.neighborIds("endpoint:e")).toEqual(["incident:i", "model:m", "service:s"]);
  });

  it("kind 필터 이웃", () => {
    const graph = g();
    expect(graph.neighborIds("endpoint:e", "serves")).toEqual(["model:m"]);
    expect(graph.neighborIds("endpoint:e", "affects")).toEqual(["incident:i"]);
    // 배열 필터.
    expect(graph.neighborIds("endpoint:e", ["serves", "affects"])).toEqual(["incident:i", "model:m"]);
  });

  it("bad-input: 미존재 id → [] (throw 없음)", () => {
    expect(g().neighbors("nope")).toEqual([]);
    expect(g().neighborIds("nope")).toEqual([]);
  });

  it("neighbors 는 실재 객체만(dangling id 제외)", () => {
    // dangling: from 은 실재, to 는 인덱스에 없음 → neighbors 에서 걸러짐.
    const graph = new OntologyGraph(
      [{ id: "a", type: "Node", title: "A", props: {}, status: "ok", revision: 1 }],
      [{ from: "a", to: "ghost", linkKind: "hostedBy" }],
    );
    expect(graph.neighborIds("a")).toEqual([]);
  });
});

describe("OntologyGraph — bfs(무가중)", () => {
  it("normal: 무방향 BFS 가 전체 연결 성분 방문(시작 depth 0)", () => {
    const graph = g();
    const order = graph.bfs("endpoint:e");
    expect(order[0]).toBe("endpoint:e"); // 시작 노드
    // 모든 노드 도달(단일 연결 성분).
    expect(new Set(order)).toEqual(new Set(OBJECTS.map((o) => o.id)));
  });

  it("maxDepth 로 절단(depth 0=시작, 1=직접 이웃)", () => {
    const graph = g();
    const d1 = graph.bfs("endpoint:e", { maxDepth: 1 });
    // 시작 + 직접 이웃(model:m, service:s, incident:i)만.
    expect(new Set(d1)).toEqual(new Set(["endpoint:e", "model:m", "service:s", "incident:i"]));
    // gpu:g(2-hop)는 없음.
    expect(d1).not.toContain("gpu:g");
  });

  it("direction=out 은 하류만(from→to) 따라감", () => {
    const graph = g();
    const out = graph.bfs("endpoint:e", { direction: "out" });
    // 하류: endpoint→model→gpu→node. 상류(service/incident)는 제외.
    expect(new Set(out)).toEqual(new Set(["endpoint:e", "model:m", "gpu:g", "node:n"]));
    expect(out).not.toContain("service:s");
  });

  it("direction=in 은 상류만(to→from)", () => {
    const graph = g();
    const inb = graph.bfs("endpoint:e", { direction: "in" });
    // 상류: endpoint 로 들어오는 service·incident 만(그 위로는 없음).
    expect(new Set(inb)).toEqual(new Set(["endpoint:e", "service:s", "incident:i"]));
  });

  it("linkKind 필터로 특정 관계만 따라감", () => {
    const graph = g();
    // serves 만: endpoint→model 한 hop 뒤 model 의 serves 이웃 없음 → 거기서 멈춤.
    const served = graph.bfs("endpoint:e", { linkKind: "serves" });
    expect(new Set(served)).toEqual(new Set(["endpoint:e", "model:m"]));
  });

  it("failure/bad-input: 미존재 시작 id → []", () => {
    expect(g().bfs("nope")).toEqual([]);
  });
});

describe("OntologyGraph — shortestPath(무가중)", () => {
  it("normal: 척추 최단경로", () => {
    const graph = g();
    expect(graph.shortestPath("endpoint:e", "node:n")).toEqual([
      "endpoint:e", "model:m", "gpu:g", "node:n",
    ]);
  });

  it("from===to → [from]", () => {
    expect(g().shortestPath("model:m", "model:m")).toEqual(["model:m"]);
  });

  it("failure: 경로 없음 → null (연결 성분 분리)", () => {
    // 두 개의 분리된 성분.
    const graph = new OntologyGraph(
      [
        { id: "a", type: "Node", title: "A", props: {}, status: "ok", revision: 1 },
        { id: "b", type: "Node", title: "B", props: {}, status: "ok", revision: 1 },
      ],
      [], // 링크 없음 → a,b 분리
    );
    expect(graph.shortestPath("a", "b")).toBeNull();
  });

  it("bad-input: 미존재 endpoint → null", () => {
    const graph = g();
    expect(graph.shortestPath("nope", "node:n")).toBeNull();
    expect(graph.shortestPath("endpoint:e", "nope")).toBeNull();
  });

  it("direction 제약 하 경로(out 전용이면 상류 목표 도달 불가)", () => {
    const graph = g();
    // out 전용: service:s 로는 못 감(service 는 endpoint 의 상류).
    expect(graph.shortestPath("endpoint:e", "service:s", { direction: "out" })).toBeNull();
    // 무방향이면 도달(endpoint→service, consumes 링크를 역방향으로).
    expect(graph.shortestPath("endpoint:e", "service:s")).toEqual(["endpoint:e", "service:s"]);
  });
});

describe("OntologyGraph — subgraph(유도)", () => {
  it("양끝이 모두 집합에 있는 링크만 남는다", () => {
    const graph = g();
    const sub = graph.subgraph(["endpoint:e", "model:m", "gpu:g"]);
    expect(new Set(sub.objects().map((o) => o.id))).toEqual(new Set(["endpoint:e", "model:m", "gpu:g"]));
    // serves(e→m)·runsOn(m→g)는 유지, hostedBy(g→node:n)는 node 제외라 사라짐.
    expect(sub.outLinks("gpu:g")).toEqual([]); // node:n 이 없으니 hostedBy 제거
    expect(sub.neighborIds("model:m").sort()).toEqual(["endpoint:e", "gpu:g"]);
  });

  it("subgraph 는 원본을 변형하지 않는다(순수)", () => {
    const graph = g();
    graph.subgraph(["endpoint:e"]);
    // 원본은 그대로.
    expect(graph.objects().length).toBe(OBJECTS.length);
    expect(graph.neighborIds("endpoint:e").length).toBe(3);
  });
});

describe("OntologyGraph — cycle-safe / 결정성 / 빈 그래프", () => {
  it("사이클(a→b→a)에서도 bfs/shortestPath 가 무한 루프 없이 종료", () => {
    const cyc = new OntologyGraph(
      [
        { id: "a", type: "Node", title: "A", props: {}, status: "ok", revision: 1 },
        { id: "b", type: "Node", title: "B", props: {}, status: "ok", revision: 1 },
        { id: "c", type: "Node", title: "C", props: {}, status: "ok", revision: 1 },
      ],
      [
        { from: "a", to: "b", linkKind: "hostedBy" },
        { from: "b", to: "a", linkKind: "hostedBy" }, // 사이클
        { from: "b", to: "c", linkKind: "hostedBy" },
      ],
    );
    const order = cyc.bfs("a");
    expect(new Set(order)).toEqual(new Set(["a", "b", "c"]));
    // 각 노드 1회만.
    expect(order.length).toBe(3);
    expect(cyc.shortestPath("a", "c")).toEqual(["a", "b", "c"]);
  });

  it("retry(결정성): 같은 입력 두 그래프의 bfs/neighbors/shortestPath 동일 순서", () => {
    const a = buildGraph(OBJECTS, LINKS);
    const b = buildGraph(OBJECTS, LINKS);
    expect(a.bfs("endpoint:e")).toEqual(b.bfs("endpoint:e"));
    expect(a.neighborIds("endpoint:e")).toEqual(b.neighborIds("endpoint:e"));
    expect(a.shortestPath("endpoint:e", "node:n")).toEqual(b.shortestPath("endpoint:e", "node:n"));
  });

  it("bad-input: 빈 objects/links → 빈 그래프(throw 없음)", () => {
    const empty = buildGraph([], []);
    expect(empty.objects()).toEqual([]);
    expect(empty.bfs("x")).toEqual([]);
    expect(empty.neighbors("x")).toEqual([]);
    expect(empty.shortestPath("x", "y")).toBeNull();
    expect(empty.subgraph([]).objects()).toEqual([]);
  });
});
