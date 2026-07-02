import type { ReactNode } from "react";
import Sparkline from "./Sparkline";
import InfoTip from "./InfoTip";
// IMP-105 — 위젯 메타(선언적). data-widget-id 부착 + info 미지정 시 whatItShows passive 노출.
import { widgetMeta } from "./widgetMeta";
// IMP-104 — explain-this: 메트릭 라벨을 콕 집어 물어볼 수 있게(키보드 우선 data-explain-key).
import ExplainThis from "./ExplainThis";

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
  /** IMP-104 — explain-this glossary key(예: "ttft"). 있으면 라벨이 콕 집어 물어보기 어포던스(⌘ 키보드 우선). */
  explainKey?: string;
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
  widgetId,
}: {
  title: string;
  metrics: Metric[];
  info?: string;
  link?: string;
  onLink?: () => void;
  onRefresh?: () => void;
  /** IMP-105 — 위젯 메타 id(예: "dashboard.quality"). 있으면 data-widget-id 부착 + passive 설명 노출. */
  widgetId?: string;
}) {
  // IMP-105 — info 를 명시하지 않았고 위젯 메타가 있으면 whatItShows 를 InfoTip 으로 보조 노출(사람 self-doc).
  const meta = widgetId ? widgetMeta(widgetId) : undefined;
  const tip = info ?? meta?.whatItShows;
  return (
    <div className="card" data-widget-id={widgetId}>
      <div className="card-head">
        <h3>{title}</h3>
        {tip && <InfoTip>{tip}</InfoTip>}
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
          <div
            className={`metric ${m.tone ?? ""}${m.spark && m.spark.length > 1 ? " has-spark" : ""}`}
            key={m.label}
          >
            {/* IMP-27: 스파크라인을 메트릭 블록 하단 풀블리드 배경으로 격하 — 라벨/숫자와 흐름 분리. */}
            {m.spark && m.spark.length > 1 && (
              <div className="metric-spark" aria-hidden="true">
                <Sparkline values={m.spark} color={m.tone ? TONE_COLOR[m.tone] : "var(--primary)"} />
              </div>
            )}
            <div className="metric-body">
              <div className="num">
                {m.value}
                {m.unit && <span className="unit">{m.unit}</span>}
                {typeof m.delta === "number" && <Delta delta={m.delta} good={m.deltaGood} />}
              </div>
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
              {/* IMP-104 — explainKey 있으면 라벨을 콕 집어 물어보기 어포던스로(키보드 우선), 없으면 평문. */}
              {m.explainKey ? (
                <ExplainThis className="lbl explain-lbl" explainKey={m.explainKey} label={m.label} widgetId={widgetId}>
                  {m.label}
                </ExplainThis>
              ) : (
                <div className="lbl">{m.label}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
