// IMP-78 — 클러스터 인사이트 순수 로직 테스트.
// buildInsightGroundingContext / mockModelInsightCompletion / parseAndGroundInsights / buildAgentInsights 는
// 온톨로지 스냅샷 위에서만 동작하는 순수 함수라, 픽스처만으로 결정성·HARD grounding(인용 강제·드롭)·
// grounding-empty(지어내지 않음)를 DOM/네트워크 없이 가드한다.
import { describe, it, expect } from "vitest";
import {
  buildInsightGroundingContext,
  buildInsightPrompt,
  mockModelInsightCompletion,
  parseAndGroundInsights,
  buildAgentInsights,
} from "./agent";
import type { OntologyLink, OntologyObject } from "./types";

// 픽스처: 노드 n1 위 GPU 2개(둘 다 고사용률 + 하나는 throttle), 노드 n2 위 GPU 1개(유휴: util 낮고 mem 높음).
//   gpu:g1(util .96, throttle), gpu:g2(util .90) --hostedBy--> node:n1
//   gpu:g3(util .04, mem .70) --hostedBy--> node:n2
const OBJS: OntologyObject[] = [
  { id: "node:n1", type: "Node", title: "노드 N1", props: { hostname: "n1" }, status: "warn", revision: 1 },
  { id: "node:n2", type: "Node", title: "노드 N2", props: { hostname: "n2" }, status: "ok", revision: 1 },
  { id: "gpu:g1", type: "GpuDevice", title: "GPU g1", props: { util_perc: 0.96, mem_perc: 0.8, temp_c: 90, throttle: "SW thermal slowdown" }, status: "crit", revision: 1 },
  { id: "gpu:g2", type: "GpuDevice", title: "GPU g2", props: { util_perc: 0.90, mem_perc: 0.6, temp_c: 82, throttle: "제약 없음" }, status: "warn", revision: 1 },
  { id: "gpu:g3", type: "GpuDevice", title: "GPU g3", props: { util_perc: 0.04, mem_perc: 0.70, temp_c: 45, throttle: "제약 없음" }, status: "ok", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "gpu:g1", to: "node:n1", linkKind: "hostedBy" },
  { from: "gpu:g2", to: "node:n1", linkKind: "hostedBy" },
  { from: "gpu:g3", to: "node:n2", linkKind: "hostedBy" },
];

describe("buildInsightGroundingContext — 스냅샷 압축", () => {
  it("validIds 가 온톨로지 id 집합과 일치하고, GPU 요약·노드별 GPU 묶음을 결정적으로 만든다", () => {
    const ctx = buildInsightGroundingContext(OBJS, LINKS);
    expect(ctx.validIds).toEqual(new Set(OBJS.map((o) => o.id)));
    expect(ctx.objectCount).toBe(5);
    expect(ctx.linkCount).toBe(3);
    // GPU 요약 — id 순 정렬, util/throttle 반영.
    expect(ctx.gpus.map((g) => g.id)).toEqual(["gpu:g1", "gpu:g2", "gpu:g3"]);
    expect(ctx.gpus.find((g) => g.id === "gpu:g1")?.throttled).toBe(true);
    expect(ctx.gpus.find((g) => g.id === "gpu:g2")?.throttled).toBe(false);
    // 노드별 GPU 묶음(hostedBy 역방향).
    const n1 = ctx.nodeGpus.find((n) => n.nodeId === "node:n1");
    expect(n1?.gpuIds).toEqual(["gpu:g1", "gpu:g2"]);
    const n2 = ctx.nodeGpus.find((n) => n.nodeId === "node:n2");
    expect(n2?.gpuIds).toEqual(["gpu:g3"]);
  });
});

describe("mockModelInsightCompletion — 결정적 모델 출력(JSON)", () => {
  it("같은 컨텍스트 → 같은 문자열(결정적)", () => {
    const ctx = buildInsightGroundingContext(OBJS, LINKS);
    expect(mockModelInsightCompletion(ctx)).toBe(mockModelInsightCompletion(ctx));
  });
  it("실제 군집/hot-node/유휴갭을 근거로 인사이트를 낸다(+ hallucination 케이스 포함)", () => {
    const ctx = buildInsightGroundingContext(OBJS, LINKS);
    const parsed = JSON.parse(mockModelInsightCompletion(ctx)) as { insights: { kind: string; citations: string[] }[] };
    const kinds = parsed.insights.map((i) => i.kind);
    expect(kinds).toContain("gpu-cluster");     // g1,g2 고사용률 군집
    expect(kinds).toContain("hot-node");        // n1 위 g1 throttle
    expect(kinds).toContain("idle-alloc-gap");  // n2 위 g3 유휴
    // 일부러 인용 없는/가짜 id claim 이 raw 에 존재한다(파이프라인이 드롭할 대상).
    expect(parsed.insights.some((i) => i.citations.length === 0)).toBe(true);
    expect(parsed.insights.some((i) => i.citations.includes("gpu:ghost-9"))).toBe(true);
  });
});

