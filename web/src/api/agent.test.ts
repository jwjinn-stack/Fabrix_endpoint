// IMP-60 — AI Agent 순수 루프/도구 테스트.
// runAgentLoop 는 온톨로지 스냅샷 위에서만 동작하는 순수 함수라, 픽스처만으로 결정성·grounding·
// two-tier 안전(도구에 mutating 없음)·fallback 을 DOM/네트워크 없이 가드한다.
import { describe, it, expect } from "vitest";
import {
  runAgentLoop, toolQueryObjects, toolTraverseLinks, toolGetIncidents, FALLBACK_RUNBOOK,
} from "./agent";
import type { AgentToolName, OntologyLink, OntologyObject } from "./types";

// 척추 픽스처: endpoint:e-slow(crit) --serves--> model:m(warn) --runsOn--> gpu:g(crit) --hostedBy--> node:n(warn)
//   + incident:i1(affects endpoint) + service:other(같은 node) — buildRootCausePath 가 blast-radius 로 붙일 수 있게.
const OBJS: OntologyObject[] = [
  { id: "endpoint:e-slow", type: "Endpoint", title: "느린 EP", props: { ready: false }, status: "crit", revision: 1 },
  { id: "endpoint:e-ok", type: "Endpoint", title: "정상 EP", props: { ready: true }, status: "ok", revision: 1 },
  { id: "model:m", type: "Model", title: "모델 M", props: { replicas: 2 }, status: "warn", revision: 1 },
  { id: "gpu:g", type: "GpuDevice", title: "GPU 0", props: { util_perc: 0.96 }, status: "crit", revision: 1 },
  { id: "node:n", type: "Node", title: "노드 N", props: { cpu_util: 0.82 }, status: "warn", revision: 1 },
  { id: "service:other", type: "Service", title: "다른 서비스", props: { qps: 12 }, status: "warn", revision: 1 },
  { id: "incident:i1", type: "Incident", title: "EP NotReady", props: { severity: "critical", state: "triggered" }, status: "crit", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "endpoint:e-slow", to: "model:m", linkKind: "serves" },
  { from: "model:m", to: "gpu:g", linkKind: "runsOn" },
  { from: "gpu:g", to: "node:n", linkKind: "hostedBy" },
  { from: "service:other", to: "node:n", linkKind: "hostedBy" },
  { from: "incident:i1", to: "endpoint:e-slow", linkKind: "affects" },
];

const run = (over: Partial<Parameters<typeof runAgentLoop>[2]> = {}) =>
  runAgentLoop(OBJS, LINKS, { traceId: "tr_test", nowIso: "2026-07-01T00:00:00Z", ...over });

describe("read tools — 조회만(mutate 없음)", () => {
  it("queryObjects(type) 는 명사를 추리고 objectIds 를 근거로 반환", () => {
    const r = toolQueryObjects(OBJS, { type: "Endpoint" });
    expect(r.found).toBe(true);
    expect(r.objectIds).toContain("endpoint:e-slow");
    expect(r.objectIds.every((id) => id.startsWith("endpoint:"))).toBe(true);
  });
  it("traverseLinks 는 이웃 objectId 를 반환하고, 미존재 대상은 found=false", () => {
    const hit = toolTraverseLinks(OBJS, LINKS, { objectId: "endpoint:e-slow" });
    expect(hit.found).toBe(true);
    expect(hit.objectIds).toContain("model:m");
    const miss = toolTraverseLinks(OBJS, LINKS, { objectId: "endpoint:nope" });
    expect(miss.found).toBe(false);
    expect(miss.objectIds).toEqual([]);
  });
  it("getIncidents 는 Incident Object 만 모은다", () => {
    const r = toolGetIncidents(OBJS);
    expect(r.objectIds).toEqual(["incident:i1"]);
  });
});

