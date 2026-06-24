// 미니 스파크라인 — KPI 카드 안에 추세를 한 줄로. 의존성 없이 SVG.
// Datadog Query Value 위젯의 배경 스파크라인 패턴(상용SW-화면UIUX-리서치 P4-0).
export default function Sparkline({
  values,
  color = "var(--primary)",
  width = 72,
  height = 22,
  area = true,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  area?: boolean;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 1.5;
  const innerH = height - pad * 2;
  const x = (i: number) => (width * i) / (values.length - 1);
  const y = (v: number) => pad + innerH * (1 - (v - min) / span);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const fill = `${line} L${width},${height} L0,${height} Z`;
  const lastUp = values[values.length - 1] >= values[0];
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {area && <path d={fill} fill={color} opacity={0.1} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={1.8} fill={color} opacity={lastUp ? 1 : 0.6} />
    </svg>
  );
}
