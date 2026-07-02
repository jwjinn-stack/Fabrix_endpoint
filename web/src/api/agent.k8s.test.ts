// IMP-91 — Kubernetes 클러스터 상태 질의(read-only K8s MCP tool) 테스트.
// buildK8sSnapshot(mock 파생) + runK8sQuery(순수 ReAct)를 픽스처로 결정성·상관·read-only·격리를 가드한다.
import { describe, it, expect, beforeAll } from "vitest";
import {
  runK8sQuery, toolListPods, toolListNodes, toolGetEvents, toolDescribeDeployment,
} from "./agent";
import { buildK8sSnapshot } from "./mock";
import { installMockFetch } from "./mock";
import { runK8sQuery as runK8sQueryClient, mcpListTools } from "./client";
import { K8S_TOOL_REGISTRY, assertReadOnly } from "../actions/ontologyTools";
import type { K8sToolName, OntologyLink, OntologyObject } from "./types";

// 척추 픽스처: crit GPU가 얹힌 crit Node + 그 Node에 스케줄될 crit Endpoint(replicas 2).
//   → NotReady 노드 · OOMKilled 파드 · OOMKilling 이벤트 · unavailable rollout 가 상관 파생되어야 한다.
const OBJS: OntologyObject[] = [
  { id: "node:gpu-node-02", type: "Node", title: "gpu-node-02", props: { hostname: "gpu-node-02" }, status: "crit", revision: 1 },
  { id: "gpu:gpu-node-02/0", type: "GpuDevice", title: "GPU 0", props: { util_perc: 0.02, temp_c: 92 }, status: "crit", revision: 1 },
  // Ready 노드 여러 개 — 정상 Endpoint 가 NotReady 노드에 몰리지 않도록(해시 배정이 흩어짐).
  { id: "node:gpu-node-01", type: "Node", title: "gpu-node-01", props: { hostname: "gpu-node-01" }, status: "ok", revision: 1 },
  { id: "node:gpu-node-03", type: "Node", title: "gpu-node-03", props: { hostname: "gpu-node-03" }, status: "ok", revision: 1 },
  { id: "endpoint:qwen25-vl-7b", type: "Endpoint", title: "qwen25-vl-7b", props: { namespace: "fabrix", replicas: 2, ready: false }, status: "crit", revision: 1 },
  { id: "endpoint:gemma", type: "Endpoint", title: "gemma-3-27b-it", props: { namespace: "fabrix", replicas: 2, ready: true }, status: "ok", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "gpu:gpu-node-02/0", to: "node:gpu-node-02", linkKind: "hostedBy" },
];

const K8S_ONLY: K8sToolName[] = ["list_pods", "list_nodes", "get_events", "describe_deployment"];

describe("K8S_TOOL_REGISTRY — 4 read tool 등록 + read-only(two-tier)", () => {
  it("list_pods/list_nodes/get_events/describe_deployment 4종이 레지스트리에 존재", () => {
    for (const n of K8S_ONLY) expect(K8S_TOOL_REGISTRY[n]).toBeTruthy();
    expect(Object.keys(K8S_TOOL_REGISTRY).sort()).toEqual([...K8S_ONLY].sort());
  });
  it("**안전**: read-only 불변식 통과(mutating 성격 이름 없음)", () => {
    expect(() => assertReadOnly(K8S_TOOL_REGISTRY)).not.toThrow();
    const verbs = ["scale", "restart", "drain", "cordon", "delete", "create", "update", "patch", "apply"];
    for (const n of Object.keys(K8S_TOOL_REGISTRY)) {
      for (const v of verbs) expect(n.toLowerCase().includes(v)).toBe(false);
    }
  });
  it("모든 tool inputSchema 가 additionalProperties:false(LLM hallucinated args 거부)", () => {
    for (const t of Object.values(K8S_TOOL_REGISTRY)) {
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.inputSchema.type).toBe("object");
    }
  });
});

