// IMP-73 — mock MCP tools/list 가 ONTOLOGY_TOOL_REGISTRY 단일 출처에서 파생되는지(프론트/백엔드 통일).
// installMockFetch + client.mcpListTools 로 실제 mock 라우터(POST /api/v1/mcp)를 통과시킨다.
// McpPanel(Diagnostics)이 이 경로로 라이브 목록을 받으므로, 여기 통과 = 패널이 통일 목록을 보여줌.
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch } from "./mock";
import { mcpListTools, mcpListResources } from "./client";
import { ONTOLOGY_TOOL_REGISTRY, K8S_TOOL_REGISTRY, assertReadOnly } from "../actions/ontologyTools";
import { toolGetIncidentContext, toolGetPodDiagnostics, toolListPods, toolGetEvents, toolDescribeDeployment } from "./agent";
import { buildIncidentEvidence, type IncidentSnapshot } from "./incidentEvidence";
import type { K8sSnapshot, OntologyLink, OntologyObject } from "./types";

beforeAll(() => {
  installMockFetch();
});

describe("mock MCP tools/list — 레지스트리 파생·read-only", () => {
  it("aggregate 4종 + 온톨로지 read tool 4종(레지스트리)을 모두 노출", async () => {
    const tools = await mcpListTools();
    const names = new Set(tools.map((t) => t.name));
    // aggregate(mcp.go 고유).
    for (const n of ["list_dimensions", "groupby_metric", "top_outliers", "summarize_endpoint_health"]) {
      expect(names.has(n)).toBe(true);
    }
    // 온톨로지 read tool — 레지스트리 키가 그대로 목록에 존재(수기 미러 아님).
    for (const n of Object.keys(ONTOLOGY_TOOL_REGISTRY)) {
      expect(names.has(n)).toBe(true);
    }
  });

  it("**안전**: mock tools/list 에 mutating 동사 tool 이 없다(auto-callable mutation 없음)", async () => {
    const tools = await mcpListTools();
    const verbs = ["create", "update", "delete", "set", "write", "patch", "scale", "restart", "drain", "cordon", "resolve", "invoke", "apply"];
    for (const t of tools) {
      for (const v of verbs) expect(t.name.toLowerCase().includes(v)).toBe(false);
    }
    // 레지스트리 자체도 read-only 불변식 통과.
    expect(() => assertReadOnly()).not.toThrow();
  });

  it("resources/list 에 fabrix://ontology/schema + 기존 2종", async () => {
    const res = await mcpListResources();
    const uris = new Set(res.map((r) => r.uri));
    expect(uris.has("fabrix://ontology/schema")).toBe(true);
    expect(uris.has("fabrix://metric-catalog")).toBe(true);
    expect(uris.has("fabrix://dimensions")).toBe(true);
  });
});

// ── IMP-98 복합 진단 tool 고정 픽스처(incidentEvidence.test 와 동형) ──────────────
const OBJECTS: OntologyObject[] = [
  { id: "endpoint:e-slow", type: "Endpoint", title: "느린 EP", props: { ready: false, replicas: 2, namespace: "fabrix" }, status: "crit", revision: 1 },
  { id: "model:m", type: "Model", title: "모델 M", props: { replicas: 2 }, status: "warn", revision: 1 },
  { id: "gpu:g", type: "GpuDevice", title: "GPU 0", props: { util_perc: 0.97, mem_perc: 0.93, throttle: "열" }, status: "crit", revision: 1 },
  { id: "node:n", type: "Node", title: "노드 N", props: { hostname: "n0" }, status: "crit", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "endpoint:e-slow", to: "model:m", linkKind: "serves" },
  { from: "model:m", to: "gpu:g", linkKind: "runsOn" },
  { from: "gpu:g", to: "node:n", linkKind: "hostedBy" },
];
const K8S: K8sSnapshot = {
  pods: [
    { name: "e-slow-abc", namespace: "fabrix", phase: "Failed", ready: false, restarts: 7, oomKilled: true, node: "n0", objectId: "endpoint:e-slow", reason: "CrashLoopBackOff" },
    { name: "e-slow-def", namespace: "fabrix", phase: "Running", ready: true, restarts: 0, oomKilled: false, node: "n0", objectId: "endpoint:e-slow" },
  ],
  nodes: [{ name: "n0", condition: "NotReady", reason: "KubeletNotReady", objectId: "node:n" }],
  events: [
    { reason: "OOMKilling", message: "Container OOMKilled (pod e-slow-abc)", involvedObject: "pod/e-slow-abc", count: 7, objectId: "endpoint:e-slow" },
  ],
  deployments: [
    { name: "e-slow", namespace: "fabrix", desired: 2, updated: 2, available: 1, unavailable: 1, rollout: "progressing", objectId: "endpoint:e-slow" },
  ],
};
const SNAP: IncidentSnapshot = { objects: OBJECTS, links: LINKS, k8s: K8S };

