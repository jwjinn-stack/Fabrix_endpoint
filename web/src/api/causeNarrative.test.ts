// IMP-95 — 온-객체 AI 원인 설명 seam buildCauseNarrative(순수·결정적) 테스트.
// 케이스: 4 고정 섹션(what/why/impact/next) / HARD grounding(인용 없는 claim 드롭) / empty(환각 금지) /
//         mode(mock=rule-based, 실=model) 정직 표기 / 결정성 / 인용 objectId 클릭 대상 판별.
import { describe, it, expect } from "vitest";
import { buildCauseNarrative } from "./causeNarrative";
import { buildIncidentEvidence, type IncidentEvidence, type IncidentSnapshot } from "./incidentEvidence";
import type { K8sSnapshot, OntologyLink, OntologyObject } from "./types";

// 척추: endpoint --serves--> model --runsOn--> gpu --hostedBy--> node. gpu/node crit → 신호 실림.
const OBJECTS: OntologyObject[] = [
  { id: "endpoint:e-slow", type: "Endpoint", title: "느린 EP", props: { ready: false, replicas: 2, namespace: "fabrix" }, status: "crit", revision: 1 },
  { id: "model:m", type: "Model", title: "모델 M", props: { replicas: 2 }, status: "warn", revision: 1 },
  { id: "gpu:g", type: "GpuDevice", title: "GPU 0", props: { util_perc: 0.97, mem_perc: 0.93, throttle: "열(HW Thermal Slowdown)" }, status: "crit", revision: 1 },
  { id: "node:n", type: "Node", title: "노드 N", props: { hostname: "n0", cpu_util: 0.94, net_err_per_s: 12 }, status: "crit", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "endpoint:e-slow", to: "model:m", linkKind: "serves" },
  { from: "model:m", to: "gpu:g", linkKind: "runsOn" },
  { from: "gpu:g", to: "node:n", linkKind: "hostedBy" },
];
const K8S: K8sSnapshot = {
  pods: [
    { name: "e-slow-abc", namespace: "fabrix", phase: "Failed", ready: false, restarts: 7, oomKilled: true, node: "n0", objectId: "endpoint:e-slow", reason: "CrashLoopBackOff" },
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
const EV = buildIncidentEvidence("endpoint:e-slow", SNAP);

describe("buildCauseNarrative — 4 고정 섹션", () => {
  it("항상 what/why/impact/next 4 섹션을 순서대로 반환", () => {
    const n = buildCauseNarrative(EV, { mock: true });
    expect(n.sections.map((s) => s.key)).toEqual(["what", "why", "impact", "next"]);
    expect(n.sections.every((s) => !!s.title)).toBe(true);
  });

  it("근거가 있으면 각 핵심 섹션에 claim 이 실린다", () => {
    const n = buildCauseNarrative(EV, { mock: true });
    const why = n.sections.find((s) => s.key === "why")!;
    const what = n.sections.find((s) => s.key === "what")!;
    const next = n.sections.find((s) => s.key === "next")!;
    expect(why.claims.length).toBeGreaterThan(0);
    expect(what.claims.length).toBeGreaterThan(0);
    expect(next.claims.length).toBeGreaterThan(0);
  });
});

describe("buildCauseNarrative — HARD grounding(인용 없는 claim 드롭)", () => {
  it("모든 표시 claim 은 최소 1개 인용을 갖는다(인용 없는 단정 금지)", () => {
    const n = buildCauseNarrative(EV, { mock: true });
    for (const sec of n.sections) {
      for (const c of sec.claims) {
        expect(c.citations.length).toBeGreaterThan(0);
      }
    }
  });

  it("인용 없는 EvidenceLine 은 드롭되고 droppedCount 로 집계된다", () => {
    // sourceRefs 를 인위로 비운 근거 줄 → 그 줄에서 파생되는 what/why/impact/next 4 claim 이 모두 드롭.
    const bad: IncidentEvidence = {
      objectId: "endpoint:x", found: true, objectType: "Endpoint", title: "X", status: "crit",
      lines: [{
        id: "k8sEvent:0", kind: "k8sEvent",
        signal: { what: "무근거 신호", when: "최근", sourceRef: "" },
        probableCause: "지어낸 원인", impact: "지어낸 영향", confidence: "med",
        sourceRefs: [], // ← 인용 없음.
      }],
      rootCauseSummary: "요약", confidence: "med", signalCount: 1, empty: false,
    };
    const n = buildCauseNarrative(bad, { mock: true });
    // what/impact/next 는 인용 없어 전부 드롭. why 는 rootCauseSummary(objectId 인용) 만 남는다.
    expect(n.sections.find((s) => s.key === "what")!.claims.length).toBe(0);
    expect(n.sections.find((s) => s.key === "impact")!.claims.length).toBe(0);
    expect(n.sections.find((s) => s.key === "next")!.claims.length).toBe(0);
    expect(n.droppedCount).toBeGreaterThan(0);
  });
});

describe("buildCauseNarrative — empty(환각 금지)", () => {
  it("근거 0(정상 객체/미지 객체) → empty=true + emptyReason, claim 0", () => {
    const evEmpty = buildIncidentEvidence("does-not-exist", SNAP);
    const n = buildCauseNarrative(evEmpty, { mock: true });
    expect(n.empty).toBe(true);
    expect(n.emptyReason).toBeTruthy();
    expect(n.sections.every((s) => s.claims.length === 0)).toBe(true);
  });
});

describe("buildCauseNarrative — mode 정직 표기", () => {
  it("mock=true → mode='rule-based' + source 에 'rule-based'/'mock'", () => {
    const n = buildCauseNarrative(EV, { mock: true });
    expect(n.mode).toBe("rule-based");
    expect(n.source.toLowerCase()).toContain("rule-based");
    expect(n.source.toLowerCase()).toContain("mock");
  });

  it("mock=false → mode='model'(실 연결 경로)", () => {
    const n = buildCauseNarrative(EV, { mock: false });
    expect(n.mode).toBe("model");
  });
});

describe("buildCauseNarrative — 결정성 & 인용 판별", () => {
  it("동일 (evidence, mock) → 동일 출력", () => {
    const a = buildCauseNarrative(EV, { mock: true });
    const b = buildCauseNarrative(EV, { mock: true });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("objectId(type:id) 인용은 클릭 대상, pod/… 는 텍스트(objectId=null)", () => {
    const n = buildCauseNarrative(EV, { mock: true });
    const allCites = n.sections.flatMap((s) => s.claims).flatMap((c) => c.citations);
    const obj = allCites.find((c) => c.ref === "endpoint:e-slow");
    const pod = allCites.find((c) => c.ref.startsWith("pod/"));
    expect(obj?.objectId).toBe("endpoint:e-slow");
    if (pod) expect(pod.objectId).toBeNull();
  });
});
