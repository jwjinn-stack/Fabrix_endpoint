import type { ReactNode } from "react";
import type { UsageTrendPoint } from "../api/types";
import InfoTip from "./InfoTip";

// P4-4 사용량 추세 + forecast 구간 — 과거 실측 라인 + 선형회귀 외삽(점선 + 불확실 밴드).
// 의존성 없이 SVG. metric=요청수 또는 토큰.
const W = 1000;
const H = 200;
const PAD = { top: 16, right: 16, bottom: 24, left: 48 };

// 최소제곱 선형회귀 → 기울기/절편.
function linreg(ys: number[]): { m: number; b: number } {
  const n = ys.length;
  if (n < 2) return { m: 0, b: ys[0] ?? 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { m: 0, b: sy / n };
  const m = (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  return { m, b };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export default function UsageTrendChart({
  points,
  metric = "requests",
  headerRight,
}: {
  points: UsageTrendPoint[];
  metric?: "requests" | "tokens";
  headerRight?: ReactNode;
}) {
  if (points.length < 3) {
    return (
      <div className="card">
        <div className="card-head"><h3>사용량 추세 · forecast</h3></div>
        <p className="rank-empty">추세를 그리기에 데이터 포인트가 부족합니다(최소 3구간). 사용량이 누적되면 표시됩니다.</p>
      </div>
    );
  }
  const ys = points.map((p) => (metric === "tokens" ? p.tokens : p.requests));
  const { m, b } = linreg(ys);
  // 과거 길이의 30%(최소 2)만큼 외삽.
  const fcastN = Math.max(2, Math.round(points.length * 0.3));
  const forecast: number[] = [];
  for (let i = 0; i < fcastN; i++) {
    forecast.push(Math.max(0, m * (points.length + i) + b));
  }
  // 잔차 표준편차로 불확실 밴드.
  const resid = ys.map((y, i) => y - (m * i + b));
  const sd = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / Math.max(resid.length - 1, 1));

  const allMax = Math.max(...ys, ...forecast.map((f, i) => f + 1.96 * sd * Math.sqrt(1 + i / fcastN)), 1);
  const totalLen = points.length + fcastN;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (innerW * i) / (totalLen - 1);
  const y = (v: number) => PAD.top + innerH * (1 - v / allMax);

  const histLine = ys.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const fcastLine = forecast
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(points.length - 1 + (i === 0 ? 0 : i)).toFixed(1)},${y(i === 0 ? ys[ys.length - 1] : v).toFixed(1)}`)
    .join(" ");
  // 밴드 폴리곤(상단 → 하단).
  const bandTop = forecast.map((v, i) => `${x(points.length + i).toFixed(1)},${y(v + 1.96 * sd).toFixed(1)}`);
  const bandBot = forecast.map((v, i) => `${x(points.length + i).toFixed(1)},${y(Math.max(0, v - 1.96 * sd)).toFixed(1)}`).reverse();
  const bandPoly = [...bandTop, ...bandBot].join(" ");

  const trendUp = m > 0;
  const projected = forecast[forecast.length - 1];

  return (
    <div className="card chart-card">
      <div className="card-head" style={{ flexWrap: "wrap", rowGap: "var(--sp-2)" }}>
        <h3>사용량 추세 · forecast ({metric === "tokens" ? "토큰" : "요청"})</h3>
        <InfoTip>과거 실측(실선)에 최소제곱 선형회귀를 적합해 미래 구간을 외삽(점선). 음영은 95% 예측 밴드(잔차 표준편차).</InfoTip>
        <span className="updated">
          추세 {trendUp ? "▲ 증가" : m < 0 ? "▼ 감소" : "＝ 평탄"} · 예상 {fmt(projected)}
        </span>
        <span className="spacer" />
        {headerRight}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" role="img" aria-label="사용량 추세 및 forecast">
        {[0, 0.5, 1].map((g) => {
          const yy = PAD.top + innerH * g;
          return (
            <g key={g}>
              <line x1={PAD.left} y1={yy} x2={W - PAD.right} y2={yy} stroke="var(--grid-line)" strokeWidth={1} />
              <text x={PAD.left - 6} y={yy + 3} fontSize={10} fill="var(--text-faint)" textAnchor="end">{fmt(allMax * (1 - g))}</text>
            </g>
          );
        })}
        {/* forecast 시작 경계선 */}
        <line x1={x(points.length - 1)} y1={PAD.top} x2={x(points.length - 1)} y2={PAD.top + innerH} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="2 3" />
        <text x={x(points.length - 1) + 4} y={PAD.top + 10} fontSize={9} fill="var(--text-faint)">현재</text>
        {/* 예측 밴드 */}
        {sd > 0 && <polygon points={bandPoly} fill="var(--primary)" opacity={0.1} />}
        {/* 과거 실측 */}
        <path d={histLine} fill="none" stroke="var(--primary)" strokeWidth={1.8} />
        {/* forecast 점선 */}
        <path d={fcastLine} fill="none" stroke="var(--primary)" strokeWidth={1.6} strokeDasharray="5 4" opacity={0.8} />
      </svg>
    </div>
  );
}