describe("buildK8sSnapshot — 온톨로지 상관 결정적 파생", () => {
  it("crit Node/GPU → NotReady 노드 + NodeNotReady 이벤트(objectId 인용)", () => {
    const k8s = buildK8sSnapshot(OBJS, LINKS);
    const nr = k8s.nodes.find((n) => n.name === "gpu-node-02");
    expect(nr?.condition).toBe("NotReady");
    expect(nr?.objectId).toBe("node:gpu-node-02");
    expect(k8s.events.some((e) => e.reason === "NodeNotReady" && e.objectId === "node:gpu-node-02")).toBe(true);
  });
  it("crit Endpoint → OOMKilled 파드 + OOMKilling 이벤트 + unavailable rollout(endpoint objectId 인용)", () => {
    const k8s = buildK8sSnapshot(OBJS, LINKS);
    const oom = k8s.pods.find((p) => p.objectId === "endpoint:qwen25-vl-7b" && p.oomKilled);
    expect(oom).toBeTruthy();
    expect(oom!.restarts).toBeGreaterThan(0);
    expect(k8s.events.some((e) => e.reason === "OOMKilling" && e.objectId === "endpoint:qwen25-vl-7b")).toBe(true);
    const dep = k8s.deployments.find((d) => d.objectId === "endpoint:qwen25-vl-7b");
    expect(dep!.rollout).not.toBe("complete");
    expect(dep!.unavailable).toBeGreaterThan(0);
  });
  it("정상 온톨로지(Ready 노드 + ok Endpoint) → 파드 전부 Running(재시작 0), rollout complete", () => {
    // NotReady 노드가 없는 별도 스냅샷 — 정상 상관을 검증(FailedScheduling 섞이지 않음).
    const okObjs: OntologyObject[] = [
      { id: "node:n-ok", type: "Node", title: "n-ok", props: { hostname: "n-ok" }, status: "ok", revision: 1 },
      { id: "endpoint:gemma", type: "Endpoint", title: "gemma-3-27b-it", props: { namespace: "fabrix", replicas: 2, ready: true }, status: "ok", revision: 1 },
    ];
    const k8s = buildK8sSnapshot(okObjs, []);
    const okPods = k8s.pods.filter((p) => p.objectId === "endpoint:gemma");
    expect(okPods.length).toBeGreaterThan(0);
    expect(okPods.every((p) => p.phase === "Running" && p.restarts === 0 && !p.oomKilled)).toBe(true);
    expect(k8s.deployments.find((d) => d.objectId === "endpoint:gemma")!.rollout).toBe("complete");
  });
  it("결정성 — 같은 온톨로지 → 동일 스냅샷(파드 이름/이벤트 동일)", () => {
    const a = buildK8sSnapshot(OBJS, LINKS);
    const b = buildK8sSnapshot(OBJS, LINKS);
    expect(a.pods.map((p) => p.name)).toEqual(b.pods.map((p) => p.name));
    expect(a.events.map((e) => e.involvedObject + e.reason)).toEqual(b.events.map((e) => e.involvedObject + e.reason));
  });
  it("격리(direction 9) — 빈 스냅샷/객체 부재에서 throw 없이 빈 결과", () => {
    expect(() => buildK8sSnapshot([], [])).not.toThrow();
    const empty = buildK8sSnapshot([], []);
    expect(empty.pods).toEqual([]);
    expect(empty.nodes).toEqual([]);
    expect(empty.deployments).toEqual([]);
  });
});

describe("read tools — 조회만(K8sSnapshot 위 필터)", () => {
  const k8s = buildK8sSnapshot(OBJS, LINKS);
  it("list_pods(objectId) 로 파드를 상관 필터", () => {
    const r = toolListPods(k8s, { objectId: "endpoint:qwen25-vl-7b" });
    expect(r.found).toBe(true);
    expect(r.resourceRefs.every((ref) => ref.startsWith("pod/"))).toBe(true);
    expect(r.objectIds).toContain("endpoint:qwen25-vl-7b");
  });
  it("list_nodes(condition=NotReady) 로 NotReady 노드만", () => {
    const r = toolListNodes(k8s, { condition: "NotReady" });
    expect(r.found).toBe(true);
    expect(r.objectIds).toContain("node:gpu-node-02");
  });
  it("get_events(reason=OOMKilling) 로 OOM 이벤트만", () => {
    const r = toolGetEvents(k8s, { reason: "OOMKilling" });
    expect(r.found).toBe(true);
  });
  it("describe_deployment 는 배포 rollout 을 반환", () => {
    const r = toolDescribeDeployment(k8s, {});
    expect(r.found).toBe(true);
  });
});

