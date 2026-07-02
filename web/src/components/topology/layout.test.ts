import { describe, it, expect } from "vitest";
import { layoutTopology, crossingsBeforeAfter } from "./layout";
import type { TopologyEdge, TopologyNode } from "../../api/types";

function n(id: string, kind: TopologyNode["kind"] = "service"): TopologyNode {
  return { id, kind, status: "ok", label: id };
}
function e(from: string, to: string): TopologyEdge {
  return { from, to };
}

describe("layoutTopology — 순수 계층 DAG 레이아웃 (IMP-47)", () => {
  it("결정적: 같은 입력 → 같은 positions/edgePaths", () => {
    const nodes = [n("a", "server"), n("b", "service"), n("c", "gpu"), n("d", "service")];
    const edges = [e("a", "b"), e("b", "c"), e("a", "d"), e("d", "c")];
    const l1 = layoutTopology(nodes, edges);
    const l2 = layoutTopology(nodes, edges);
    expect([...l1.positions.entries()]).toEqual([...l2.positions.entries()]);
    expect(l1.edgePaths).toEqual(l2.edgePaths);
    expect(l1.width).toBe(l2.width);
    expect(l1.height).toBe(l2.height);
  });

  it("tier 단조 증가: server→service→gpu 체인", () => {
    const nodes = [n("srv", "server"), n("svc", "service"), n("gpu", "gpu")];
    const edges = [e("srv", "svc"), e("svc", "gpu")];
    const l = layoutTopology(nodes, edges);
    const tSrv = l.positions.get("srv")!.tier;
    const tSvc = l.positions.get("svc")!.tier;
    const tGpu = l.positions.get("gpu")!.tier;
    expect(tSrv).toBeLessThan(tSvc);
    expect(tSvc).toBeLessThan(tGpu);
    // x 는 tier 에 비례(오름차순).
    expect(l.positions.get("srv")!.x).toBeLessThan(l.positions.get("gpu")!.x);
  });

  it("cycle break: 사이클 그래프도 무한루프 없이 완료, 최소 1개 엣지 reversed", () => {
    const nodes = [n("a"), n("b"), n("c")];
    const edges = [e("a", "b"), e("b", "c"), e("c", "a")]; // 3-cycle
    const l = layoutTopology(nodes, edges);
    expect(l.positions.size).toBe(3);
    const reversed = l.edgePaths.filter((p) => p.reversed);
    expect(reversed.length).toBeGreaterThanOrEqual(1);
    // 자기루프도 견딤.
    const l2 = layoutTopology([n("x")], [e("x", "x")]);
    expect(l2.positions.size).toBe(1);
  });

  it("barycenter sweep 이 교차수를 늘리지 않는다(회귀 가드)", () => {
    // 교차가 발생하는 이분 그래프: 초기 순서에서 크로스가 생기도록 구성.
    const nodes = [
      n("t0a"), n("t0b"), n("t0c"),
      n("gx", "gpu"), n("gy", "gpu"), n("gz", "gpu"),
    ];
    // t0a→gz, t0b→gy, t0c→gx : 역순 매핑 → 초기 교차 다수.
    const edges = [e("t0a", "gz"), e("t0b", "gy"), e("t0c", "gx"), e("t0a", "gx"), e("t0c", "gz")];
    const { before, after } = crossingsBeforeAfter(nodes, edges, 4);
    expect(after).toBeLessThanOrEqual(before);
  });

  it("edgePaths d 는 논리 from→to 를 잇는 유효한 Bézier 문자열", () => {
    const nodes = [n("a", "server"), n("b", "gpu")];
    const l = layoutTopology(nodes, [e("a", "b")]);
    const ep = l.edgePaths[0];
    expect(ep.from).toBe("a");
    expect(ep.to).toBe("b");
    expect(ep.d).toMatch(/^M[\d.,-]+ C[\d.,\s-]+$/);
  });

  it("빈 그래프도 안전하게 처리", () => {
    const l = layoutTopology([], []);
    expect(l.positions.size).toBe(0);
    expect(l.edgePaths.length).toBe(0);
    expect(l.width).toBeGreaterThan(0);
  });

  // IMP-84 — kind union 확장: 온톨로지 kind(model/endpoint/node/trace/incident/app)도 tier tie-break 를
  // 잃지 않고(‘service’ 붕괴 없음) 결정적으로 레이아웃된다. Record 인덱싱 undefined 크래시 없음.
  it("온톨로지 kind 확장: 미지 kind 붕괴 없이 결정적 레이아웃", () => {
    const nodes: TopologyNode[] = [
      n("m", "model"), n("ep", "endpoint"), n("g", "gpu"),
      n("nd", "node"), n("tr", "trace"), n("inc", "incident"), n("ap", "app"),
    ];
    const edges = [e("ep", "m"), e("m", "g"), e("g", "nd"), e("tr", "ep"), e("inc", "m"), e("ep", "ap")];
    const l1 = layoutTopology(nodes, edges);
    const l2 = layoutTopology(nodes, edges);
    // 모든 노드가 배치되고 결정적(같은 입력 → 같은 결과).
    expect(l1.positions.size).toBe(nodes.length);
    expect([...l1.positions.entries()]).toEqual([...l2.positions.entries()]);
    // tier 단조: endpoint→model→gpu→node 체인이 tier 오름차순.
    expect(l1.positions.get("ep")!.tier).toBeLessThan(l1.positions.get("m")!.tier);
    expect(l1.positions.get("m")!.tier).toBeLessThan(l1.positions.get("g")!.tier);
  });
});
