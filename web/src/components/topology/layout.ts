import type { TopologyEdge, TopologyNode } from "../../api/types";

// 순수 계층 DAG 레이아웃 엔진 (IMP-47). 신규 의존성 0 — dagre/elkjs 미채택.
//
// 파이프라인(전 단계 결정적):
//   1) DFS back-edge 역전으로 cycle break → acyclic 화(reversed 플래그 보존).
//   2) longest-path 레이어링으로 tier(=column) 배치.
//   3) tier 내 barycenter/median sweep(down/up 교대)로 엣지 교차 감소.
//   4) tier=x, tier 내 순서=y 로 좌표 부여 + 엣지 Bézier `d` 생성.
//
// 이 파일의 layoutTopology 시그니처가 "seam" — 후일 dagre 로 스왑해도
// TopologyView 콜사이트는 변경 0. 순수·결정적이라 단위 테스트로 가드한다.
// 모듈 전역 가변 상태 없음(순수) — 모든 컨텍스트는 인자로 전달한다.

export interface LayoutOptions {
  colGap?: number; // tier(레이어) 간 x 간격(중심 간)
  rowGap?: number; // tier 내 노드 y 간격(중심 간)
  marginX?: number;
  marginY?: number;
  sweeps?: number; // barycenter sweep 횟수(기본 4)
}

export interface NodePosition {
  x: number;
  y: number;
  tier: number;
}

export interface EdgePath {
  from: string;
  to: string;
  d: string;
  reversed: boolean; // cycle break 로 내부 방향을 뒤집었는지(논리 방향은 from→to 유지)
}

export interface TopologyLayout {
  positions: Map<string, NodePosition>;
  edgePaths: EdgePath[];
  width: number;
  height: number;
}

const DEFAULTS = { colGap: 220, rowGap: 84, marginX: 60, marginY: 40, sweeps: 4 } as const;

// 노드 kind 정렬 tie-break용 우선순위(동률 tier 안에서 안정 정렬 보조).
const KIND_ORDER: Record<TopologyNode["kind"], number> = { server: 0, service: 1, gpu: 2 };

interface InternalEdge {
  from: string; // acyclic 방향(저 tier → 고 tier 로 정렬됨)
  to: string;
  reversed: boolean;
  logicalFrom: string; // 원본 논리 from
  logicalTo: string;
}

// ── 1) cycle break: DFS 로 back-edge 를 찾아 방향을 역전 ──
function breakCycles(nodeIds: string[], edges: TopologyEdge[]): InternalEdge[] {
  const adj = new Map<string, { to: string; idx: number }[]>();
  nodeIds.forEach((id) => adj.set(id, []));
  edges.forEach((e, idx) => {
    if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from)!.push({ to: e.to, idx });
  });

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  nodeIds.forEach((id) => color.set(id, WHITE));
  const reversedIdx = new Set<number>();

  // 재귀 대신 명시 스택(대형 그래프 안전) — 결정적 순회(idx 정렬된 인접).
  const visit = (root: string) => {
    const stack: { node: string; edgeList: { to: string; idx: number }[]; cursor: number }[] = [];
    color.set(root, GRAY);
    stack.push({ node: root, edgeList: [...(adj.get(root) ?? [])].sort((a, b) => a.idx - b.idx), cursor: 0 });
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.cursor >= frame.edgeList.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const { to, idx } = frame.edgeList[frame.cursor];
      frame.cursor++;
      const c = color.get(to);
      if (c === GRAY) {
        reversedIdx.add(idx); // back-edge → 사이클. 역전 대상 표시.
      } else if (c === WHITE) {
        color.set(to, GRAY);
        stack.push({ node: to, edgeList: [...(adj.get(to) ?? [])].sort((a, b) => a.idx - b.idx), cursor: 0 });
      }
    }
  };
  nodeIds.forEach((id) => {
    if (color.get(id) === WHITE) visit(id);
  });

  return edges.map((e, idx) => {
    const rev = reversedIdx.has(idx);
    return {
      from: rev ? e.to : e.from,
      to: rev ? e.from : e.to,
      reversed: rev,
      logicalFrom: e.from,
      logicalTo: e.to,
    };
  });
}

