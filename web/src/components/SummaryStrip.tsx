import type { ReactNode } from "react";

// 리스트 상단 요약 칩 줄 — 테이블 위 한 줄로 "전체 상태"를 먼저 보여준다(요약 우선 + 빈 공간 완화).
export interface SummaryItem {
  label: string;
  value: ReactNode;
  tone?: "green" | "amber" | "red" | "default";
}

export default function SummaryStrip({ items }: { items: SummaryItem[] }) {
  return (
    <div className="summary-strip">
      {items.map((it) => (
        <div key={it.label} className={`summary-chip ${it.tone ?? "default"}`}>
          <span className="sc-val">{it.value}</span>
          <span className="sc-label">{it.label}</span>
        </div>
      ))}
    </div>
  );
}
