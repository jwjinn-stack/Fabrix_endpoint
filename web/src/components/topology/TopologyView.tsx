import { useMemo, useRef, useState } from "react";
import type { NodeStatus, TopologyEdge, TopologyGraph, TopologyNode } from "../../api/types";
import { ChartTooltip } from "../chart";
import { layoutTopology } from "./layout";
import type { NodePosition } from "./layout";

// hand-rolled 계층 SVG 토폴로지 렌더러 (IMP-47). 신규 의존성 0.
// - 레이아웃은 layout.ts(순수·seam). 이 컴포넌트는 렌더 + 상호작용만.
// - 상태 색은 GpuLedGrid 관례와 통일(green/amber/red 토큰). 신규 색 금지.
// - pan/zoom = viewBox transform state(d3-zoom 불필요). 노드 drag = pointer override(interactive only).
// - hover/focus = nearest-node 히트테스트(client→viewBox→nearest). ChartTooltip 재사용.
// - observe read-only(interactive=false): drag/edit 비활성, pan/zoom/hover 는 유지.
//
// 실제 페이지(라우트·SlidePanel 드릴다운)는 IMP-45, 고급 시각(arc·micro-metric·애니)은 IMP-48.

const STATUS_COLOR: Record<NodeStatus, string> = {
  ok: "var(--green)",
  warn: "var(--amber)",
  crit: "var(--red)",
};

// IMP-48: status 를 색-only 로 두지 않는다(WCAG 1.4.1). 노드 중앙에 글리프 병기.
const STATUS_GLYPH: Record<NodeStatus, string> = { ok: "✓", warn: "!", crit: "✕" };

// IMP-48: 노드 body 안에 임베드할 micro-metric 1-2개(정보밀도). kind 별 우선 지표.
function microMetrics(node: TopologyNode): string[] {
  const m = node.metrics ?? {};
  const out: string[] = [];
  if (node.kind === "service") {
    if (typeof m.qps === "number") out.push(`${m.qps} q/s`);
    if (typeof m.error_rate === "number") out.push(`${(m.error_rate * 100).toFixed(1)}% err`);
  } else if (node.kind === "gpu") {
    if (typeof m.util_perc === "number") out.push(`${Math.round(m.util_perc * 100)}%`);
    if (typeof m.temp_c === "number") out.push(`${m.temp_c}°C`);
  } else {
    if (typeof m.cpu_util === "number") out.push(`${Math.round(m.cpu_util * 100)}%`);
  }
  return out.slice(0, 2);
}

// IMP-48 directional 엣지: 트래픽(qps) 비례 stroke-width(clamp) + 에러율 색.
function edgeStrokeWidth(qps?: number): number {
  if (typeof qps !== "number" || qps <= 0) return 1.4;
  // qps 0..40 → 1.4..5 로 clamp(로그 대신 선형 근사; 과대 대비 방지).
  return Math.min(5, Math.max(1.4, 1.4 + (qps / 40) * 3.6));
}
function edgeColor(errorRate?: number): string {
  if (typeof errorRate !== "number") return "var(--border-strong)";
  if (errorRate >= 0.05) return "var(--red)";
  if (errorRate >= 0.02) return "var(--amber)";
  return "var(--border-strong)";
}

const NODE_R: Record<TopologyNode["kind"], number> = { server: 16, service: 14, gpu: 10 };

export interface TopologyViewProps {
  graph: TopologyGraph;
  /** false(observe read-only) → 노드 drag 비활성. pan/zoom/hover 는 유지. */
  interactive?: boolean;
  /** 노드 클릭(IMP-45 드릴다운). */
  onSelect?: (nodeId: string) => void;
  height?: number;
  /** IMP-48: 선택(controlled) 노드 — subgraph isolate 앵커. 1-hop 인접 강조, 비인접 dim. */
  selectedId?: string | null;
  /** IMP-48: 노드 body 안 micro-metric 임베드 on/off(기본 true). */
  showMetrics?: boolean;
  /** IMP-64(가법적): 엣지 상태색 인코딩. from/to 노드 status 로 색을 실어보낸다(스키마 그래프처럼
   *  error_rate 가 없는 그래프에서도 관계의 상태 위계를 보이게). 반환 null → 기본 edgeColor 로 폴백.
   *  geometry(layout.ts)는 건드리지 않는다 — stroke 색만 추가 인코딩. */
  edgeStatusColor?: (edge: TopologyEdge, fromStatus: NodeStatus, toStatus: NodeStatus) => string | null;
}

// 두 노드 상태의 worst(crit>warn>ok). 엣지 상태색 파생용(가법적).
const STATUS_RANK: Record<NodeStatus, number> = { ok: 0, warn: 1, crit: 2 };
export function worseStatus(a: NodeStatus, b: NodeStatus): NodeStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