// ── 2) longest-path 레이어링(acyclic 가정) ──
function assignTiers(nodeIds: string[], edges: InternalEdge[]): Map<string, number> {
  const tier = new Map<string, number>();
  nodeIds.forEach((id) => tier.set(id, 0));
  const succ = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  nodeIds.forEach((id) => { succ.set(id, []); indeg.set(id, 0); });
  edges.forEach((e) => {
    succ.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  });
  // Kahn 위상정렬 + longest-path 완화(결정적: nodeIds 순 큐 초기화).
  const queue: string[] = nodeIds.filter((id) => (indeg.get(id) ?? 0) === 0);
  const localIndeg = new Map(indeg);
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    const tu = tier.get(u)!;
    for (const v of succ.get(u)!) {
      if (tier.get(v)! < tu + 1) tier.set(v, tu + 1);
      localIndeg.set(v, (localIndeg.get(v) ?? 0) - 1);
      if (localIndeg.get(v) === 0) queue.push(v);
    }
  }
  return tier;
}

// ── 3) tier 내 순서(교차 감소) ── barycenter/median sweep.
function orderTiers(
  nodeIds: string[],
  edges: InternalEdge[],
  tier: Map<string, number>,
  kindOf: (id: string) => TopologyNode["kind"],
  sweeps: number,
): Map<number, string[]> {
  const maxTier = Math.max(0, ...nodeIds.map((id) => tier.get(id) ?? 0));
  const layers = new Map<number, string[]>();
  for (let t = 0; t <= maxTier; t++) layers.set(t, []);
  // 초기 순서: nodeIds 순 안정 + kind tie-break.
  nodeIds.forEach((id) => layers.get(tier.get(id) ?? 0)!.push(id));
  for (const [, arr] of layers) {
    arr.sort((a, b) => KIND_ORDER[kindOf(a)] - KIND_ORDER[kindOf(b)]);
  }

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  nodeIds.forEach((id) => { preds.set(id, []); succs.set(id, []); });
  edges.forEach((e) => { succs.get(e.from)!.push(e.to); preds.get(e.to)!.push(e.from); });

  const posIn = (t: number): Map<string, number> => {
    const m = new Map<string, number>();
    (layers.get(t) ?? []).forEach((id, i) => m.set(id, i));
    return m;
  };

  const median = (id: string, neigh: Map<string, string[]>, pos: Map<string, number>): number => {
    const ps = neigh.get(id)!.map((n) => pos.get(n)).filter((v): v is number => v != null).sort((a, b) => a - b);
    if (ps.length === 0) return -1; // 고정 이웃 없음 → 현 위치 유지
    const mid = Math.floor(ps.length / 2);
    return ps.length % 2 === 1 ? ps[mid] : (ps[mid - 1] + ps[mid]) / 2;
  };

  const sweep = (down: boolean) => {
    const range = down
      ? Array.from({ length: maxTier }, (_, i) => i + 1) // 1..maxTier (앞 tier 기준)
      : Array.from({ length: maxTier }, (_, i) => maxTier - 1 - i); // maxTier-1..0
    for (const t of range) {
      const fixedPos = posIn(down ? t - 1 : t + 1);
      const neigh = down ? preds : succs;
      const arr = layers.get(t)!;
      const keyed = arr.map((id, i) => ({ id, i, m: median(id, neigh, fixedPos) }));
      // median<0(고정 이웃 없음) 은 원위치 유지(안정): 기존 인덱스로 대체.
      keyed.sort((a, b) => {
        const ma = a.m < 0 ? a.i : a.m;
        const mb = b.m < 0 ? b.i : b.m;
        if (ma !== mb) return ma - mb;
        return a.i - b.i; // 안정 tie-break → 결정적
      });
      layers.set(t, keyed.map((k) => k.id));
    }
  };

  const nSweeps = Math.max(0, sweeps);
  for (let s = 0; s < nSweeps; s++) sweep(s % 2 === 0);
  return layers;
}

