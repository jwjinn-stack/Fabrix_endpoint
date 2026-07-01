// 토폴로지·노드·네트워크 mock 공통 팩토리 (IMP-55).
//
// mock.ts 가 화면 3세트(토폴로지 그래프·노드 골든시그널·네트워크 링크)를 추가할 때
// 시계열 생성·시드·임계 로직이 또 중복되지 않도록 순수 헬퍼를 한 곳에 모은다(IMP-7 임계 중복 전례).
// 순수 함수만 두어(윈도우/시각 의존 최소화) 시드 재현성·임계 경계를 단위 테스트로 가드한다.
//
// - 의존성 0개(프로젝트 ethos). seed/hash 관례는 mock.ts 와 동일한 mulberry32 + FNV-1a.
// - 임계 상태 파생은 statusFromThresholds 단일 출처(GPU tempColor/utilCellColor/gpuStatus 와 통일).

import type {
  NetworkLink, NetworkPoint, NodeMetrics, NodePoint, NodeStatus,
  TopologyEdge, TopologyGraph, TopologyNode,
} from "./types";

// ───────────────────────── 결정적 난수 (mock.ts 와 동일 관례) ─────────────────────────
// mulberry32 — seed 하나로 결정적 스트림. 같은 seed → 같은 값.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// FNV-1a — 문자열 → 32bit seed.
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ───────────────────────── 임계 상태 파생 (단일 출처) ─────────────────────────
export type ThresholdStatus = NodeStatus; // "ok" | "warn" | "crit"

// value 를 warn/crit 임계와 비교해 상태를 파생한다. GPU gpuStatus/tempColor 와 동일 규약:
// - higher-is-worse(warn < crit): value >= crit → crit, value >= warn → warn, else ok.
// - lower-is-worse(warn > crit): value <= crit → crit, value <= warn → warn, else ok.
// 경계는 "임계 이상/이하 포함"(>=, <=) — gpuStatus 의 `>=` 관례와 일치.
export function statusFromThresholds(value: number, warn: number, crit: number): ThresholdStatus {
  if (warn <= crit) {
    // higher-is-worse
    if (value >= crit) return "crit";
    if (value >= warn) return "warn";
    return "ok";
  }
  // lower-is-worse (예: 캐시 적중률·가용 대역)
  if (value <= crit) return "crit";
  if (value <= warn) return "warn";
  return "ok";
}

// 여러 상태 중 최악을 고른다(노드/링크 롤업용).
export function worstStatus(statuses: ThresholdStatus[]): ThresholdStatus {
  if (statuses.includes("crit")) return "crit";
  if (statuses.includes("warn")) return "warn";
  return "ok";
}

// ───────────────────────── 결정적 시계열 생성기 ─────────────────────────
export interface SeriesOpts {
  base?: number;   // 중심값(기본 0.5)
  amp?: number;    // 사인 진폭(기본 0.2)
  drift?: number;  // 전체 구간에 걸친 선형 추세(기본 0 — 끝점에서 +drift)
  spike?: number;  // 무작위 스파이크 최대 가산량(기본 0 — 없음)
  min?: number;    // 클램프 하한(기본 0)
  max?: number;    // 클램프 상한(기본 1)
  jitter?: number; // 포인트별 무작위 흔들림(기본 0.08)
}
export interface SeriesPoint { ts: string; value: number; }

// 결정적 시드 기반 시계열. now 기준 뒤로 points 개, stepSec 간격(오래된 → 최신 순).
// 같은 (seed, points, stepSec, opts) → 같은 value 배열(ts 는 now 의존이라 값만 재현 보장).
export function seededSeries(seed: number, points: number, stepSec: number, opts: SeriesOpts = {}): SeriesPoint[] {
  const { base = 0.5, amp = 0.2, drift = 0, spike = 0, min = 0, max = 1, jitter = 0.08 } = opts;
  const r = rng(seed >>> 0);
  const now = Date.now();
  const out: SeriesPoint[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const idx = points - 1 - i; // 0 = 가장 오래됨
    const phase = (idx / Math.max(1, points - 1)) * Math.PI * 2;
    const trend = points > 1 ? (idx / (points - 1)) * drift : 0;
    const wave = Math.sin(phase) * amp;
    const noise = (r() - 0.5) * jitter;
    const spikeAdd = spike > 0 && r() > 0.9 ? r() * spike : 0;
    const value = clamp(base + wave + trend + noise + spikeAdd, min, max);
    out.push({ ts: new Date(now - i * stepSec * 1000).toISOString(), value: +value.toFixed(4) });
  }
  return out;
}

