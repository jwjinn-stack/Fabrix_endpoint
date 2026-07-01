import { useMemo, useRef, useState } from "react";
import type { NodeStatus, TopologyGraph, TopologyNode } from "../../api/types";
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

const NODE_R: Record<TopologyNode["kind"], number> = { server: 16, service: 14, gpu: 10 };

export interface TopologyViewProps {
  graph: TopologyGraph;
  /** false(observe read-only) → 노드 drag 비활성. pan/zoom/hover 는 유지. */
  interactive?: boolean;
  /** 노드 클릭(IMP-45 드릴다운). */
  onSelect?: (nodeId: string) => void;
  height?: number;
}

interface ViewBox { x: number; y: number; w: number; h: number }

export default function TopologyView({ graph, interactive = true, onSelect, height = 420 }: TopologyViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

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

        {/* 엣지 — Bézier path + 공유 화살촉 마커 */}
        <g className="topo-edges">
          {layout.edgePaths.map((ep, i) =>
            ep.d ? (
              <path
                key={`${ep.from}->${ep.to}-${i}`}
                className="topo-edge"
                d={ep.d}
                fill="none"
                stroke="var(--border-strong)"
                strokeWidth={1.4}
                markerEnd="url(#topo-arrow)"
                opacity={activeId && ep.from !== activeId && ep.to !== activeId ? 0.35 : 0.85}
              />
            ) : null,
          )}
        </g>

        {/* 노드 — status 링 + 라벨(이스케이프) */}
        <g className="topo-nodes">
          {graph.nodes.map((n) => {
            const p = posOf(n.id);
            if (!p) return null;
            const r = NODE_R[n.kind];
            const isActive = n.id === activeId;
            const isFocus = focusIdx != null && graph.nodes[focusIdx]?.id === n.id;
            return (
              <g
                key={n.id}
                className={`topo-node ${n.kind} ${n.status}`}
                transform={`translate(${p.x},${p.y})`}
                role="button"
                tabIndex={-1}
                aria-label={`${n.label}, 종류 ${n.kind}, 상태 ${n.status}`}
                onClick={() => onSelect?.(n.id)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  className="topo-node-ring"
                  r={r}
                  fill="var(--surface)"
                  stroke={STATUS_COLOR[n.status]}
                  strokeWidth={isActive || isFocus ? 3.5 : 2.2}
                />
                {isFocus && (
                  <circle r={r + 4} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="3 2" />
                )}
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