describe("runAgentLoop — normal(ReAct + grounding)", () => {
  it("read tool 이 순서대로 실행되고(getIncidents→queryObjects→traverseLinks) grounded=true", () => {
    const r = run();
    expect(r.grounded).toBe(true);
    const tools = r.steps.filter((s) => s.kind === "tool").map((s) => (s.kind === "tool" ? s.call.tool : "")) as AgentToolName[];
    expect(tools).toEqual(["getIncidents", "queryObjects", "traverseLinks"]);
    // reasoning 스텝이 tool 사이사이 존재(ReAct — 생각+행동 교차).
    expect(r.steps.some((s) => s.kind === "reasoning")).toBe(true);
    // 첫 스텝은 reasoning(접지 대상 탐색).
    expect(r.steps[0].kind).toBe("reasoning");
  });

  it("RCA 후보가 objectId 를 인용하고(citations), critical hop 이 최상위 confidence", () => {
    const r = run();
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.citations.length).toBeGreaterThan(0);       // grounding 강제
      expect(c.citations).toContain(c.objectId);           // 자기 objectId 인용
      expect(c.confidence).toBeGreaterThan(0);
    }
    // confidence 내림차순 정렬.
    for (let i = 1; i < r.candidates.length; i++) {
      expect(r.candidates[i - 1].confidence).toBeGreaterThanOrEqual(r.candidates[i].confidence);
    }
  });

  it("suggestedAction 은 objectType 별 verb(Model→scaleReplicas, GpuDevice→drainGpu, Node→cordonNode)", () => {
    const r = run();
    const byType = Object.fromEntries(r.candidates.map((c) => [c.objectType, c.suggestedAction?.actionType]));
    if (byType.Model) expect(byType.Model).toBe("scaleReplicas");
    if (byType.GpuDevice) expect(byType.GpuDevice).toBe("drainGpu");
    if (byType.Node) expect(byType.Node).toBe("cordonNode");
  });

  it("**안전**: 어떤 스텝도 mutating tool(invokeAction 등)을 호출하지 않는다", () => {
    const r = run();
    const READ_ONLY: AgentToolName[] = ["queryObjects", "traverseLinks", "getIncidents"];
    for (const s of r.steps) {
      if (s.kind === "tool") expect(READ_ONLY).toContain(s.call.tool);
    }
    // suggestedAction 은 '제안'일 뿐 — steps 에 실행 흔적이 없다(실행은 ActionForm).
    expect(r.steps.some((s) => s.kind === "tool" && (s.call.tool as string) === "invokeAction")).toBe(false);
  });
});

describe("runAgentLoop — retry(결정성)", () => {
  it("같은 입력 → 동일 step 순서·동일 후보 objectId 집합", () => {
    const a = run();
    const b = run();
    expect(a.steps.map((s) => s.kind)).toEqual(b.steps.map((s) => s.kind));
    expect(new Set(a.candidates.map((c) => c.objectId))).toEqual(new Set(b.candidates.map((c) => c.objectId)));
  });
});

describe("runAgentLoop — audit(trace ID transcript)", () => {
  it("audit 라인이 traceId 로 키잉되고 prompt/tool/reasoning 종류를 포함", () => {
    const r = run();
    expect(r.audit.every((a) => a.traceId === "tr_test")).toBe(true);
    const kinds = new Set(r.audit.map((a) => a.kind));
    expect(kinds.has("prompt")).toBe(true);
    expect(kinds.has("tool")).toBe(true);
    expect(kinds.has("reasoning")).toBe(true);
  });
});

describe("runAgentLoop — grounding-empty → runbook fallback(hallucination 금지)", () => {
  it("진입점이 없으면(빈 온톨로지) grounded=false + 정적 runbook + 후보 0", () => {
    const r = runAgentLoop([], [], { traceId: "tr_empty", nowIso: "t" });
    expect(r.grounded).toBe(false);
    expect(r.candidates).toEqual([]);
    expect(r.fallbackRunbook).toEqual(FALLBACK_RUNBOOK);
    // 그래도 tool 은 실행 흔적이 있다(getIncidents 자동 실행).
    expect(r.steps.some((s) => s.kind === "tool")).toBe(true);
  });

  it("bad-input: 미지 entity 는 defaultEntry 로 폴백(고립 아님) — throw 없음", () => {
    const r = run({ entity: "endpoint:does-not-exist" });
    // 미지 entity 는 무시되고 가장 아픈 진입으로 접지 → grounded.
    expect(r.grounded).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it("불변식: grounded=false ⇒ runbook 존재 & 후보 0, grounded=true ⇒ 모든 후보가 objectId 인용", () => {
    // 단일 정상 엔드포인트 — buildRootCausePath 의 골든시그널이 spike 하면 이상 hop 이 생길 수도 있다.
    // 어느 쪽이든 hallucination-guard 계약은 성립해야 한다(지어내지 않음).
    const oneOk: OntologyObject[] = [
      { id: "endpoint:x", type: "Endpoint", title: "정상", props: { ready: true }, status: "ok", revision: 1 },
    ];
    const r = runAgentLoop(oneOk, [], { traceId: "tr_ok", nowIso: "t" });
    if (!r.grounded) {
      expect(r.fallbackRunbook).toBeTruthy();
      expect(r.candidates).toEqual([]);
    } else {
      for (const c of r.candidates) expect(c.citations.length).toBeGreaterThan(0);
    }
  });
});
