import { SERIES } from "./chart";

// 미니 스파크라인 — KPI 카드 안에 추세를 한 줄로. 의존성 없이 SVG.
// Datadog Query Value 위젯의 배경 스파크라인 패턴(상용SW-화면UIUX-리서치 P4-0).
// IMP-25: 색 기본값을 공용 차트 팔레트(SERIES.primary)에 정렬.
export default function Sparkline({
  values,
  color = SERIES.primary,
  width = 72,
  height = 22,
  area = true,
  warnValue,
  critValue,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  area?: boolean;
  /** 있으면 y(warnValue) 위치에 주의(amber) 파선 수평선(임계 라인). Grafana threshold line 관례. */
  warnValue?: number;
  /** 있으면 y(critValue) 위치에 위험(red) 파선 수평선. */
  critValue?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 1.5;
  const innerH = height - pad * 2;
  const x = (i: number) => (width * i) / (values.length - 1);
  const y = (v: number) => pad + innerH * (1 - (v - min) / span);
  // 임계선은 그래프 세로 범위(pad..height-pad) 밖이면 가장자리로 clamp(항상 보이게).
  const yClamp = (v: number) => Math.min(height - pad, Math.max(pad, y(v)));
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
      {/* 임계 라인(선택) — 값 궤적 아래에 격하게, 색-only 아님(값 궤적 색이 상태를 함께 전달). */}
      {typeof warnValue === "number" && (
        <line
          className="spark-threshold spark-threshold-warn"
          x1={0}
          x2={width}
          y1={yClamp(warnValue).toFixed(1)}
          y2={yClamp(warnValue).toFixed(1)}
          stroke="var(--amber)"
          strokeWidth={0.75}
          strokeDasharray="2 2"
          opacity={0.55}
        />
      )}
      {typeof critValue === "number" && (
        <line
          className="spark-threshold spark-threshold-crit"
          x1={0}
          x2={width}
          y1={yClamp(critValue).toFixed(1)}
          y2={yClamp(critValue).toFixed(1)}
          stroke="var(--red)"
          strokeWidth={0.75}
          strokeDasharray="2 2"
          opacity={0.55}
        />
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={1.8} fill={color} opacity={lastUp ? 1 : 0.6} />
    </svg>
  );
}
