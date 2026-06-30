import { useRef, useState } from "react";
import type { TimePoint } from "../api/types";
import { AxisText, ChartTooltip, Crosshair, HGrid, Legend, SERIES, useChartHover } from "./chart";

// 4-1 하단 겹쳐보기 차트: QPS 라인(좌축) · TTFT p95 라인(우축 ms) · 차단 막대.
// P4-0: avg/current/max 범례 + 드래그-투-줌 + TTFT 임계선(SLO). 의존성 없이 SVG.
// IMP-25: 공용 chart/ 프리미티브로 축 토큰화 + Grafana 식 호버 크로스헤어/readout.
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

  const view = zoom ? points.slice(zoom.a, zoom.b + 1) : points;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // 호버/포커스 훅(드래그줌과 동일 좌표공간; view 길이에 맞춤).
  const hover = useChartHover({ svgRef, count: view.length, viewW: W, padLeft: PAD.left, innerW });

  if (points.length === 0) return null;
  if (view.length === 0) return null;

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

  // 마우스 x(px) → view 내 데이터 인덱스(드래그줌용 — hover 훅과 동일 계산).
  const idxFromEvent = (clientX: number): number => hover.indexFromClientX(clientX);

  const onDown = (e: React.MouseEvent) => {
    const i = idxFromEvent(e.clientX);
    setDrag({ a: i, b: i });
  };
  const onMove = (e: React.MouseEvent) => {
    if (drag) {
      setDrag({ ...drag, b: idxFromEvent(e.clientX) });
      return; // 드래그 중에는 selection 우선(readout 숨김)
    }
    hover.onMouseMove(e);
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

  // idle hover/focus 시 readout 노출(드래그 중에는 숨김).
  const activeIndex = drag ? null : hover.activeIndex;
  const activePoint = activeIndex != null ? view[activeIndex] : null;

  // D-10 키보드 줌 — 차트 포커스 시 +/= 줌인(가운데 기준 절반), - 줌아웃(2배), 0/Esc 리셋.
  // IMP-25: ArrowLeft/Right 로 크로스헤어 이동.
  const last = points.length - 1;
  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key;
    if (key === "ArrowLeft") {
      e.preventDefault();
      hover.moveBy(-1);
      return;
    }
    if (key === "ArrowRight") {
      e.preventDefault();
      hover.moveBy(1);
      return;
    }
    if (key === "0" || key === "Escape") {
      if (zoom) { e.preventDefault(); setZoom(null); }
      return;
    }
    const a = zoom ? zoom.a : 0;
    const b = zoom ? zoom.b : last;
    const center = (a + b) / 2;
    const span = b - a; // 현재 보이는 폭(인덱스)
    if (key === "+" || key === "=") {
      // 줌인: 폭을 절반으로(최소 2포인트는 유지).
      const half = Math.max(Math.floor(span / 4), 1);
      const na = Math.max(Math.round(center - half), 0);
      const nb = Math.min(Math.max(Math.round(center + half), na + 1), last);
      if (nb - na >= 1 && (na !== a || nb !== b)) { e.preventDefault(); setZoom({ a: na, b: nb }); }
    } else if (key === "-" || key === "_") {
      // 줌아웃: 폭을 2배로. 전체를 덮으면 리셋(zoom null).
      const half = span; // 새 반폭 = 기존 전폭
      const na = Math.max(Math.round(center - half), 0);
      const nb = Math.min(Math.round(center + half), last);
      if (na <= 0 && nb >= last) { e.preventDefault(); setZoom(null); }
      else if (nb - na >= 1) { e.preventDefault(); setZoom({ a: na, b: nb }); }
    }
  };

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
      <Legend
        items={[
          {
            color: SERIES.primary,
            label: `QPS (좌) · 평균 ${fmtAxis(qpsStat.avg, qpsMax)} / 현재 ${fmtAxis(qpsStat.cur, qpsMax)} / 최대 ${fmtAxis(qpsStat.max, qpsMax)}`,
          },
          {
            color: SERIES.teal,
            label: `TTFT p95 ms (우) · 평균 ${Math.round(ttftStat.avg)} / 현재 ${Math.round(ttftStat.cur)} / 최대 ${Math.round(ttftStat.max)}`,
          },
          { color: SERIES.red, label: `차단 합계 ${blockedTotal}` },
        ]}
      />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="none"
        role="img"
        tabIndex={0}
        aria-label={`최근 구간 시계열. 데이터 포인트 ${view.length}개. QPS, TTFT p95(ms), 차단 건수 추이. 마우스로 드래그하여 확대. 키보드: 포커스 후 +/= 확대, - 축소, 0 또는 Esc 초기화, ←/→ 로 값 읽기 이동.`}
        style={{ cursor: "crosshair", userSelect: "none" }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => { setDrag(null); hover.onMouseLeave(); }}
        onKeyDown={onKeyDown}
      >
        <title>QPS · TTFT p95 · 차단건수 시계열 (드래그 또는 +/-/0 키로 확대·축소, ←/→ 로 값 읽기)</title>
        {/* 가로 그리드 + 좌(QPS)/우(TTFT) 축라벨 — 공용 토큰 프리미티브 */}
        <HGrid
          padLeft={PAD.left}
          right={W - PAD.right}
          top={PAD.top}
          innerH={innerH}
          leftLabel={(g) => fmtAxis(qpsMax * (1 - g), qpsMax)}
          rightLabel={(g) => Math.round(ttftMax * (1 - g))}
        />

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
            <AxisText x={W - PAD.right} y={ttftThresholdY - 4} anchor="end">
              TTFT SLO {ttftThresholdMs}ms
            </AxisText>
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
        <path d={line((p) => p.ttft_p95_ms, yTtft)} fill="none" stroke={SERIES.teal} strokeWidth={1.6} />
        {/* QPS 라인 */}
        <path d={line((p) => p.qps, yQps)} fill="none" stroke={SERIES.primary} strokeWidth={1.8} />

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
            <AxisText key={i} x={x(i)} y={H - 6} anchor="middle">
              {new Date(p.ts).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </AxisText>
          ) : null,
        )}

        {/* 호버/포커스 크로스헤어 + readout(드래그 중 숨김) */}
        {activePoint && activeIndex != null && (
          <>
            <Crosshair
              x={x(activeIndex)}
              top={PAD.top}
              innerH={innerH}
              markers={[
                { y: yQps(activePoint.qps), color: SERIES.primary },
                { y: yTtft(activePoint.ttft_p95_ms), color: SERIES.teal },
              ]}
            />
            <ChartTooltip
              x={x(activeIndex)}
              viewW={W}
              top={PAD.top}
              innerH={innerH}
              title={new Date(activePoint.ts).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
              rows={[
                { label: "QPS", value: fmtAxis(activePoint.qps, qpsMax), color: SERIES.primary },
                { label: "TTFT p95", value: `${Math.round(activePoint.ttft_p95_ms)}ms`, color: SERIES.teal },
                { label: "차단", value: String(activePoint.blocked), color: SERIES.red },
              ]}
            />
          </>
        )}
      </svg>
    </div>
  );
}