// ── 엣지 교차수 계산(회귀 가드용) ── layers/tier 기준 인접 tier 쌍 교차.
function countCrossings(edges: InternalEdge[], layers: Map<number, string[]>, tier: Map<string, number>): number {
  const idxIn = new Map<number, Map<string, number>>();
  for (const [t, arr] of layers) {
    const m = new Map<string, number>();
    arr.forEach((id, i) => m.set(id, i));
    idxIn.set(t, m);
  }
  let crossings = 0;
  const maxTier = Math.max(0, ...[...layers.keys()]);
  for (let t = 0; t < maxTier; t++) {
    const segs = edges
      .filter((e) => tier.get(e.from) === t && tier.get(e.to) === t + 1)
      .map((e) => ({ u: idxIn.get(t)!.get(e.from) ?? 0, v: idxIn.get(t + 1)!.get(e.to) ?? 0 }))
      .sort((a, b) => (a.u - b.u) || (a.v - b.v));
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[i].v > segs[j].v) crossings++;
      }
    }
  }
  return crossings;
}

// 회귀 가드 헬퍼(테스트 전용) — 동일 tier 배치에서 sweep 전/후 교차수를 비교한다.
export function crossingsBeforeAfter(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  sweeps = DEFAULTS.sweeps,
): { before: number; after: number } {
  const ids = nodes.map((n) => n.id);
  const kindMap = new Map(nodes.map((n) => [n.id, n.kind]));
  const kindOf = (id: string): TopologyNode["kind"] => kindMap.get(id) ?? "service";
  const internal = breakCycles(ids, edges);
  const tier = assignTiers(ids, internal);
  const before = countCrossings(internal, orderTiers(ids, internal, tier, kindOf, 0), tier);
  const after = countCrossings(internal, orderTiers(ids, internal, tier, kindOf, sweeps), tier);
  return { before, after };
}

// ── 진입점(seam) ──
export function layoutTopology(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  options: LayoutOptions = {},
): TopologyLayout {
  const colGap = options.colGap ?? DEFAULTS.colGap;
  const rowGap = options.rowGap ?? DEFAULTS.rowGap;
  const marginX = options.marginX ?? DEFAULTS.marginX;
  const marginY = options.marginY ?? DEFAULTS.marginY;
  const sweeps = options.sweeps ?? DEFAULTS.sweeps;

  const ids = nodes.map((n) => n.id);
  const kindMap = new Map(nodes.map((n) => [n.id, n.kind]));
  const kindOf = (id: string): TopologyNode["kind"] => kindMap.get(id) ?? "service";

  const internal = breakCycles(ids, edges);
  const tier = assignTiers(ids, internal);
  const layers = orderTiers(ids, internal, tier, kindOf, sweeps);

  // 좌표: tier=x column, tier 내 index=y row.
  const positions = new Map<string, NodePosition>();
  let maxRow = 0;
  for (const [t, arr] of layers) {
    arr.forEach((id, i) => {
      positions.set(id, { x: marginX + t * colGap, y: marginY + i * rowGap, tier: t });
      if (i > maxRow) maxRow = i;
    });
  }

  const maxTier = Math.max(0, ...ids.map((id) => tier.get(id) ?? 0));
  const width = marginX * 2 + maxTier * colGap;
  const height = marginY * 2 + maxRow * rowGap;

  // 엣지 Bézier `d`(가로 방향 3차 곡선). 논리 방향(from→to) 기준으로 그린다.
  const edgePaths: EdgePath[] = internal.map((e) => {
    const a = positions.get(e.logicalFrom);
    const b = positions.get(e.logicalTo);
    if (!a || !b) return { from: e.logicalFrom, to: e.logicalTo, d: "", reversed: e.reversed };
    const dx = (b.x - a.x) * 0.5;
    const d = `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${(a.x + dx).toFixed(1)},${a.y.toFixed(1)} ${(b.x - dx).toFixed(1)},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    return { from: e.logicalFrom, to: e.logicalTo, d, reversed: e.reversed };
  });

  return { positions, edgePaths, width, height };
}
