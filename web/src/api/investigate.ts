// IMP-58 — Troubleshooting COP(Common Operating Picture) 근본원인 경로 빌더 (순수 seam).
//
// "느린 Endpoint 하나에서 관계 그래프를 따라 원인 후보까지" 를 한 화면에서 답하기 위해,
// IMP-56 온톨로지(OntologyObject/OntologyLink)를 traverse 해 root-cause PATH 를 만든다.
// 새 데이터 모델을 발명하지 않는다 — 오직 기존 온톨로지 그래프만 따라간다(단일 출처).
//
// - 의존성 0개(프로젝트 ethos). 순수 함수만 두어 traverse·first-anomaly·blast-radius 를 단위 테스트로 가드.
// - 골든시그널·first-anomaly 시간은 seededSeries/hash 로 결정적 생성(mockFactory 재사용, 재현 가능).
// - Copy 는 "추정 근본원인 / 영향 경로" — 상관을 인과로 과장하지 않는다(Datadog Watchdog RCA 관례).

import type { LinkKind, ObjectStatus, OntologyLink, OntologyObject } from "./types";
import { hash, seededSeries, worstStatus } from "./mockFactory";
import { buildGraph, type OntologyGraph } from "./ontologyGraph";

// hop 카드가 보여줄 골든시그널 한 종. Grafana RCA Workbench 의 signal-per-hop 관례.
export interface GoldenSignal {
  key: "latency" | "error" | "util";
  label: string;
  valueText: string; // 표시 텍스트(단위 포함)
  value: number;     // Gauge value
  warn: number;      // Gauge/Sparkline 임계
  crit: number;
  series: number[];  // anomaly band(Sparkline) 시계열
}

// 경로의 한 hop. entry(진입)는 fromKind=null.
export interface Hop {
  id: string;                 // OntologyObject id
  object: OntologyObject;     // canonical(진입 스냅샷 — 드로어/ObjectView 진입점)
  fromKind: LinkKind | null;  // 이 hop 으로 들어온 링크 종류(null=진입). edge-type badge.
  signals: GoldenSignal[];    // 골든시그널(latency/error/util 중 type 별 큐레이션)
  status: ObjectStatus;       // 신호 파생 최악 상태(단일 출처 worstStatus)
  firstAnomalyIndex: number;  // 시계열 상 첫 이상 발생 index(-1=이상 없음) — 시간축 정렬 [a]
  firstAnomalyLabel: string;  // "12분 전" 등 사람용 badge
  critical: boolean;          // [b] 추정 근본원인(가장 이른 first-anomaly)
  blastRadius: boolean;       // [c] 조기 종결 방지로 추가된 hop
}

export interface RootCausePath {
  entryId: string;
  hops: Hop[];
  criticalId: string | null; // 추정 근본원인 hop id(없으면 null)
  found: boolean;            // 진입 Object 존재 여부(false=graceful 빈 경로)
}

// edge-type badge 라벨(affects→"impacts" 로 blast-radius 표기). 표시는 관계 이름만(과장 금지).
export const EDGE_BADGE: Record<LinkKind, string> = {
  serves: "serves",
  runsOn: "runsOn",
  hostedBy: "hostedBy",
  routedTo: "routedTo",
  executedOn: "executedOn",
  consumes: "consumes",
  affects: "impacts",
  routes: "routes", // IMP-89 — Endpoint→App
};

// 시계열 포인트 수·간격(결정적). now 의존이라 값만 재현되지만 first-anomaly index 는 안정.
const POINTS = 24;
const STEP_SEC = 60; // 24분 창

// 이상 판정 — higher-is-worse 값이 crit 임계를 처음 넘긴 index(-1=없음).
function firstAnomaly(series: number[], crit: number): number {
  for (let i = 0; i < series.length; i++) if (series[i] >= crit) return i;
  return -1;
}

// index → "N분 전"(가장 오래된=0, 최신=POINTS-1). 이상 없으면 "이상 없음".
function anomalyLabel(index: number): string {
  if (index < 0) return "이상 없음";
  const minsAgo = Math.round(((POINTS - 1 - index) * STEP_SEC) / 60);
  return minsAgo <= 0 ? "방금" : `${minsAgo}분 전`;
}

