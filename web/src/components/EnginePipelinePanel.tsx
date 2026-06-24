import { useState } from "react";
import type { EnginePipeline } from "../api/types";

// P4-3 엔진 파이프라인 분해 — queue→prefill→decode 색분할.
// 평균 요청의 단계별 지연을 Waterfall(가로 누적 막대) 또는 Tree(중첩 단계) 로 표시.
// 개별 분산 트레이스(victoria-traces)는 미수집 → 집계 분해로 제공(스팬당 백분위는 후속).

const KIND_COLOR: Record<string, string> = {
  proxy: "var(--border-strong)",
  route: "var(--blue)",
  queue: "var(--amber)",
  prefill: "var(--primary)",
  decode: "var(--teal)",
  network: "var(--text-faint)",
};

function color(kind: string): string {
  return KIND_COLOR[kind] ?? "var(--primary)";
}

export default function EnginePipelinePanel({ pipeline }: { pipeline: EnginePipeline }) {
  const [view, setView] = useState<"waterfall" | "tree">("waterfall");
  const stages = pipeline.stages.filter((s) => s.avg_ms > 0);
  const total = pipeline.total_ms || stages.reduce((s, x) => s + x.avg_ms, 0);
  if (stages.length === 0) {
    return (
      <div className="card">
        <div className="card-head"><h3>엔진 파이프라인 분해</h3></div>
        <p className="rank-empty">아직 집계된 요청 지연이 없습니다. 플레이그라운드에서 요청을 보내보세요.</p>
      </div>
    );
  }
  return (
    <div className="card eng-pipe">
      <div className="card-head">
        <h3>엔진 파이프라인 분해</h3>
        <span className="info" title="평균 요청의 단계별 지연. queue(대기)→prefill(TTFT)→decode(생성) 색분할. dynamo_frontend_stage_duration / request_plane_queue / TTFT / request_duration 실측.">ⓘ</span>
        <span className="spacer" />
        <div className="seg-toggle" role="tablist" aria-label="파이프라인 보기 전환">
          <button type="button" role="tab" aria-selected={view === "waterfall"} className={view === "waterfall" ? "on" : ""} onClick={() => setView("waterfall")}>Waterfall</button>
          <button type="button" role="tab" aria-selected={view === "tree"} className={view === "tree" ? "on" : ""} onClick={() => setView("tree")}>Tree</button>
        </div>
      </div>

      <div className="eng-legend">
        <span><b style={{ color: "var(--amber)" }}>큐</b> {pipeline.queue_ms}ms</span>
        <span><b style={{ color: "var(--primary)" }}>Prefill</b> {pipeline.prefill_ms}ms</span>
        <span><b style={{ color: "var(--teal)" }}>Decode</b> {pipeline.decode_ms}ms</span>
        <span className="eng-total">합계 ≈ {total.toFixed(0)}ms</span>
      </div>

      {view === "waterfall" ? (
        <>
          <div className="eng-bar" role="img" aria-label="엔진 파이프라인 누적 막대">
            {stages.map((s) => (
              <span
                key={s.name}
                className="eng-seg"
                style={{ width: `${(s.avg_ms / total) * 100}%`, background: color(s.kind) }}
                title={`${s.name} · ${s.avg_ms}ms (${Math.round((s.avg_ms / total) * 100)}%)`}
              />
            ))}
          </div>
          <div className="eng-stages">
            {stages.map((s) => (
              <div className="eng-stage" key={s.name}>
                <span className="eng-dot" style={{ background: color(s.kind) }} />
                <span className="eng-name">{s.name}</span>
                <span className="eng-ms">{s.avg_ms}ms</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <ul className="eng-tree">
          {stages.map((s, i) => (
            <li key={s.name} className="eng-tree-row" style={{ marginLeft: `${i * 14}px` }}>
              <span className="eng-tree-bar" style={{ width: `${Math.max((s.avg_ms / total) * 220, 4)}px`, background: color(s.kind) }} />
              <span className="eng-name">{s.name}</span>
              <span className="eng-ms">{s.avg_ms}ms</span>
            </li>
          ))}
        </ul>
      )}

      {!pipeline.has_traces && (
        <p className="slide-note" style={{ marginTop: "var(--sp-3)" }}>
          위는 <b>평균 요청</b>의 단계 분해(실측 집계)입니다. 개별 요청별 gateway→router→engine 분산 스팬 트리는 victoria-traces(OTLP) 수집 후 활성화됩니다.
        </p>
      )}
    </div>
  );
}
