import type { ReactNode } from "react";
import Sparkline from "./Sparkline";

// IMP-44 — KPI stat-mini 통합: 큰 메트릭 + 인라인 델타 배지 + 우하단 미니 스파크라인 + 임계 톤.
// Datadog Query Value / Vercel Analytics 카드의 밀도·즉시성 패턴. 델타/스파크는 값이 있을 때만.
export type StatTone = "green" | "red" | "amber";

const TONE_COLOR: Record<StatTone, string> = {
  green: "var(--green)",
  red: "var(--red)",
  amber: "var(--amber)",
};

export interface StatMiniProps {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  /** 전기간 대비 변화율(%, 부호 포함). 있으면 ▲▼ 배지, 없으면 생략. */
  delta?: number;
  /** "좋은" 방향 — delta 색 결정(기본 up=좋음). 지연·차단 등 낮을수록 좋으면 "down". */
  deltaGood?: "up" | "down";
  /** 미니 스파크라인 데이터(최근 추세). 길이<2면 생략. */
  spark?: number[];
  /** 임계 도달 톤 — 좌측바 + 값 색. 없으면 중립. */
  tone?: StatTone;
  /** IMP-105 — 위젯 메타 id. 있으면 카드 루트에 data-widget-id 부착(어시스트 화면-컨텍스트). */
  widgetId?: string;
}

// 변화율 배지 — StatCard 의 Delta 규칙과 동일(방향×good → good/bad/flat).
function Delta({ delta, good = "up" }: { delta: number; good?: "up" | "down" }) {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return <span className="delta flat">＝ 0%</span>;
  const up = rounded > 0;
  const isGood = (up && good === "up") || (!up && good === "down");
  const aria = `전기간 대비 ${up ? "+" : "-"}${Math.abs(rounded)}% ${isGood ? "개선" : "악화"}`;
  return (
    <span className={`delta ${isGood ? "good" : "bad"}`} aria-label={aria}>
      <span aria-hidden="true">{up ? "▲" : "▼"} {Math.abs(rounded)}%</span>
    </span>
  );
}

export default function StatMini({ label, value, unit, sub, delta, deltaGood, spark, tone, widgetId }: StatMiniProps) {
  const hasSpark = Array.isArray(spark) && spark.length > 1;
  return (
    <div className={`card stat-mini${tone ? ` tone-${tone}` : ""}${hasSpark ? " has-spark" : ""}`} data-widget-id={widgetId}>
      <div className="sm-label">{label}</div>
      <div className="sm-val" style={tone ? { color: TONE_COLOR[tone] } : undefined}>
        {value}
        {unit && <span className="sm-unit">{unit}</span>}
        {typeof delta === "number" && <Delta delta={delta} good={deltaGood} />}
      </div>
      {sub != null && <div className="sm-sub">{sub}</div>}
      {hasSpark && (
        <div className="sm-spark" aria-hidden="true">
          <Sparkline values={spark} color={tone ? TONE_COLOR[tone] : "var(--primary)"} width={64} height={20} />
        </div>
      )}
    </div>
  );
}