describe("runK8sQuery — 파드/노드 질문에 인용으로 답(ReAct)", () => {
  const k8s = buildK8sSnapshot(OBJS, LINKS);
  const run = (intent: string) => runK8sQuery(k8s, { intent, traceId: "tr_k8s", nowIso: "2026-07-02T00:00:00Z" });

  it("'왜 이 파드가 재시작했나' → list_pods+get_events tool step + 파드/objectId 인용", () => {
    const r = run("왜 이 파드가 재시작했나?");
    const tools = r.steps.filter((s) => s.kind === "tool").map((s) => (s.kind === "tool" ? s.call.tool : ""));
    expect(tools).toContain("list_pods");
    expect(tools).toContain("get_events");
    expect(r.grounded).toBe(true);
    // OOMKilled 파드(qwen)를 진단하고 그 endpoint objectId 를 인용하는 finding 이 존재.
    const f = r.findings.find((x) => x.citations.includes("endpoint:qwen25-vl-7b") && x.resourceRefs.some((ref) => ref.startsWith("pod/")));
    expect(f).toBeTruthy();
    expect(f!.title).toContain("OOMKilled");
  });
  it("'어느 노드가 NotReady 인가' → list_nodes tool step + node objectId 인용", () => {
    const r = run("어느 노드가 NotReady 인가?");
    const tools = r.steps.filter((s) => s.kind === "tool").map((s) => (s.kind === "tool" ? s.call.tool : ""));
    expect(tools).toContain("list_nodes");
    const f = r.findings.find((x) => x.citations.includes("node:gpu-node-02"));
    expect(f).toBeTruthy();
    expect(f!.severity).toBe("crit");
  });
  it("'배포 rollout' → describe_deployment tool step + finding", () => {
    const r = run("배포 rollout 상태를 확인해줘");
    const tools = r.steps.filter((s) => s.kind === "tool").map((s) => (s.kind === "tool" ? s.call.tool : ""));
    expect(tools).toContain("describe_deployment");
  });
  it("**정직성(direction 8)**: mock=true + source 에 'mock'", () => {
    const r = run("왜 이 파드가 재시작했나?");
    expect(r.mock).toBe(true);
    expect(r.source.toLowerCase()).toContain("mock");
  });
  it("**안전(two-tier)**: 스텝에 등장하는 tool 은 read-only 4종뿐(mutating 없음)", () => {
    for (const intent of ["파드 재시작", "NotReady 노드", "rollout"]) {
      const r = run(intent);
      for (const s of r.steps) if (s.kind === "tool") expect(K8S_ONLY).toContain(s.call.tool);
    }
  });
  it("이상 없으면(정상 온톨로지) 지어내지 않고 grounded=false + fallbackNote", () => {
    const okObjs: OntologyObject[] = [
      { id: "endpoint:ok", type: "Endpoint", title: "ok-ep", props: { namespace: "fabrix", replicas: 1, ready: true }, status: "ok", revision: 1 },
    ];
    const r = runK8sQuery(buildK8sSnapshot(okObjs, []), { intent: "왜 재시작했나", traceId: "t", nowIso: "t" });
    expect(r.grounded).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.fallbackNote).toBeTruthy();
  });
  it("결정성 — 같은 intent → 동일 step 종류/finding id 집합", () => {
    const a = run("파드 재시작");
    const b = run("파드 재시작");
    expect(a.steps.map((s) => s.kind)).toEqual(b.steps.map((s) => s.kind));
    expect(new Set(a.findings.map((f) => f.id))).toEqual(new Set(b.findings.map((f) => f.id)));
  });
});

describe("mock 라우트 + MCP tools/list(백엔드 계약 통일)", () => {
  beforeAll(() => { installMockFetch(); });

  it("POST /agent/k8s 가 K8sQueryRun 을 반환하고 mock 표기", async () => {
    const r = await runK8sQueryClient({ intent: "왜 이 파드가 재시작했나?" });
    expect(r.traceId).toBeTruthy();
    expect(r.mock).toBe(true);
    expect(r.source.toLowerCase()).toContain("mock");
    expect(r.steps.length).toBeGreaterThan(0);
  });

  it("tools/list 에 K8s read tool 4종이 노출(레지스트리 파생) + mutating 동사 없음", async () => {
    const tools = await mcpListTools();
    const names = new Set(tools.map((t) => t.name));
    for (const n of K8S_ONLY) expect(names.has(n)).toBe(true);
    const verbs = ["scale", "restart", "drain", "cordon", "delete", "create", "update", "patch"];
    for (const t of tools) for (const v of verbs) expect(t.name.toLowerCase().includes(v)).toBe(false);
  });
});