describe("IMP-98 복합 진단 read-only tool — 등록·계약·read-only", () => {
  it("K8S_TOOL_REGISTRY 에 get_incident_context/get_pod_diagnostics 등록 + 원자 tool 유지(하이브리드)", () => {
    // 복합 2종 등록.
    expect(K8S_TOOL_REGISTRY.get_incident_context).toBeTruthy();
    expect(K8S_TOOL_REGISTRY.get_pod_diagnostics).toBeTruthy();
    // 원자 tool(coarse→fine 드릴다운)은 그대로 유지.
    for (const n of ["list_pods", "list_nodes", "get_events", "describe_deployment"]) {
      expect(K8S_TOOL_REGISTRY[n]).toBeTruthy();
    }
  });

  it("strict 인자 검증: additionalProperties:false + required(objectId/pod)", () => {
    const ic = K8S_TOOL_REGISTRY.get_incident_context.inputSchema;
    expect(ic.additionalProperties).toBe(false);
    expect(ic.required).toEqual(["objectId"]);
    const pd = K8S_TOOL_REGISTRY.get_pod_diagnostics.inputSchema;
    expect(pd.additionalProperties).toBe(false);
    expect(pd.required).toEqual(["pod"]);
  });

  it("**안전** read-only: assertReadOnly(K8S_TOOL_REGISTRY) 통과 + description 에 no mutation 명시", () => {
    expect(() => assertReadOnly(K8S_TOOL_REGISTRY)).not.toThrow();
    expect(K8S_TOOL_REGISTRY.get_incident_context.description).toContain("no mutation");
    expect(K8S_TOOL_REGISTRY.get_pod_diagnostics.description).toContain("no mutation");
  });

  it("mock tools/list 에 복합 tool 2종 노출 + mutating 동사 여전히 0", async () => {
    const tools = await mcpListTools();
    const names = new Set(tools.map((t) => t.name));
    expect(names.has("get_incident_context")).toBe(true);
    expect(names.has("get_pod_diagnostics")).toBe(true);
    const verbs = ["create", "update", "delete", "set", "write", "patch", "scale", "restart", "drain", "cordon", "resolve", "invoke", "apply"];
    for (const t of tools) for (const v of verbs) expect(t.name.toLowerCase().includes(v)).toBe(false);
  });
});

describe("IMP-98 복합 진단 tool — IMP-99 seam 단일 출처", () => {
  it("get_incident_context == buildIncidentEvidence(objectId, snapshot)(동일 shape·인용 refs)", () => {
    const viaTool = toolGetIncidentContext(SNAP, { objectId: "endpoint:e-slow" });
    const viaSeam = buildIncidentEvidence("endpoint:e-slow", SNAP);
    expect(JSON.stringify(viaTool)).toEqual(JSON.stringify(viaSeam));
    expect(viaTool.found).toBe(true);
    expect(viaTool.empty).toBe(false);
    // 근거 인용(objectId/podRef)이 실려 드릴다운 폴백 가능.
    const refs = viaTool.lines.flatMap((l) => l.sourceRefs);
    expect(refs).toContain("endpoint:e-slow");
    expect(refs.some((r) => r.startsWith("pod/"))).toBe(true);
  });

  it("get_pod_diagnostics: waiting reason·재시작·OOM·연관 events + 상관 objectId(환각 금지)", () => {
    const d = toolGetPodDiagnostics(SNAP, { pod: "pod/e-slow-abc" }); // pod/ 접두 정규화.
    expect(d.found).toBe(true);
    expect(d.pod).toBe("e-slow-abc");
    expect(d.oomKilled).toBe(true);
    expect(d.restarts).toBe(7);
    expect(d.waitingReason).toBe("CrashLoopBackOff");
    expect(d.objectId).toBe("endpoint:e-slow");
    expect(d.relatedEvents.length).toBeGreaterThan(0);
    expect(d.mock).toBe(true);
  });

  it("get_pod_diagnostics: 미발견 파드 → found=false + 지어내지 않음", () => {
    const d = toolGetPodDiagnostics(SNAP, { pod: "ghost-999" });
    expect(d.found).toBe(false);
    expect(d.relatedEvents).toEqual([]);
    expect(d.summary).toContain("찾을 수 없습니다");
  });
});

describe("IMP-98 라운드트립 감소 측정(coarse-grained)", () => {
  it("원자-only(list_pods+get_events+describe_deployment=3콜) vs 복합(get_incident_context=1콜)", () => {
    // 원자 경로: 클라이언트가 원인 컨텍스트를 모으려면 최소 3개 tool 을 각각 호출·상관해야 한다.
    let atomicRoundTrips = 0;
    toolListPods(K8S, { objectId: "endpoint:e-slow" }); atomicRoundTrips++;
    toolGetEvents(K8S, { objectId: "endpoint:e-slow" }); atomicRoundTrips++;
    toolDescribeDeployment(K8S, { objectId: "endpoint:e-slow" }); atomicRoundTrips++;

    // 복합 경로: 한 호출로 동일 근거 번들(pods·events·deployment·큐신호 + 요약)을 받는다.
    let compositeRoundTrips = 0;
    const bundle = toolGetIncidentContext(SNAP, { objectId: "endpoint:e-slow" }); compositeRoundTrips++;

    expect(atomicRoundTrips).toBe(3);
    expect(compositeRoundTrips).toBe(1);
    expect(compositeRoundTrips).toBeLessThan(atomicRoundTrips); // 감소 강제(회귀 가드).
    // 복합 결과가 pod·event·deployment 근거를 모두 담아 원자 3콜을 대체함을 확인.
    const kinds = new Set(bundle.lines.map((l) => l.kind));
    expect(kinds.has("k8sPod")).toBe(true);
    expect(kinds.has("k8sEvent")).toBe(true);
    expect(kinds.has("k8sDeployment")).toBe(true);
  });
});