// 상태 파생 — 어떤 신호든 crit 이상 있으면 crit, warn 이상 있으면 warn.
// worstStatus 는 ok|warn|crit(NodeStatus)만 다루므로 신호 판정도 그 범위로 좁힌다(unknown 은 신호 없음).
function statusOf(signals: GoldenSignal[]): ObjectStatus {
  const per: ("ok" | "warn" | "crit")[] = signals.map((s) =>
    s.value >= s.crit ? "crit" : s.value >= s.warn ? "warn" : "ok",
  );
  return per.length ? worstStatus(per) : "unknown";
}

// Object type 별 골든시그널 큐레이션(latency/error/util). 값·시계열은 seededSeries 결정적.
// seedBias 를 더해 "경로 상류일수록 이상이 더 이르게" 나타나도록 결정적으로 기울인다.
function signalsFor(obj: OntologyObject, seedBias: number): GoldenSignal[] {
  const seed = hash(obj.id) ^ (seedBias * 0x9e37);
  // 상태가 나쁠수록(crit/warn) spike·base 를 키워 임계 초과가 더 이르게 발생.
  const sev = obj.status === "crit" ? 1 : obj.status === "warn" ? 0.6 : 0.25;
  const mk = (
    key: GoldenSignal["key"],
    label: string,
    unit: (v: number) => string,
    warn: number,
    crit: number,
    scale: number,
    opts: Parameters<typeof seededSeries>[3],
  ): GoldenSignal => {
    const raw = seededSeries(seed ^ hash(key), POINTS, STEP_SEC, opts);
    const series = raw.map((p) => +(p.value * scale).toFixed(3));
    const value = series[series.length - 1];
    return { key, label, valueText: unit(value), value, warn, crit, series };
  };

  switch (obj.type) {
    case "Endpoint":
    case "Service":
      return [
        mk("latency", "지연 p95", (v) => `${Math.round(v)}ms`, 800, 1500, 2200, { base: 0.25 + sev * 0.3, amp: 0.15, spike: sev * 0.7, drift: sev * 0.4 }),
        mk("error", "오류율", (v) => `${(v * 100).toFixed(1)}%`, 0.02, 0.05, 0.1, { base: 0.1 + sev * 0.3, amp: 0.1, spike: sev * 0.6, drift: sev * 0.3 }),
      ];
    case "Model":
      return [
        mk("latency", "TTFT p95", (v) => `${Math.round(v)}ms`, 600, 1200, 1800, { base: 0.25 + sev * 0.3, amp: 0.15, spike: sev * 0.6, drift: sev * 0.4 }),
      ];
    case "GpuDevice":
      return [
        mk("util", "GPU 사용률", (v) => `${Math.round(v * 100)}%`, 0.75, 0.9, 1, { base: 0.4 + sev * 0.35, amp: 0.12, spike: sev * 0.4, drift: sev * 0.25 }),
      ];
    case "Node":
      return [
        mk("util", "CPU 사용률", (v) => `${Math.round(v * 100)}%`, 0.75, 0.9, 1, { base: 0.35 + sev * 0.35, amp: 0.12, spike: sev * 0.4, drift: sev * 0.25 }),
        mk("error", "네트워크 오류", (v) => `${(v * 40).toFixed(1)}/s`, 0.125, 0.5, 1, { base: 0.05 + sev * 0.25, amp: 0.08, spike: sev * 0.5 }),
      ];
    default:
      // Trace/Incident 등 — 대표 지연 신호 하나.
      return [
        mk("latency", "지연", (v) => `${Math.round(v)}ms`, 800, 1500, 2200, { base: 0.3 + sev * 0.3, amp: 0.15, spike: sev * 0.5 }),
      ];
  }
}

// out-link 우선 매칭 — head 를 from 으로 갖는 첫 링크(kind 우선순). 없으면 in-link 로.
// 후보 = head 의 미방문 이웃으로 가는 링크(양방향). 그래프(IMP-66) out/in 링크로 수집.
function nextLink(head: string, graph: OntologyGraph, visited: Set<string>, prefer: LinkKind[]): OntologyLink | null {
  const cands = [
    ...graph.outLinks(head).filter((l) => !visited.has(l.to)),
    ...graph.inLinks(head).filter((l) => !visited.has(l.from)),
  ];
  if (!cands.length) return null;
  // prefer 순으로 결정적 선택 → 없으면 첫 후보(id 정렬로 안정).
  for (const k of prefer) {
    const hit = cands.filter((l) => l.linkKind === k).sort(sortLink)[0];
    if (hit) return hit;
  }
  return cands.sort(sortLink)[0];
}