interface ViewBox { x: number; y: number; w: number; h: number }

export default function TopologyView({ graph, interactive = true, onSelect, height = 420, selectedId = null, showMetrics = true, edgeStatusColor }: TopologyViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  // IMP-64: 엣지 상태색 파생 시 노드 status 조회(id→status). 가법적 — geometry 무관.
  const statusById = useMemo(() => {
    const m = new Map<string, NodeStatus>();
    for (const n of graph.nodes) m.set(n.id, n.status);
    return m;
  }, [graph.nodes]);

  // IMP-48 subgraph isolate: 선택 노드의 1-hop 인접 집합(자신 포함). 비인접은 dim.
  const adjacency = useMemo(() => {
    if (!selectedId) return null;
    const near = new Set<string>([selectedId]);
    for (const e of graph.edges) {
      if (e.from === selectedId) near.add(e.to);
      if (e.to === selectedId) near.add(e.from);
    }
    return near;
  }, [selectedId, graph.edges]);

  // 순수 레이아웃(그래프 변경 시에만 재계산).
  const layout = useMemo(() => layoutTopology(graph.nodes, graph.edges), [graph.nodes, graph.edges]);

  // 노드 위치 override(사용자 drag). base 레이아웃 위에 얹는다.
  const [overrides, setOverrides] = useState<Map<string, { x: number; y: number }>>(new Map());
  const posOf = (id: string): NodePosition | undefined => {
    const base = layout.positions.get(id);
    if (!base) return undefined;
    const ov = overrides.get(id);
    return ov ? { ...base, x: ov.x, y: ov.y } : base;
  };

  const baseVB: ViewBox = { x: 0, y: 0, w: Math.max(layout.width, 1), h: Math.max(layout.height, 1) };
  const [vb, setVb] = useState<ViewBox | null>(null);
  const view = vb ?? baseVB;

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  // 드래그 상태: 배경 pan 또는 노드 이동.
  const drag = useRef<
    | { kind: "pan"; startClient: { x: number; y: number }; startVB: ViewBox }
    | { kind: "node"; id: string }
    | null
  >(null);

  // client 좌표 → viewBox 좌표(현재 pan/zoom 반영).
  const toViewBox = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    return { x: view.x + fx * view.w, y: view.y + fy * view.h };
  };

  // nearest-node 히트테스트(viewBox 좌표 기준). 반경 밖이면 null.
  const nearestNode = (vx: number, vy: number): string | null => {
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of graph.nodes) {
      const p = posOf(n.id);
      if (!p) continue;
      const dx = p.x - vx;
      const dy = p.y - vy;
      const d = dx * dx + dy * dy;
      const r = NODE_R[n.kind] + 14; // 히트 반경(약간 여유)
      if (d < bestD && d <= r * r) { bestD = d; best = n.id; }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const vbp = toViewBox(e.clientX, e.clientY);
    if (!vbp) return;
    const hit = nearestNode(vbp.x, vbp.y);
    if (hit && interactive) {
      drag.current = { kind: "node", id: hit };
    } else {
      drag.current = { kind: "pan", startClient: { x: e.clientX, y: e.clientY }, startVB: view };
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      // hover 히트테스트만.
      const vbp = toViewBox(e.clientX, e.clientY);
      setHoverId(vbp ? nearestNode(vbp.x, vbp.y) : null);
      return;
    }
    if (d.kind === "pan") {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const dxClient = e.clientX - d.startClient.x;
      const dyClient = e.clientY - d.startClient.y;
      // 화면 이동량을 viewBox 단위로 환산해 뷰를 반대로 민다(pan).
      const dxVB = (dxClient / rect.width) * d.startVB.w;
      const dyVB = (dyClient / rect.height) * d.startVB.h;
      setVb({ ...d.startVB, x: d.startVB.x - dxVB, y: d.startVB.y - dyVB });
    } else {
      const vbp = toViewBox(e.clientX, e.clientY);
      if (!vbp) return;
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(d.id, { x: vbp.x, y: vbp.y });
        return next;
      });
    }
  };

  const onPointerUp = () => { drag.current = null; };

  // wheel zoom — 커서 지점을 기준으로 viewBox 확대/축소.
  const onWheel = (e: React.WheelEvent) => {
    const vbp = toViewBox(e.clientX, e.clientY);
    if (!vbp) return;
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    const nw = Math.min(Math.max(view.w * factor, baseVB.w * 0.2), baseVB.w * 5);
    const nh = Math.min(Math.max(view.h * factor, baseVB.h * 0.2), baseVB.h * 5);
    // 커서 지점을 고정점으로 유지.
    const rx = (vbp.x - view.x) / view.w;
    const ry = (vbp.y - view.y) / view.h;
    setVb({ x: vbp.x - rx * nw, y: vbp.y - ry * nh, w: nw, h: nh });
  };

  // 키보드 roving focus(useChartHover focusIndex 패턴). Enter/Space → onSelect.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = graph.nodes.length;
    if (n === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((p) => ((p ?? -1) + 1 + n) % n);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((p) => ((p ?? 0) - 1 + n) % n);
    } else if (e.key === "Enter" || e.key === " ") {
      if (focusIdx != null) { e.preventDefault(); onSelect?.(graph.nodes[focusIdx].id); }
    } else if (e.key === "0" || e.key === "Escape") {
      if (vb) { e.preventDefault(); setVb(null); }
    }
  };

  const activeId = hoverId ?? (focusIdx != null ? graph.nodes[focusIdx]?.id : null) ?? null;
  const activeNode = activeId ? graph.nodes.find((x) => x.id === activeId) : undefined;
  const activePos = activeId ? posOf(activeId) : undefined;

  const zoomed = vb != null;

  return (
    <div className="card topo-card">
      <div className="card-head">
        <h3>운영 토폴로지</h3>
        <span className="spacer" />
        <span className="topo-legend">
          <span className="topo-key"><span className="topo-dot" style={{ background: STATUS_COLOR.ok }} /> 정상</span>
          <span className="topo-key"><span className="topo-dot" style={{ background: STATUS_COLOR.warn }} /> 주의</span>
          <span className="topo-key"><span className="topo-dot" style={{ background: STATUS_COLOR.crit }} /> 위험</span>
        </span>
        {zoomed && (
          <button type="button" className="link" onClick={() => setVb(null)}>뷰 초기화 ✕</button>
        )}
      </div>
      <svg
        ref={svgRef}
        className="topo-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        tabIndex={0}
        aria-label={`운영 토폴로지 그래프. 노드 ${graph.nodes.length}개, 링크 ${graph.edges.length}개. 드래그로 이동, 휠로 확대·축소${interactive ? ", 노드 드래그로 재배치" : "(읽기 전용)"}. 키보드: ←/→ 로 노드 이동, Enter 로 선택, 0 또는 Esc 로 초기화.`}
        style={{ cursor: drag.current?.kind === "pan" ? "grabbing" : "grab", userSelect: "none", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { drag.current = null; setHoverId(null); }}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <title>운영 토폴로지 (드래그 이동 · 휠 확대 · ←/→ 노드 이동 · Enter 선택)</title>
        <defs>
          <marker id="topo-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--border-strong)" />
          </marker>
        </defs>

        {/* 엣지 — Bézier path + 공유 화살촉 마커. IMP-48: 트래픽 비례 두께·에러 색·isolate dim·흐름 애니. */}
        <g className="topo-edges">
          {layout.edgePaths.map((ep, i) => {
            if (!ep.d) return null;
            // 논리 방향(from→to)으로 원본 엣지 지표를 찾아 두께/색을 인코딩.
            const meta = graph.edges.find((e) => e.from === ep.from && e.to === ep.to);
            const sw = edgeStrokeWidth(meta?.qps);
            // IMP-64: edgeStatusColor 제공 시 끝점 status 로 상태색(스키마 그래프 등 error_rate 부재 그래프).
            //  반환 null 이거나 미제공 → 기존 edgeColor(error_rate) 폴백. 색만 바뀜(두께/경로 불변).
            const statusCol = edgeStatusColor && meta
              ? edgeStatusColor(meta, statusById.get(ep.from) ?? "ok", statusById.get(ep.to) ?? "ok")
              : null;
            const col = statusCol ?? edgeColor(meta?.error_rate);
            const inSubgraph = !adjacency || (adjacency.has(ep.from) && adjacency.has(ep.to));
            const hoverDim = activeId && ep.from !== activeId && ep.to !== activeId;
            const dim = adjacency ? !inSubgraph : !!hoverDim;
            // 흐름 애니: 선택(isolate)된 subgraph 엣지에만. prefers-reduced-motion 은 CSS 로 정지.
            const flow = !!selectedId && inSubgraph;
            return (
              <path
                key={`${ep.from}->${ep.to}-${i}`}
                className={`topo-edge${flow ? " flow" : ""}`}
                d={ep.d}
                fill="none"
                stroke={col}
                strokeWidth={sw}
                markerEnd="url(#topo-arrow)"
                opacity={dim ? 0.2 : 0.85}
              />
            );
          })}
        </g>

        {/* 노드 — status 링 + arc + micro-metric + 라벨(이스케이프). IMP-48. */}
        <g className="topo-nodes">
          {graph.nodes.map((n) => {
            const p = posOf(n.id);
            if (!p) return null;
            const r = NODE_R[n.kind];
            const isActive = n.id === activeId;
            const isSelected = n.id === selectedId;
            const isFocus = focusIdx != null && graph.nodes[focusIdx]?.id === n.id;
            const dim = adjacency ? !adjacency.has(n.id) : false;
            const metrics = showMetrics ? microMetrics(n) : [];
            const arc = healthArc(n, r);
            return (
              <g
                key={n.id}
                className={`topo-node ${n.kind} ${n.status}${dim ? " dim" : ""}${isSelected ? " selected" : ""}`}
                transform={`translate(${p.x},${p.y})`}
                role="button"
                tabIndex={-1}
                aria-label={`${n.label}, 종류 ${n.kind}, 상태 ${n.status}${metrics.length ? `, ${metrics.join(", ")}` : ""}`}
                onClick={() => onSelect?.(n.id)}
                style={{ cursor: "pointer", opacity: dim ? 0.28 : 1 }}
              >
                <circle
                  className="topo-node-ring"
                  r={r}
                  fill="var(--surface)"
                  stroke={STATUS_COLOR[n.status]}
                  strokeWidth={isActive || isSelected || isFocus ? 3.5 : 2.2}
                />
                {/* proportional multi-arc: error 비율만큼 상태색 arc 를 링 위에 덧그린다(합=1 근사). */}
                {arc && (
                  <path className="topo-node-arc" d={arc.d} fill="none" stroke={arc.color} strokeWidth={3.2} strokeLinecap="round" />
                )}
                {isFocus && (
                  <circle r={r + 4} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="3 2" />
                )}
                {/* status 글리프(색-only 금지, WCAG 1.4.1). 중앙 상단에 작게. */}
                <text className={`topo-node-glyph ${n.status}`} x={0} y={metrics.length ? -1 : 4} textAnchor="middle">
                  {STATUS_GLYPH[n.status]}
                </text>
                {/* micro-metric 임베드(1-2줄) — 정보밀도. 값은 이스케이프 텍스트. */}
                {metrics.map((mt, mi) => (
                  <text key={mi} className="topo-node-metric" x={0} y={9 + mi * 8} textAnchor="middle">
                    {mt}
                  </text>
                ))}
                <text className="topo-node-label chart-axis-text" x={0} y={r + 14} textAnchor="middle">
                  {n.label}
                </text>
              </g>
            );
          })}
        </g>

        {/* hover/focus 툴팁 — ChartTooltip 재사용(값은 이스케이프 텍스트) */}
        {activeNode && activePos && (
          <ChartTooltip
            x={activePos.x}
            viewW={view.x + view.w}
            top={activePos.y}
            title={activeNode.label}
            rows={tooltipRows(activeNode)}
          />
        )}
      </svg>
    </div>
  );
}