describe("parseAndGroundInsights — HARD grounding(인용 강제·드롭)", () => {
  const validIds = new Set(OBJS.map((o) => o.id));

  it("인용 없는 claim 을 드롭한다", () => {
    const raw = JSON.stringify({ insights: [
      { id: "a", kind: "gpu-cluster", title: "t", claim: "c", citations: ["gpu:g1"], severity: "warn" },
      { id: "b", kind: "recurring-pattern", title: "지어냄", claim: "인용 없음", citations: [] },
    ] });
    const { insights, droppedCount } = parseAndGroundInsights(raw, validIds);
    expect(insights.map((i) => i.id)).toEqual(["a"]);
    expect(droppedCount).toBe(1);
  });

  it("온톨로지에 없는 가짜 id 만 인용하면 유효 0 → 드롭", () => {
    const raw = JSON.stringify({ insights: [
      { id: "fake", kind: "hot-node", title: "유령", claim: "c", citations: ["gpu:ghost-9", "node:nope"], severity: "crit" },
    ] });
    const { insights, droppedCount } = parseAndGroundInsights(raw, validIds);
    expect(insights).toEqual([]);
    expect(droppedCount).toBe(1);
  });

  it("가짜 id 는 필터하되 실재 id 가 하나라도 있으면 유지(가짜만 제거)", () => {
    const raw = JSON.stringify({ insights: [
      { id: "mix", kind: "gpu-cluster", title: "t", claim: "c", citations: ["gpu:g1", "gpu:ghost-9"], severity: "info" },
    ] });
    const { insights } = parseAndGroundInsights(raw, validIds);
    expect(insights).toHaveLength(1);
    expect(insights[0].citations).toEqual(["gpu:g1"]); // 가짜 제거, 실재만.
  });

  it("모델이 JSON 이 아닌 답을 줘도 throw 하지 않고 빈 결과(안전)", () => {
    const { insights, droppedCount } = parseAndGroundInsights("모델이 규칙을 어긴 자연어 응답", validIds);
    expect(insights).toEqual([]);
    expect(droppedCount).toBe(0);
  });
});

describe("buildAgentInsights — 조립 + 계약", () => {
  const run = () => buildAgentInsights(OBJS, LINKS, { traceId: "agti_test", nowIso: "2026-07-02T00:00:00Z" });

  it("모든 표시 인사이트는 objectId 를 인용하고 인용이 전부 실재한다(HARD grounding)", () => {
    const r = run();
    expect(r.grounded).toBe(true);
    expect(r.insights.length).toBeGreaterThan(0);
    const valid = new Set(OBJS.map((o) => o.id));
    for (const ins of r.insights) {
      expect(ins.citations.length).toBeGreaterThan(0);
      for (const id of ins.citations) expect(valid.has(id)).toBe(true);
    }
    // hallucination(인용 없음/가짜 id)은 드롭 카운트로 잡힌다.
    expect(r.droppedCount).toBeGreaterThanOrEqual(2);
  });

  it("결정적 — 같은 스냅샷 2회 → 동일 insight id 집합", () => {
    const a = run();
    const b = run();
    expect(new Set(a.insights.map((i) => i.id))).toEqual(new Set(b.insights.map((i) => i.id)));
  });

  it("audit transcript 가 traceId 로 키잉되고 prompt/reasoning 을 포함(마스킹 메타만)", () => {
    const r = run();
    expect(r.audit.every((a) => a.traceId === "agti_test")).toBe(true);
    const kinds = new Set(r.audit.map((a) => a.kind));
    expect(kinds.has("prompt")).toBe(true);
    expect(kinds.has("reasoning")).toBe(true);
  });

  it("빈 온톨로지 → grounded=false + insights=[] + 요약 존재(지어내지 않음)", () => {
    const r = buildAgentInsights([], [], { traceId: "agti_empty", nowIso: "t" });
    expect(r.grounded).toBe(false);
    expect(r.insights).toEqual([]);
    expect(r.groundingSummary).toBeTruthy();
  });

  it("rawOverride(실 Dynamo completion 모사) 주입 → 같은 강제 파이프라인(가짜 인용 드롭)", () => {
    const override = JSON.stringify({ insights: [
      { id: "real", kind: "gpu-cluster", title: "실모델", claim: "c", citations: ["gpu:g1", "gpu:g2"], severity: "warn" },
      { id: "ghost", kind: "hot-node", title: "가짜", claim: "c", citations: ["gpu:ghost-9"], severity: "crit" },
    ] });
    const r = buildAgentInsights(OBJS, LINKS, { traceId: "agti_real", nowIso: "t", rawOverride: override });
    expect(r.insights.map((i) => i.id)).toEqual(["real"]);
    expect(r.droppedCount).toBe(1);
  });

  it("buildInsightPrompt — 인용 필수·JSON-only 규칙과 압축 컨텍스트를 담는다(실경로 계약)", () => {
    const ctx = buildInsightGroundingContext(OBJS, LINKS);
    const { system, user } = buildInsightPrompt(ctx);
    expect(system).toMatch(/objectId/);
    expect(system).toMatch(/JSON/);
    expect(user).toMatch(/gpu:g1/); // 압축 요약에 실재 id 가 실린다.
  });
});
