// IMP-99 — 근거 파생 단일 seam buildIncidentEvidence(순수·결정적) 테스트.
// 케이스: 결정성 / 신호→추정원인→영향 구조 / 정렬(first-anomaly 상단) / confidence(≥2=high) /
//         K8s 상관(OOM pod+event) / empty-state "수집된 이벤트 없음"(환각 금지) / 직렬화 round-trip.
import { describe, it, expect } from "vitest";
import { buildIncidentEvidence, type IncidentSnapshot } from "./incidentEvidence";
import type { K8sSnapshot, OntologyLink, OntologyObject } from "./types";

// 척추: endpoint --serves--> model --runsOn--> gpu --hostedBy--> node. gpu/node crit → 신호 실림.
const OBJECTS: OntologyObject[] = [
  { id: "endpoint:e-slow", type: "Endpoint", title: "느린 EP", props: { ready: false, replicas: 2, namespace: "fabrix" }, status: "crit", revision: 1 },
  { id: "model:m", type: "Model", title: "모델 M", props: { replicas: 2 }, status: "warn", revision: 1 },
  { id: "gpu:g", type: "GpuDevice", title: "GPU 0", props: { util_perc: 0.97, mem_perc: 0.93, throttle: "열(HW Thermal Slowdown)" }, status: "crit", revision: 1 },
  { id: "node:n", type: "Node", title: "노드 N", props: { hostname: "n0", cpu_util: 0.94, net_err_per_s: 12 }, status: "crit", revision: 1 },
  { id: "gpu:ok", type: "GpuDevice", title: "정상 GPU", props: { util_perc: 0.4, mem_perc: 0.3, throttle: "제약 없음" }, status: "ok", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "endpoint:e-slow", to: "model:m", linkKind: "serves" },
  { from: "model:m", to: "gpu:g", linkKind: "runsOn" },
  { from: "gpu:g", to: "node:n", linkKind: "hostedBy" },
];

// K8s 상관 — 느린 EP 에 OOMKilled 파드 + OOMKilling 이벤트 + stalled 배포.
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

describe("buildIncidentEvidence — 결정성", () => {
  it("동일 (objectId, snapshot) → 동일 출력(Date.now 미의존)", () => {
    const a = buildIncidentEvidence("gpu:g", SNAP);
    const b = buildIncidentEvidence("gpu:g", SNAP);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe("buildIncidentEvidence — 신호→추정원인→영향 구조", () => {
  it("각 줄이 signal/probableCause/impact/confidence/sourceRefs 를 갖고 rootCauseSummary 존재", () => {
    const ev = buildIncidentEvidence("gpu:g", SNAP);
    expect(ev.found).toBe(true);
    expect(ev.empty).toBe(false);
    expect(ev.lines.length).toBeGreaterThan(0);
    expect(ev.rootCauseSummary).toBeTruthy();
    for (const l of ev.lines) {
      expect(l.signal.what).toBeTruthy();
      expect(l.signal.when).toBeTruthy();
      expect(l.signal.sourceRef).toBeTruthy();
      expect(l.probableCause).toBeTruthy();
      expect(l.impact).toBeTruthy();
      expect(["high", "med"]).toContain(l.confidence);
      expect(l.sourceRefs.length).toBeGreaterThan(0);
    }
  });
});

describe("buildIncidentEvidence — 정렬(first-anomaly 상단)", () => {
  it("firstAnomaly 근거 줄이 있으면 최상단(시간축 앵커)", () => {
    const ev = buildIncidentEvidence("gpu:g", SNAP);
    const idx = ev.lines.findIndex((l) => l.kind === "firstAnomaly");
    if (idx >= 0) expect(idx).toBe(0);
  });
});

describe("buildIncidentEvidence — confidence 규약(≥2 상관 신호 = high)", () => {
  it("상관 신호 ≥2 → high (detection 규약 동형)", () => {
    const ev = buildIncidentEvidence("gpu:g", SNAP); // throttle + saturation(+firstAnomaly) ≥ 2
    expect(ev.signalCount).toBeGreaterThanOrEqual(2);
    expect(ev.confidence).toBe("high");
    expect(ev.lines.every((l) => l.confidence === "high")).toBe(true);
  });

  it("상관 신호 1개 → med", () => {
    // idle GPU 하나만 신호가 실리도록: util 낮고 mem 점유(유휴 할당 갭) 단독, first-anomaly 미도달(고립).
    const solo: OntologyObject[] = [
      { id: "gpu:idle", type: "GpuDevice", title: "유휴 GPU", props: { util_perc: 0.05, mem_perc: 0.8, throttle: "제약 없음" }, status: "warn", revision: 1 },
    ];
    const ev = buildIncidentEvidence("gpu:idle", { objects: solo, links: [] });
    expect(ev.signalCount).toBe(1);
    expect(ev.confidence).toBe("med");
  });
});

describe("buildIncidentEvidence — K8s 상관", () => {
  it("OOMKilled 파드 + OOMKilling 이벤트가 근거 줄로 들어오고 sourceRefs 에 pod/event ref 포함", () => {
    const ev = buildIncidentEvidence("endpoint:e-slow", SNAP);
    const refs = ev.lines.flatMap((l) => l.sourceRefs);
    expect(refs).toContain("pod/e-slow-abc");
    expect(ev.lines.some((l) => l.kind === "k8sEvent")).toBe(true);
    expect(ev.lines.some((l) => l.kind === "k8sPod")).toBe(true);
    // 정상 파드(e-slow-def)는 노이즈로 제외.
    expect(refs).not.toContain("pod/e-slow-def");
    // 미완료 rollout(progressing) 배포 근거 포함.
    expect(ev.lines.some((l) => l.kind === "k8sDeployment")).toBe(true);
  });

  it("k8s 미제공(undefined)이어도 감지 신호만으로 graceful 조립", () => {
    const ev = buildIncidentEvidence("gpu:g", { objects: OBJECTS, links: LINKS });
    expect(ev.found).toBe(true);
    expect(ev.lines.every((l) => l.kind !== "k8sPod" && l.kind !== "k8sEvent")).toBe(true);
  });
});

describe("buildIncidentEvidence — empty-state(환각 금지)", () => {
  it("상관 근거 0 → empty=true, emptyReason='수집된 이벤트 없음', lines=[]", () => {
    const okObjs: OntologyObject[] = [
      { id: "gpu:ok", type: "GpuDevice", title: "정상 GPU", props: { util_perc: 0.4, mem_perc: 0.3, throttle: "제약 없음" }, status: "ok", revision: 1 },
    ];
    const ev = buildIncidentEvidence("gpu:ok", { objects: okObjs, links: [] });
    expect(ev.empty).toBe(true);
    expect(ev.emptyReason).toBe("수집된 이벤트 없음");
    expect(ev.lines).toEqual([]);
  });

  it("미지 objectId → found=false + empty(throw 없음)", () => {
    const ev = buildIncidentEvidence("no:such", SNAP);
    expect(ev.found).toBe(false);
    expect(ev.empty).toBe(true);
    expect(ev.emptyReason).toBe("수집된 이벤트 없음");
  });
});

describe("buildIncidentEvidence — 직렬화(MCP 반환 가능)", () => {
  it("JSON round-trip 동일(원시값/배열/객체만)", () => {
    const ev = buildIncidentEvidence("endpoint:e-slow", SNAP);
    const round = JSON.parse(JSON.stringify(ev));
    expect(round).toEqual(ev);
  });
});
