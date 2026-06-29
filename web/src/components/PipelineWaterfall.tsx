import { useState } from "react";
import type { ProxyStats } from "../api/types";

// 평균 요청 타이밍 — 워터폴(지속시간 비례 막대) ↔ 트리(단계 계층) 토글.
// Datadog/Langfuse 트레이스 워터폴 패턴(상용SW-화면UIUX-리서치 P4-3) + EnginePipelinePanel 과 동일 토글 패턴(O-10).
// ※개별 요청 스팬 트리(queue→prefill→decode 분할)는 victoria-traces 수집 후(🟠).
interface Stage {
  label: string;
  ms: number;
  color: string;
  fabrix: boolean;
}

export default function PipelineWaterfall({ stats }: { stats: ProxyStats }) {
  const [view, setView] = useState<"waterfall" | "tree">("waterfall");
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
        <div className="seg-toggle" role="tablist" aria-label="타이밍 표시 방식" style={{ marginLeft: "auto", marginRight: "var(--sp-3)" }}>
          <button type="button" role="tab" aria-selected={view === "waterfall"} className={view === "waterfall" ? "active" : ""} onClick={() => setView("waterfall")}>워터폴</button>
          <button type="button" role="tab" aria-selected={view === "tree"} className={view === "tree" ? "active" : ""} onClick={() => setView("tree")}>트리</button>
        </div>
        <span className="waterfall-note">FABRIX 오버헤드 {Math.round(stats.overhead_perc * 100)}%</span>
      </div>

      {view === "waterfall" && stages.map((st) => {
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

      {/* 트리: 요청 처리 순서를 계층(들여쓰기)으로. 각 단계 = 소요시간 + 전체 대비 % */}
      {view === "tree" && (
        <div style={{ padding: "var(--sp-2) 0" }}>
          {stages.map((st, i) => {
            const perc = Math.round((st.ms / total) * 100);
            return (
              <div key={st.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", paddingLeft: 4 + i * 18, fontSize: "var(--fs-sm)" }}>
                <span aria-hidden="true" style={{ color: "var(--text-faint)" }}>{i === 0 ? "▸" : "└"}</span>
                <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: st.color, flex: "none" }} />
                <span style={{ color: "var(--text)" }}>{st.label}</span>
                {st.fabrix && <span className="wf-badge">FABRIX</span>}
                <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{st.ms}ms · {perc}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
