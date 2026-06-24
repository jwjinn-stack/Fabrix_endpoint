import type { ProxyStats } from "../api/types";

// 평균 요청 타이밍 워터폴 — 클라이언트→가드레일→귀속/쿼터→엔진을 지속시간 비례 막대로.
// Datadog/Langfuse 트레이스 워터폴 패턴(상용SW-화면UIUX-리서치 P4-3).
// ※개별 요청 스팬 트리(queue→prefill→decode 분할)는 victoria-traces 수집 후(🟠).
interface Stage {
  label: string;
  ms: number;
  color: string;
  fabrix: boolean;
}

export default function PipelineWaterfall({ stats }: { stats: ProxyStats }) {
  // 귀속·쿼터는 인메모리라 ~0ms — 표시용 최소값.
  const attrMs = Math.max(0, Math.round((stats.avg_guard_ms + stats.avg_upstream_ms) * 0.01));
  const stages: Stage[] = [
    { label: "가드레일 (Semantic Router)", ms: stats.avg_guard_ms, color: "var(--primary)", fabrix: true },
    { label: "귀속 · 쿼터", ms: attrMs, color: "var(--teal)", fabrix: true },
    { label: "엔진 (Dynamo / vLLM)", ms: stats.avg_upstream_ms, color: "var(--blue)", fabrix: false },
  ];
  const total = stages.reduce((s, x) => s + x.ms, 0) || 1;
  let acc = 0;

  return (
    <div className="waterfall">
      <div className="waterfall-head">
        <span>평균 요청 타이밍 분해 · 총 {total}ms</span>
        <span className="waterfall-note">FABRIX 오버헤드 {Math.round(stats.overhead_perc * 100)}%</span>
      </div>
      {stages.map((st) => {
        const left = (acc / total) * 100;
        const width = (st.ms / total) * 100;
        acc += st.ms;
        return (
          <div className="wf-row" key={st.label}>
            <span className="wf-label" title={st.label}>
              {st.fabrix && <span className="wf-badge">FABRIX</span>}
              {st.label}
            </span>
            <div className="wf-track">
              <span
                className="wf-bar"
                style={{ left: `${left}%`, width: `${Math.max(width, 0.6)}%`, background: st.color }}
                title={`${st.ms}ms`}
              />
            </div>
            <span className="wf-ms">{st.ms}ms</span>
          </div>
        );
      })}
    </div>
  );
}
