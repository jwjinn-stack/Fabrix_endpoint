import type { LatencyBreakdown } from "../api/types";

// 추론 지연 3분할 (P4-1, Grafana vLLM): TTFT / TPOT / E2E 각 p50/p95/p99 게이지.
// 각 지표를 자기 p99 기준으로 정규화한 가로 게이지로 표시, SLO 임계 초과는 강조색.

interface Split {
  label: string;
  hint: string;
  p50: number;
  p95: number;
  p99: number;
  /** p95 SLO 임계(ms) — 초과 시 amber/red */
  slo: number;
}

function tone(p95: number, slo: number): string {
  if (slo <= 0) return "var(--primary)";
  if (p95 > slo) return "var(--red)";
  if (p95 > slo * 0.8) return "var(--amber)";
  return "var(--primary)";
}

function Gauge({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="lat-gauge" title={`${Math.round(value)}ms`}>
      <span style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

function SplitRow({ s }: { s: Split }) {
  const max = Math.max(s.p99, s.slo, 1);
  const c = tone(s.p95, s.slo);
  return (
    <div className="lat-row">
      <div className="lat-head">
        <span className="lat-label" title={s.hint}>
          {s.label}
        </span>
        <span className="lat-vals">
          <em>p50</em> {Math.round(s.p50)} · <em>p95</em>{" "}
          <b style={{ color: c }}>{Math.round(s.p95)}</b> · <em>p99</em> {Math.round(s.p99)} ms
        </span>
      </div>
      <div className="lat-gauges">
        <Gauge value={s.p50} max={max} color="var(--border-strong)" />
        <Gauge value={s.p95} max={max} color={c} />
        <Gauge value={s.p99} max={max} color="var(--text-faint)" />
      </div>
      {s.slo > 0 && (
        <div className="lat-slo" style={{ left: `${Math.min((s.slo / max) * 100, 100)}%` }} title={`SLO ${s.slo}ms`} />
      )}
    </div>
  );
}

export default function LatencyPanel({
  latency,
  onRefresh,
}: {
  latency: LatencyBreakdown;
  onRefresh?: () => void;
}) {
  const splits: Split[] = [
    {
      label: "TTFT",
      hint: "Time To First Token — 첫 토큰까지 지연 (체감 응답성). dynamo_frontend_time_to_first_token",
      p50: latency.ttft_p50_ms,
      p95: latency.ttft_p95_ms,
      p99: latency.ttft_p99_ms,
      slo: 500,
    },
    {
      label: "TPOT",
      hint: "Time Per Output Token — 토큰당 생성 지연 (스트리밍 속도). inter_token_latency",
      p50: latency.tpot_p50_ms,
      p95: latency.tpot_p95_ms,
      p99: latency.tpot_p99_ms,
      slo: 50,
    },
    {
      label: "E2E",
      hint: "End-to-End — 요청 전체 지연. dynamo_frontend_request_duration",
      p50: latency.e2e_p50_ms,
      p95: latency.e2e_p95_ms,
      p99: latency.e2e_p99_ms,
      slo: 0,
    },
  ];
  return (
    <div className="card lat-panel">
      <div className="card-head">
        <h3>추론 지연 분해</h3>
        <span className="info" title="TTFT(첫 토큰)·TPOT(토큰당)·E2E(전체) 3분할. 게이지는 좌→우 p50/p95/p99, 점선은 SLO 임계.">
          ⓘ
        </span>
        <span className="spacer" />
        {onRefresh && (
          <button type="button" className="act" onClick={onRefresh} aria-label="추론 지연 새로고침">
            <span className="spin" aria-hidden="true">⟳</span>
          </button>
        )}
      </div>
      <div className="lat-body">
        {splits.map((s) => (
          <SplitRow key={s.label} s={s} />
        ))}
      </div>
    </div>
  );
}