// IMP-48 proportional health arc(Grafana arc): error_rate 만큼의 원호를 상태색으로 링 위에 그린다.
// success 부분은 base 링(green stroke)이 이미 표현하므로, error/throttle 비율만 덧그려 "대부분 green이면 healthy".
// error_rate 가 없거나 0이면 arc 없음(순수 green 링).
function healthArc(node: TopologyNode, r: number): { d: string; color: string } | null {
  const err = node.metrics?.error_rate;
  if (typeof err !== "number" || err <= 0) return null;
  const frac = Math.min(1, err / 0.1); // 0..10% err → 0..전체 링(과대 표시 방지 클램프)
  if (frac <= 0.001) return null;
  const start = -Math.PI / 2; // 12시 방향에서 시계방향
  const end = start + frac * Math.PI * 2;
  const x0 = (r * Math.cos(start)).toFixed(2);
  const y0 = (r * Math.sin(start)).toFixed(2);
  const x1 = (r * Math.cos(end)).toFixed(2);
  const y1 = (r * Math.sin(end)).toFixed(2);
  const large = frac > 0.5 ? 1 : 0;
  const color = err >= 0.05 ? "var(--red)" : "var(--amber)";
  return { d: `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`, color };
}

// 노드 metrics 를 읽기 좋은 행으로. 값은 문자열(이스케이프 렌더). dangerouslySetInnerHTML 미사용.
function tooltipRows(node: TopologyNode): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: "종류", value: node.kind },
    { label: "상태", value: node.status },
  ];
  const m = node.metrics ?? {};
  for (const [k, v] of Object.entries(m)) {
    const isRatio = k.endsWith("_perc") || k.endsWith("_util") || k === "error_rate";
    rows.push({ label: k, value: isRatio ? `${Math.round(v * 100)}%` : String(v) });
  }
  return rows;
}