function sortLink(a: OntologyLink, b: OntologyLink): number {
  return `${a.from}|${a.to}|${a.linkKind}` < `${b.from}|${b.to}|${b.linkKind}` ? -1 : 1;
}

// 척추 경로 우선순: Endpoint→serves Model→runsOn GpuDevice→hostedBy Node.
const SPINE: LinkKind[] = ["serves", "runsOn", "hostedBy", "consumes", "routedTo", "executedOn", "affects"];

// buildRootCausePath — entryId 에서 시작해 온톨로지 링크를 따라 근본원인 경로를 만든다(순수).
//   objects/links: IMP-56 온톨로지(client 로 fetch). entryId: 진입 Object id.
//   Incident 진입이면 affects 대상(Endpoint 등)으로 한 hop 접합해 척추에 올린다.
export function buildRootCausePath(objects: OntologyObject[], links: OntologyLink[], entryId: string): RootCausePath {
  // 온톨로지 그래프(IMP-66) — id 조회·이웃/링크 traverse 를 단일 primitive 로.
  const graph = buildGraph(objects, links);
  const entry = entryId ? graph.object(entryId) : undefined;
  if (!entry) return { entryId, hops: [], criticalId: null, found: false };

  const chain: { obj: OntologyObject; fromKind: LinkKind | null }[] = [{ obj: entry, fromKind: null }];
  const visited = new Set<string>([entry.id]);
  let head = entry.id;

  // 척추를 최대 5 hop 확장(Node 까지). 각 스텝은 결정적(nextLink).
  for (let step = 0; step < 5; step++) {
    const link = nextLink(head, graph, visited, SPINE);
    if (!link) break;
    const nextId = link.from === head ? link.to : link.from;
    const nextObj = graph.object(nextId);
    if (!nextObj) break;
    chain.push({ obj: nextObj, fromKind: link.linkKind });
    visited.add(nextId);
    head = nextId;
    if (nextObj.type === "Node") break; // 척추 종점 — 이후는 blast-radius 로만.
  }

  // hop 생성 + 골든시그널 + first-anomaly. seedBias=상류일수록 커져 이상이 더 이르게.
  const hops: Hop[] = chain.map((c, i) => {
    const signals = signalsFor(c.obj, chain.length - i);
    // 각 신호의 첫 이상 index 중 가장 이른 것(가장 먼저 무너진 신호).
    const idxs = signals.map((s) => firstAnomaly(s.series, s.crit)).filter((x) => x >= 0);
    const firstAnomalyIndex = idxs.length ? Math.min(...idxs) : -1;
    return {
      id: c.obj.id,
      object: c.obj,
      fromKind: c.fromKind,
      signals,
      status: statusOf(signals),
      firstAnomalyIndex,
      firstAnomalyLabel: anomalyLabel(firstAnomalyIndex),
      critical: false,
      blastRadius: false,
    };
  });

  // [b] 추정 근본원인 — 이상 있는 hop 중 first-anomaly 가 가장 이른(index 최소) hop.
  let criticalId: string | null = null;
  let critHopPos = -1;
  let best = Infinity;
  hops.forEach((h, i) => {
    if (h.firstAnomalyIndex >= 0 && h.firstAnomalyIndex < best) {
      best = h.firstAnomalyIndex;
      criticalId = h.id;
      critHopPos = i;
    }
  });
  if (criticalId) hops[critHopPos].critical = true;

  // [c] 조기 종결 방지 — 첫 임계 hop 이후 한 hop 더 확장(blast-radius).
  //   우선: 척추 종점(Node)의 다른 영향 Service(같은 Node 에 hostedBy 된 GPU 를 runsOn 하는 Model 의 Service).
  //   대안: 임계 hop 의 아직 안 밟은 상류/이웃(affects 등).
  const extra = pickBlastRadius(chain[chain.length - 1].obj, criticalId, graph, visited);
  if (extra) {
    const signals = signalsFor(extra.obj, 0);
    const idxs = signals.map((s) => firstAnomaly(s.series, s.crit)).filter((x) => x >= 0);
    const firstAnomalyIndex = idxs.length ? Math.min(...idxs) : -1;
    hops.push({
      id: extra.obj.id,
      object: extra.obj,
      fromKind: extra.fromKind,
      signals,
      status: statusOf(signals),
      firstAnomalyIndex,
      firstAnomalyLabel: anomalyLabel(firstAnomalyIndex),
      critical: false,
      blastRadius: true,
    });
  }

  return { entryId, hops, criticalId, found: true };
}

