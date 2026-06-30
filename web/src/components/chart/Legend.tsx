import type { ReactNode } from "react";

// 공용 범례 — 기존 .chart-legend / .dot CSS 재사용(IMP-25).
export function Legend({ items }: { items: { label: ReactNode; color: string }[] }) {
  return (
    <div className="chart-legend">
      {items.map((it, i) => (
        <span key={i}>
          <span className="dot" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