// ───────────────────────── 그래프 빌더 ─────────────────────────
// 서버(GPU 노드 호스트) → 서비스(엔드포인트) → GPU(디바이스) 계층 그래프를 결정적으로 만든다.
// 후속 화면(IMP-45 토폴로지)이 소비. nodes/edges 수·id 는 seed 결정적.
const TOPO_HOSTS = ["gpu-node-01", "gpu-node-02", "gpu-node-03"];
const TOPO_SERVICES = [
  { id: "gemma-3-27b-it", label: "Gemma 3 27B", host: "gpu-node-01" },
  { id: "qwen3-32b-router", label: "Qwen3 32B", host: "gpu-node-02" },
  { id: "llama-33-70b", label: "Llama 3.3 70B", host: "gpu-node-03" },
];

export function buildTopology(seed: number): TopologyGraph {
  const r = rng(seed >>> 0);
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // 서버 노드 + 각 서버당 2 GPU 디바이스.
  for (const host of TOPO_HOSTS) {
    const util = +(0.3 + rng(hash(host + ":srv"))() * 0.65).toFixed(3);
    nodes.push({
      id: host, kind: "server", label: host,
      status: statusFromThresholds(util, 0.75, 0.9),
      metrics: { cpu_util: util },
    });
    for (let g = 0; g < 2; g++) {
      const gr = rng(hash(`${host}:gpu${g}`));
      const gutil = +(gr() * 0.98).toFixed(3);
      const temp = Math.round(50 + gutil * 40);
      const gid = `${host}/gpu${g}`;
      nodes.push({
        id: gid, kind: "gpu", label: `${host} GPU${g}`,
        // 온도·사용률 각각 임계 파생 후 최악을 취함(gpuStatus 규약과 통일).
        status: worstStatus([
          statusFromThresholds(temp, 80, 87),
          statusFromThresholds(gutil, 0.6, 0.9),
        ]),
        metrics: { util_perc: gutil, temp_c: temp },
      });
      edges.push({ from: host, to: gid });
    }
  }

  // 서비스 노드 + 서비스→호스트 배치 엣지 + 서비스 간 호출 흐름 엣지.
  for (const svc of TOPO_SERVICES) {
    const qps = +(4 + r() * 40).toFixed(1);
    const err = +(r() * 0.06).toFixed(4);
    nodes.push({
      id: svc.id, kind: "service", label: svc.label,
      status: statusFromThresholds(err, 0.02, 0.05),
      metrics: { qps, error_rate: err },
    });
    edges.push({ from: svc.id, to: svc.host, qps, error_rate: err });
  }
  // RAG 서비스 체인(qwen → llama)을 하나 둔다(서비스 간 흐름 예시).
  edges.push({
    from: "qwen3-32b-router", to: "llama-33-70b",
    qps: +(2 + r() * 8).toFixed(1), error_rate: +(r() * 0.03).toFixed(4),
  });

  return { generated_at: new Date().toISOString(), nodes, edges, source: "topology (mock)" };
}