// blast-radius 후보 1개 — 척추 종점(tail)의 이웃 중 아직 안 밟은 Service/Endpoint(같은 Node 의 다른 영향).
// 없으면 임계 hop 의 미방문 이웃 아무거나(affects 등). 결정적(id 정렬).
function pickBlastRadius(
  tail: OntologyObject,
  criticalId: string | null,
  graph: OntologyGraph,
  visited: Set<string>,
): { obj: OntologyObject; fromKind: LinkKind } | null {
  const tryFrom = (nodeId: string, wantTypes: OntologyObject["type"][]): { obj: OntologyObject; fromKind: LinkKind } | null => {
    // nodeId 의 양방향 이웃(out=to, in=from) + 그 링크 kind. 그래프(IMP-66)로 수집.
    const neigh = [
      ...graph.outLinks(nodeId).map((l) => ({ id: l.to, kind: l.linkKind })),
      ...graph.inLinks(nodeId).map((l) => ({ id: l.from, kind: l.linkKind })),
    ]
      .filter((n) => !visited.has(n.id) && graph.has(n.id))
      .filter((n) => wantTypes.includes(graph.object(n.id)!.type))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const pick = neigh[0];
    return pick ? { obj: graph.object(pick.id)!, fromKind: pick.kind } : null;
  };
  // 1) tail(Node/GPU 등)의 다른 영향 Service/Endpoint.
  const same = tryFrom(tail.id, ["Service", "Endpoint"]);
  if (same) return same;
  // 2) 임계 hop 의 미방문 이웃(상류 포함).
  if (criticalId) {
    const up = tryFrom(criticalId, ["Service", "Endpoint", "Model", "GpuDevice", "Node", "Incident"]);
    if (up) return up;
  }
  // 3) tail 의 미방문 이웃 아무거나(고립 방지).
  return tryFrom(tail.id, ["Service", "Endpoint", "Model", "GpuDevice", "Node", "Incident"]);
}

// 진입 후보 — 문제 Endpoint(미준비/이상) + triggered Incident 를 통증순 정렬(결정적).
export interface EntryCandidate {
  id: string;
  title: string;
  type: OntologyObject["type"];
  status: ObjectStatus;
  reason: string; // 후보로 뽑힌 이유(사람용, 이스케이프 렌더)
}

const SEV_RANK: Record<ObjectStatus, number> = { crit: 0, warn: 1, unknown: 2, ok: 3 };

export function pickEntryCandidates(objects: OntologyObject[]): EntryCandidate[] {
  const cands: EntryCandidate[] = [];
  for (const o of objects) {
    if (o.type === "Endpoint") {
      const ready = o.props?.ready;
      const reason = ready === false ? "엔드포인트 NotReady — 기동 실패 의심" : o.status !== "ok" ? "엔드포인트 상태 이상" : "정상 엔드포인트(참고 진입)";
      cands.push({ id: o.id, title: o.title, type: o.type, status: o.status, reason });
    } else if (o.type === "Incident") {
      cands.push({ id: o.id, title: o.title, type: o.type, status: o.status, reason: "발생 인시던트 — 영향 경로 추적" });
    }
  }
  // 통증 우선(crit→warn→…), 동순위는 Incident 우선 후 id 정렬(결정적).
  return cands.sort((a, b) => {
    if (SEV_RANK[a.status] !== SEV_RANK[b.status]) return SEV_RANK[a.status] - SEV_RANK[b.status];
    if (a.type !== b.type) return a.type === "Incident" ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

// 기본 진입 — 후보 리스트 1위(가장 아픈 것). 없으면 첫 Endpoint, 그것도 없으면 첫 Object.
export function defaultEntry(objects: OntologyObject[]): string | null {
  const cands = pickEntryCandidates(objects);
  if (cands.length) return cands[0].id;
  const ep = objects.find((o) => o.type === "Endpoint");
  return ep?.id ?? objects[0]?.id ?? null;
}
