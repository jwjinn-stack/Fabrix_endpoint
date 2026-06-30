import type { ReactNode } from "react";

// 토큰 폰트/색을 강제하는 축 텍스트 래퍼(IMP-25).
// fontSize 하드코딩(9/10) 대신 .chart-axis-text 클래스가 var(--fs-xs)/var(--text-dim) 을 부여.
export function AxisText({
  x,
  y,
  children,
  anchor = "start",
  dy,
}: {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
  dy?: number;
}) {
  return (
    <text x={x} y={y} dy={dy} className="chart-axis-text" textAnchor={anchor}>
      {children}
    </text>
  );
}
