import { useRef, useState } from "react";
import type { TimePoint } from "../api/types";

// 4-1 하단 겹쳐보기 차트: QPS 라인(좌축) · TTFT p95 라인(우축 ms) · 차단 막대.
// P4-0: avg/current/max 범례 + 드래그-투-줌 + TTFT 임계선(SLO). 의존성 없이 SVG.
const W = 1000;
const H = 240;
const PAD = { top: 16, right: 48, bottom: 24, left: 40 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

function fmtAxis(v: number, max: number): string {
  if (max >= 10) return String(Math.round(v));
  if (max >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

function stat(values: number[]) {
  if (values.length === 0) return { avg: 0, cur: 0, max: 0 };
  const sum = values.reduce((s, v) => s + v, 0);
  return { avg: sum / values.length, cur: values[values.length - 1], max: Math.max(...values) };
}

export default function TimeseriesChart({
  points,
  ttftThresholdMs = 140,
}: {
  points: TimePoint[];
  /** TTFT p95 SLO 임계(ms) — 초과 구간을 빨간 점선/밴드로 표시. */
  ttftThresholdMs?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // 드래그-투-줌 상태(데이터 인덱스 범위).
  const [zoom, setZoom] = useState<{ a: number; b: number } | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);

  if (points.length === 0) return null;

  const view = zoom ? points.slice(zoom.a, zoom.b + 1) : points;
  if (view.length === 0) return null;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const qpsStat = stat(view.map((p) => p.qps));
  const ttftStat = stat(view.map((p) => p.ttft_p95_ms));
  const blockedTotal = view.reduce((s, p) => s + p.blocked, 0);

  const qpsMax = niceMax(qpsStat.max);
  const ttftMax = niceMax(Math.max(ttftStat.max, ttftThresholdMs));
  const blockedMax = Math.max(...view.map((p) => p.blocked), 1);

  const x = (i: number) => PAD.left + (innerW * i) / Math.max(view.length - 1, 1);
  const yQps = (v: number) => PAD.top + innerH * (1 - v / qpsMax);
  const yTtft = (v: number) => PAD.top + innerH * (1 - v / ttftMax);

  const line = (sel: (p: TimePoint) => number, scale: (v: number) => number) =>
    view.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${scale(sel(p)).toFixed(1)}`).join(" ");

  const barW = Math.max(innerW / view.length - 1.5, 1.5);
  const labelStep = Math.ceil(view.length / 6);

  // 마우스 x(px) → view 내 데이터 인덱스.
  const idxFromEvent = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const frac = (clientX - rect.left) / rect.width; // 0..1 (전체 svg 폭)
    const px = frac * W;
    const i = Math.round(((px - PAD.left) / innerW) * (view.length - 1));
    return Math.min(Math.max(i, 0), view.length - 1);
  };

  const onDown = (e: React.MouseEvent) => {
    const i = idxFromEvent(e.clientX);
    setDrag({ a: i, b: i });
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag) return;
    setDrag({ ...drag, b: idxFromEvent(e.clientX) });
  };
  const onUp = () => {
    if (drag) {
      const lo = Math.min(drag.a, drag.b);
      const hi = Math.max(drag.a, drag.b);
      if (hi - lo >= 1) {
        // 현재 view 기준 인덱스를 원본 points 기준으로 환산.
        const base = zoom ? zoom.a : 0;
        setZoom({ a: base + lo, b: base + hi });
      }
    }
    setDrag(null);
  };

  const ttftThresholdY = yTtft(ttftThresholdMs);

  return (
    <div className="card chart-card">
      <div className="card-head">
        <h3>시계열 · QPS / TTFT p95 / 차단건수</h3>
        <span className="spacer" />
        {zoom && (
          <button type="button" className="link" onClick={() => setZoom(null)}>
            줌 초기화 ✕
          </button>
        )}
      </div>
      <div className="chart-legend">
        <span>
          <span className="dot" style={{ background: "var(--primary)" }} />
          QPS (좌) · 평균 {fmtAxis(qpsStat.avg, qpsMax)} / 현재 {fmtAxis(qpsStat.cur, qpsMax)} / 최대 {fmtAxis(qpsStat.max, qpsMax)}
        </span>
        <span>
          <span className="dot" style={{ background: "var(--teal)" }} />
          TTFT p95 ms (우) · 평균 {Math.round(ttftStat.avg)} / 현재 {Math.round(ttftStat.cur)} / 최대 {Math.round(ttftStat.max)}
        </span>
        <span>
          <span className="dot" style={{ background: "var(--red)" }} />
          차단 합계 {blockedTotal}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="none"
        role="img"
        aria-label={`최근 구간 시계열. 데이터 포인트 ${view.length}개. QPS, TTFT p95(ms), 차단 건수 추이. 드래그하여 확대.`}
        style={{ cursor: "crosshair", userSelect: "none" }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => setDrag(null)}
      >
        <title>QPS · TTFT p95 · 차단건수 시계열 (드래그하여 확대)</title>
        {/* 가로 그리드 */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => {
          const y = PAD.top + innerH * g;
          return (
            <g key={g}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--grid-line)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y + 3} fontSize={10} fill="var(--text-faint)" textAnchor="end">
                {fmtAxis(qpsMax * (1 - g), qpsMax)}
              </text>
              <text x={W - PAD.right + 6} y={y + 3} fontSize={10} fill="var(--text-faint)" textAnchor="start">
                {Math.round(ttftMax * (1 - g))}
              </text>
            </g>
          );
        })}

        {/* TTFT SLO 임계선 */}
        {ttftThresholdMs > 0 && ttftThresholdY > PAD.top && (
          <g>
            <line
              x1={PAD.left}
              y1={ttftThresholdY}
              x2={W - PAD.right}
              y2={ttftThresholdY}
              stroke="var(--red)"
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.6}
            />
            <text x={W - PAD.right} y={ttftThresholdY - 4} fontSize={9} fill="var(--red)" textAnchor="end">
              TTFT SLO {ttftThresholdMs}ms
            </text>
          </g>
        )}

        {/* 차단 막대 */}
        {view.map((p, i) =>
          p.blocked > 0 ? (
            <rect
              key={i}
              x={x(i) - barW / 2}
              y={PAD.top + innerH * (1 - (p.blocked / blockedMax) * 0.4)}
              width={barW}
              height={innerH * (p.blocked / blockedMax) * 0.4}
              fill="var(--red)"
              opacity={0.5}
            />
          ) : null,
        )}

        {/* TTFT 라인 */}
        <path d={line((p) => p.ttft_p95_ms, yTtft)} fill="none" stroke="var(--teal)" strokeWidth={1.6} />
        {/* QPS 라인 */}
        <path d={line((p) => p.qps, yQps)} fill="none" stroke="var(--primary)" strokeWidth={1.8} />

        {/* 드래그 선택 영역 */}
        {drag && Math.abs(drag.b - drag.a) >= 1 && (
          <rect
            x={Math.min(x(drag.a), x(drag.b))}
            y={PAD.top}
            width={Math.abs(x(drag.b) - x(drag.a))}
            height={innerH}
            fill="var(--primary)"
            opacity={0.12}
            stroke="var(--primary)"
            strokeWidth={1}
          />
        )}

        {/* x축 라벨 */}
        {view.map((p, i) =>
          i % labelStep === 0 ? (
            <text key={i} x={x(i)} y={H - 6} fontSize={10} fill="var(--text-faint)" textAnchor="middle">
              {new Date(p.ts).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
