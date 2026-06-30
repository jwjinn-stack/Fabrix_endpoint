// 수직 크로스헤어 + 시리즈 마커(IMP-25). 토큰 색만 사용.
export function Crosshair({
  x,
  top,
  innerH,
  markers = [],
}: {
  x: number;
  top: number;
  innerH: number;
  markers?: { y: number; color: string }[];
}) {
  return (
    <g className="chart-crosshair" pointerEvents="none">
      <line
        className="chart-crosshair-line"
        x1={x}
        y1={top}
        x2={x}
        y2={top + innerH}
        stroke="var(--text-faint)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      {markers.map((m, i) => (
        <circle
          key={i}
          className="chart-crosshair-marker"
          cx={x}
          cy={m.y}
          r={3}
          fill="var(--surface)"
          stroke={m.color}
          strokeWidth={2}
        />
      ))}
    </g>
  );
}
