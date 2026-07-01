// IMP-58 — Troubleshooting COP 근본원인 경로 빌더(순수) 테스트.
// buildRootCausePath / pickEntryCandidates / defaultEntry 를 결정적 픽스처로 가드한다(백엔드 0개).
// 케이스: normal(자동확장·골든시그널·임계·blast) / retry(결정성) / failure(미지 entity) / bad-input(고립·빈).
import { describe, it, expect } from "vitest";
import {
  buildRootCausePath,
  pickEntryCandidates,
  defaultEntry,
  EDGE_BADGE,
} from "./investigate";
import type { OntologyLink, OntologyObject } from "./types";

// 척추 그래프: endpoint:e-slow --serves--> model:m --runsOn--> gpu:g --hostedBy--> node:n.
// node:n 에는 다른 영향 Service(service:other)가 hostedBy 로 붙어 blast-radius 를 만든다.
// endpoint:e-slow 는 crit(느림), 나머지는 warn/ok 로 섞어 first-anomaly 순서를 만든다.
const OBJECTS: OntologyObject[] = [
  { id: "endpoint:e-slow", type: "Endpoint", title: "느린 EP", props: { ready: false, namespace: "prod" }, status: "crit", revision: 1 },
  { id: "endpoint:e-ok", type: "Endpoint", title: "정상 EP", props: { ready: true }, status: "ok", revision: 1 },
  { id: "model:m", type: "Model", title: "모델 M", props: { replicas: 2 }, status: "warn", revision: 1 },
  { id: "gpu:g", type: "GpuDevice", title: "GPU 0", props: { util_perc: 0.95 }, status: "crit", revision: 1 },
  { id: "node:n", type: "Node", title: "노드 N", props: { cpu_util: 0.8 }, status: "warn", revision: 1 },
  { id: "service:other", type: "Service", title: "다른 서비스", props: { qps: 12, error_rate: 0.03 }, status: "warn", revision: 1 },
  { id: "incident:i1", type: "Incident", title: "지연 급증 인시던트", props: { severity: "critical", state: "triggered" }, status: "crit", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "endpoint:e-slow", to: "model:m", linkKind: "serves" },
  { from: "model:m", to: "gpu:g", linkKind: "runsOn" },
  { from: "gpu:g", to: "node:n", linkKind: "hostedBy" },
  { from: "service:other", to: "node:n", linkKind: "hostedBy" }, // blast-radius 원천(같은 노드의 다른 서비스)
  { from: "incident:i1", to: "endpoint:e-slow", linkKind: "affects" },
];

describe("buildRootCausePath — normal(자동확장 척추 + 골든시그널)", () => {
  it("Endpoint 진입에서 serves→runsOn→hostedBy 로 Node 까지 자동 확장한다", () => {
    const path = buildRootCausePath(OBJECTS, LINKS, "endpoint:e-slow");
    expect(path.found).toBe(true);
    const ids = path.hops.map((h) => h.id);
    // 척추: endpoint → model → gpu → node (+ blast-radius 1 hop).
    expect(ids.slice(0, 4)).toEqual(["endpoint:e-slow", "model:m", "gpu:g", "node:n"]);
    // 각 hop 은 최소 1개 골든시그널.
    for (const h of path.hops) expect(h.signals.length).toBeGreaterThan(0);
    // edge-type badge: 진입은 null, 이후는 관계 종류.
    expect(path.hops[0].fromKind).toBeNull();
    expect(path.hops[1].fromKind).toBe("serves");
    expect(path.hops[2].fromKind).toBe("runsOn");
    expect(path.hops[3].fromKind).toBe("hostedBy");
  });

  it("[b] 추정 근본원인 hop 이 정확히 하나 지정된다(가장 이른 first-anomaly)", () => {
    const path = buildRootCausePath(OBJECTS, LINKS, "endpoint:e-slow");
    const crits = path.hops.filter((h) => h.critical);
    expect(crits.length).toBe(1);
    expect(path.criticalId).toBe(crits[0].id);
    // 임계 hop 은 이상이 관측된 hop(index>=0).
    expect(crits[0].firstAnomalyIndex).toBeGreaterThanOrEqual(0);
  });

  it("[c] blast-radius hop 이 척추 종점(Node) 이후 한 개 더 붙는다(같은 노드의 다른 서비스)", () => {
    const path = buildRootCausePath(OBJECTS, LINKS, "endpoint:e-slow");
    const blast = path.hops.filter((h) => h.blastRadius);
    expect(blast.length).toBe(1);
    expect(blast[0].id).toBe("service:other");
    // blast-radius 는 경로 마지막에 온다.
    expect(path.hops[path.hops.length - 1].blastRadius).toBe(true);
  });

  it("[a] 시간축 — 각 hop 에 first-anomaly 라벨이 있고, 이상 없으면 '이상 없음'", () => {
    const path = buildRootCausePath(OBJECTS, LINKS, "endpoint:e-slow");
    for (const h of path.hops) {
      expect(typeof h.firstAnomalyLabel).toBe("string");
      expect(h.firstAnomalyLabel.length).toBeGreaterThan(0);
      if (h.firstAnomalyIndex < 0) expect(h.firstAnomalyLabel).toBe("이상 없음");
    }
  });

  it("EDGE_BADGE 는 affects 를 impacts 로 표기(과장 금지 라벨)", () => {
    expect(EDGE_BADGE.affects).toBe("impacts");
    expect(EDGE_BADGE.serves).toBe("serves");
    expect(EDGE_BADGE.hostedBy).toBe("hostedBy");
  });

  it("Incident 진입도 affects 대상으로 접합해 척추에 올린다", () => {
    const path = buildRootCausePath(OBJECTS, LINKS, "incident:i1");
    expect(path.found).toBe(true);
    const ids = path.hops.map((h) => h.id);
    expect(ids[0]).toBe("incident:i1");
    // affects 로 endpoint:e-slow 에 접합 → 이후 척추.
    expect(ids).toContain("endpoint:e-slow");
    expect(ids).toContain("node:n");
  });
});

