import type { ReactNode } from "react";
import Sparkline from "./Sparkline";
import InfoTip from "./InfoTip";

export type Tone = "green" | "red" | "amber" | "pink" | "teal";

export interface Metric {
  label: string;
  value: ReactNode;
  unit?: string;
  /** 0..1 이면 숫자 아래 사용량 바 표시 */
  bar?: number;
  /** 사용량 바 채움 색 (기본 오렌지) */
  barColor?: string;
  /** 숫자 색 강조 */
  tone?: Tone;
  /** 전기간 대비 변화율(%, 부호 포함). 화살표+색으로 표기. */
  delta?: number;
  /** 변화 방향 중 "좋은" 쪽 — delta 색 결정(기본 up=좋음). 지연·차단 등은 "down". */
  deltaGood?: "up" | "down";
  /** 미니 스파크라인 데이터(최근 추세). */
  spark?: number[];
}

const TONE_COLOR: Record<Tone, string> = {
  green: "var(--green)",
  red: "var(--red)",
  amber: "var(--amber)",
  pink: "var(--pink)",
  teal: "var(--teal)",
};

// 변화율 화살표 — 좋은 방향이면 green, 나쁜 방향이면 red, 0이면 무채색.
function Delta({ delta, good = "up" }: { delta: number; good?: "up" | "down" }) {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return <span className="delta flat">＝ 0%</span>;
  const up = rounded > 0;
  const isGood = (up && good === "up") || (!up && good === "down");
  // 비필수 보강정보 — 툴팁(title=) 대신 말로 풀어쓴 aria-label, 화살표 글리프는 aria-hidden.
  const aria = `전기간 대비 ${up ? "+" : "-"}${Math.abs(rounded)}% ${isGood ? "개선" : "악화"}`;
  return (
    <span className={`delta ${isGood ? "good" : "bad"}`} aria-label={aria}>
      <span aria-hidden="true">{up ? "▲" : "▼"} {Math.abs(rounded)}%</span>
    </span>
  );
}

// Backend.AI 대시보드 카드 패턴: 카드 헤더(제목 + ⓘ + ⟳) + 큰 숫자 메트릭 블록들.
export default function StatCard({
  title,
  metrics,
  info,
  link,
  onLink,
  onRefresh,
}: {
  title: string;
  metrics: Metric[];
  info?: string;
  link?: string;
  onLink?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        {info && <InfoTip>{info}</InfoTip>}
        <span className="spacer" />
        {link && (
          <button type="button" className="link" onClick={onLink}>
            {link}
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            className="act"
            onClick={onRefresh}
            title={`${title} 새로고침`}
            aria-label={`${title} 새로고침`}
          >
            <span className="spin" aria-hidden="true">
              ⟳
            </span>
          </button>
        )}
      </div>
      <div className="metrics">
        {metrics.map((m) => (
          <div className={`metric ${m.tone ?? ""}`} key={m.label}>
            <div className="num">
              {m.value}
              {m.unit && <span className="unit">{m.unit}</span>}
              {typeof m.delta === "number" && <Delta delta={m.delta} good={m.deltaGood} />}
            </div>
            {m.spark && m.spark.length > 1 && (
              <Sparkline values={m.spark} color={m.tone ? TONE_COLOR[m.tone] : "var(--primary)"} />
            )}
            {typeof m.bar === "number" && (
              <div className="usage">
                <span
                  style={{
                    width: `${Math.min(Math.max(m.bar, 0), 1) * 100}%`,
                    background: m.barColor ?? "var(--primary)",
                  }}
                />
              </div>
            )}
            <div className="lbl">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