// ───────────────────────── 노드 골든시그널(USE) 생성기 ─────────────────────────
// host 별 USE 세트 시계열. utilization/saturation/errors/traffic 을 seededSeries 로 결정적 생성.
export function buildNodeMetrics(host: string, points: number, stepSec: number): NodeMetrics {
  const h = hash(host);
  const cpu = seededSeries(h ^ 0x1111, points, stepSec, { base: 0.45, amp: 0.22, spike: 0.3, max: 1 });
  const mem = seededSeries(h ^ 0x2222, points, stepSec, { base: 0.6, amp: 0.12, drift: 0.1 });
  const disk = seededSeries(h ^ 0x3333, points, stepSec, { base: 0.4, amp: 0.08 });
  const swap = seededSeries(h ^ 0x4444, points, stepSec, { base: 0.05, amp: 0.03, max: 1 });
  const dio = seededSeries(h ^ 0x5555, points, stepSec, { base: 0.35, amp: 0.25, spike: 0.4 });
  const rx = seededSeries(h ^ 0x6666, points, stepSec, { base: 0.5, amp: 0.3, min: 0, max: 1 });
  const tx = seededSeries(h ^ 0x7777, points, stepSec, { base: 0.4, amp: 0.28, min: 0, max: 1 });
  const err = seededSeries(h ^ 0x8888, points, stepSec, { base: 0.02, amp: 0.02, spike: 0.5, max: 1 });
  const load = seededSeries(h ^ 0x9999, points, stepSec, { base: 0.3, amp: 0.2, spike: 0.6, max: 1 });

  const pts: NodePoint[] = cpu.map((c, i) => ({
    ts: c.ts,
    cpu_util: c.value,
    mem_util: mem[i].value,
    disk_util: disk[i].value,
    load1: +(load[i].value * 16).toFixed(2), // 16코어 가정 → load 절대값
    swap_used_perc: swap[i].value,
    disk_io_perc: dio[i].value,
    net_rx_mbps: +(rx[i].value * 2000).toFixed(1),
    net_tx_mbps: +(tx[i].value * 2000).toFixed(1),
    net_err_per_s: +(err[i].value * 40).toFixed(2),
  }));
  const last = pts[pts.length - 1];
  const status = last
    ? worstStatus([
        statusFromThresholds(last.cpu_util, 0.8, 0.95),
        statusFromThresholds(last.mem_util, 0.85, 0.95),
        statusFromThresholds(last.swap_used_perc, 0.2, 0.5),
        statusFromThresholds(last.net_err_per_s, 5, 20),
      ])
    : "ok";
  return { generated_at: new Date().toISOString(), host, status, points: pts, source: "node-exporter (mock)" };
}

// ───────────────────────── 네트워크 링크 생성기 ─────────────────────────
const NET_LINKS = [
  { id: "link-spine-01", from: "gpu-node-01", to: "spine-switch", cap: 100000 },
  { id: "link-spine-02", from: "gpu-node-02", to: "spine-switch", cap: 100000 },
  { id: "link-spine-03", from: "gpu-node-03", to: "spine-switch", cap: 100000 },
  { id: "link-uplink", from: "spine-switch", to: "core-router", cap: 200000 },
];

export function buildNetwork(points: number, stepSec: number): NetworkLink[] {
  return NET_LINKS.map((l) => {
    const h = hash(l.id);
    const rx = seededSeries(h ^ 0xa1, points, stepSec, { base: 0.4, amp: 0.28, spike: 0.4, max: 1 });
    const tx = seededSeries(h ^ 0xb2, points, stepSec, { base: 0.35, amp: 0.25, spike: 0.4, max: 1 });
    const lat = seededSeries(h ^ 0xc3, points, stepSec, { base: 0.2, amp: 0.15, spike: 0.6, max: 1 });
    const loss = seededSeries(h ^ 0xd4, points, stepSec, { base: 0.001, amp: 0.002, spike: 0.05, max: 1 });
    const errs = seededSeries(h ^ 0xe5, points, stepSec, { base: 0.02, amp: 0.02, spike: 0.4, max: 1 });
    const pts: NetworkPoint[] = rx.map((v, i) => {
      const p50 = +(0.2 + lat[i].value * 4).toFixed(3);
      return {
        ts: v.ts,
        rx_mbps: +(v.value * l.cap).toFixed(0),
        tx_mbps: +(tx[i].value * l.cap).toFixed(0),
        latency_p50_ms: p50,
        latency_p95_ms: +(p50 * 2.2).toFixed(3),
        latency_p99_ms: +(p50 * 3.5).toFixed(3),
        loss_perc: +loss[i].value.toFixed(5),
        errs_per_s: +(errs[i].value * 30).toFixed(2),
      };
    });
    const last = pts[pts.length - 1];
    const status: NodeStatus = last
      ? worstStatus([
          statusFromThresholds(last.latency_p95_ms, 6, 12),
          statusFromThresholds(last.loss_perc, 0.005, 0.02),
        ])
      : "ok";
    return { id: l.id, from: l.from, to: l.to, status, capacity_mbps: l.cap, points: pts };
  });
}