describe("buildRootCausePath — retry(결정성)", () => {
  it("같은 entryId 재빌드 시 동일한 hop id 순서 + 동일 first-anomaly index", () => {
    const a = buildRootCausePath(OBJECTS, LINKS, "endpoint:e-slow");
    const b = buildRootCausePath(OBJECTS, LINKS, "endpoint:e-slow");
    expect(a.hops.map((h) => h.id)).toEqual(b.hops.map((h) => h.id));
    expect(a.hops.map((h) => h.firstAnomalyIndex)).toEqual(b.hops.map((h) => h.firstAnomalyIndex));
    expect(a.criticalId).toBe(b.criticalId);
    // 골든시그널 값(마지막 포인트)도 재현.
    expect(a.hops.map((h) => h.signals.map((s) => s.value))).toEqual(b.hops.map((h) => h.signals.map((s) => s.value)));
  });
});

describe("buildRootCausePath — failure / bad-input", () => {
  it("failure: 알 수 없는 entity → found=false, hops 비어있음(throw 없음)", () => {
    const path = buildRootCausePath(OBJECTS, LINKS, "endpoint:nope");
    expect(path.found).toBe(false);
    expect(path.hops.length).toBe(0);
    expect(path.criticalId).toBeNull();
  });

  it("bad-input: entryId 빈 문자열 → found=false", () => {
    const path = buildRootCausePath(OBJECTS, LINKS, "");
    expect(path.found).toBe(false);
  });

  it("bad-input: 고립 Object(링크 없음) → 단일 hop(진입만), blast-radius 없음", () => {
    const iso: OntologyObject = { id: "endpoint:iso", type: "Endpoint", title: "고립 EP", props: { ready: true }, status: "ok", revision: 1 };
    const path = buildRootCausePath([iso], [], "endpoint:iso");
    expect(path.found).toBe(true);
    expect(path.hops.length).toBe(1);
    expect(path.hops[0].id).toBe("endpoint:iso");
    expect(path.hops.some((h) => h.blastRadius)).toBe(false);
  });
});

describe("pickEntryCandidates / defaultEntry", () => {
  it("Endpoint + Incident 만 후보로, 통증(crit) 우선 정렬", () => {
    const cands = pickEntryCandidates(OBJECTS);
    const ids = cands.map((c) => c.id);
    // Model/GpuDevice/Node/Service 는 후보 아님.
    expect(ids).not.toContain("model:m");
    expect(ids).not.toContain("gpu:g");
    expect(ids).not.toContain("node:n");
    expect(ids).not.toContain("service:other");
    // 후보는 Endpoint 2개 + Incident 1개.
    expect(cands.length).toBe(3);
    // 통증 우선 — 첫 후보는 crit 상태(느린 EP 또는 인시던트).
    expect(cands[0].status).toBe("crit");
    // NotReady Endpoint 는 기동 실패 사유.
    const slow = cands.find((c) => c.id === "endpoint:e-slow");
    expect(slow?.reason).toMatch(/NotReady|기동 실패/);
  });

  it("defaultEntry 는 후보 1위(가장 아픈 것)", () => {
    const d = defaultEntry(OBJECTS);
    const cands = pickEntryCandidates(OBJECTS);
    expect(d).toBe(cands[0].id);
  });

  it("defaultEntry: 후보 없으면 첫 Endpoint, 그것도 없으면 첫 Object", () => {
    const onlyModel: OntologyObject = { id: "model:x", type: "Model", title: "M", props: {}, status: "ok", revision: 1 };
    expect(defaultEntry([onlyModel])).toBe("model:x");
    expect(defaultEntry([])).toBeNull();
  });
});
