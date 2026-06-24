import { useCallback, useEffect, useState } from "react";
import { fetchEnginePipeline, fetchGuardAudit, fetchProxyStats } from "../api/client";
import type { EnginePipeline, GuardAuditRow, ProxyStats } from "../api/types";
import StatCard from "../components/StatCard";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import PipelineWaterfall from "../components/PipelineWaterfall";
import EnginePipelinePanel from "../components/EnginePipelinePanel";

const REFRESH_MS = 10_000;
const nf = new Intl.NumberFormat("ko-KR");
const pct = (v: number) => `${Math.round(v * 100)}%`;

function fmtTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString("ko-KR", { hour12: false });
}

function decisionTag(d: string) {
  if (d === "blocked") return <span className="tag tag-red">차단</span>;
  if (d === "flagged") return <span className="tag tag-amber">표시</span>;
  return <span className="tag tag-green">통과</span>;
}

// 트래픽/프록시 뷰 (문서 4-5). 모든 추론이 우리 프록시를 통과 = 트레이스 지점.
// 파이프라인(클라이언트→가드레일→귀속/쿼터→엔진) + 프록시 실측 지연/오버헤드 + 최근 요청 스트림.
export default function Traffic() {
  const [stats, setStats] = useState<ProxyStats | null>(null);
  const [pipeline, setPipeline] = useState<EnginePipeline | null>(null);
  const [stream, setStream] = useState<GuardAuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<GuardAuditRow | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [s, p, g] = await Promise.all([
        fetchProxyStats(600, signal),
        fetchEnginePipeline(signal),
        fetchGuardAudit("1h", {}, signal),
      ]);
      setStats(s);
      setPipeline(p);
      setStream(g.rows.slice(0, 20));
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    const id = setInterval(() => load(), REFRESH_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, [load]);

  const s = stats;

  return (
    <>
      <div className="page-head">
        <h1>트래픽 / 프록시</h1>
        <span className="crumb">관제 / 트래픽</span>
        <div className="spacer" />
        <button type="button" className="refresh-btn" onClick={() => load()} aria-label="트래픽 새로고침">
          <span className="spin" aria-hidden="true">⟳</span>
          새로고침
        </button>
      </div>

      {error && <div className="state error" role="alert">트래픽 지표를 불러오지 못했습니다. ({error})</div>}
      {!error && loading && !stats && <div className="state" role="status">트래픽 지표를 수집하는 중…</div>}

      {/* 파이프라인 다이어그램 */}
      <div className="card pipeline">
        <div className="card-head"><h3>추론 파이프라인 (모든 요청이 FABRIX 프록시 통과)</h3></div>
        <div className="pipe">
          <div className="pipe-node">클라이언트</div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-node pipe-fabrix">가드레일<br /><small>{s ? `${s.avg_guard_ms}ms` : "—"}</small></div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-node pipe-fabrix">귀속 · 쿼터</div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-node">엔진 (Dynamo)<br /><small>{s ? `${s.avg_upstream_ms}ms` : "—"}</small></div>
        </div>
        {s && <PipelineWaterfall stats={s} />}
      </div>

      {/* P4-3 엔진 파이프라인 분해 — queue→prefill→decode 색분할 + Tree/Waterfall 토글 */}
      {pipeline && <EnginePipelinePanel pipeline={pipeline} />}

      {s && (
        <div className="cards-5">
          <StatCard title="처리량" info={`최근 ${Math.round(s.window_sec / 60)}분 윈도우`} metrics={[{ label: "QPM", value: nf.format(s.qpm) }, { label: "요청", value: nf.format(s.total) }]} />
          <StatCard title="가드레일 지연" info="Semantic Router 분류 평균" metrics={[{ label: "avg", value: s.avg_guard_ms, unit: "ms" }]} />
          <StatCard title="엔진 지연" info="업스트림 추론 왕복" metrics={[{ label: "avg", value: s.avg_upstream_ms, unit: "ms" }, { label: "p95", value: s.p95_upstream_ms, unit: "ms" }]} />
          <StatCard title="프록시 오버헤드" info="가드레일/(가드레일+엔진)" metrics={[{ label: "비율", value: pct(s.overhead_perc), tone: s.overhead_perc > 0.4 ? "amber" : "green", bar: s.overhead_perc, barColor: s.overhead_perc > 0.4 ? "var(--amber)" : "var(--green)" }]} />
          <StatCard title="차단율" info="가드레일 차단 비율" metrics={[{ label: "block", value: pct(s.block_rate), tone: "red", bar: s.block_rate, barColor: "var(--red)" }]} />
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>최근 요청 스트림</h3>
          <span className="info" title="프록시를 통과한 최근 요청(증적 기반). 원문/PII 비저장.">ⓘ</span>
          <span className="spacer" />
          <span className="updated">{stream.length}건</span>
        </div>
        {stream.length === 0 ? (
          <div className="empty">최근 1시간 요청이 없습니다. 플레이그라운드에서 요청을 보내보세요.</div>
        ) : (
          <table className="usage-table">
            <thead>
              <tr>
                <th>시각</th>
                <th>앱</th>
                <th>모델</th>
                <th>판정</th>
                <th>유형</th>
              </tr>
            </thead>
            <tbody>
              {stream.map((r) => (
                <tr key={r.event_id} className="clickable" onClick={() => setDetail(r)}>
                  <td>{fmtTime(r.ts)}</td>
                  <td>{r.app_id}</td>
                  <td>{r.model}</td>
                  <td>{decisionTag(r.decision)}</td>
                  <td>{r.guard_types?.length ? r.guard_types.map((t) => (t === "pii" ? "PII" : t === "jailbreak" ? "JB" : t)).join(", ") : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SlidePanel
        open={!!detail}
        title="요청 상세"
        subtitle={detail ? `${fmtTime(detail.ts)} · ${detail.model}` : undefined}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <DetailRow label="시각">{fmtTime(detail.ts)}</DetailRow>
            <DetailRow label="판정">{decisionTag(detail.decision)}</DetailRow>
            <DetailRow label="유형">{detail.guard_types?.length ? detail.guard_types.join(", ") : "—"}</DetailRow>
            <DetailRow label="PII 유형">{detail.pii_subtypes?.length ? detail.pii_subtypes.join(", ") : "—"}</DetailRow>
            <DetailRow label="JB 신뢰도">{detail.jb_confidence > 0 ? `${(detail.jb_confidence * 100).toFixed(1)}%` : "—"}</DetailRow>
            <DetailRow label="앱 / 부서">{`${detail.app_id} / ${detail.dept_id}`}</DetailRow>
            <DetailRow label="모델">{detail.model}</DetailRow>
            <DetailRow label="API 키"><code>{detail.api_key_id}</code></DetailRow>
            <DetailRow label="사용자(비식별)"><code>{detail.user_ref}</code></DetailRow>
            <DetailRow label="trace_id"><code>{detail.trace_id}</code></DetailRow>
            <DetailRow label="정책 버전">{detail.policy_version}</DetailRow>
            <p className="slide-note">프록시를 통과한 요청 증적(원문/PII 비저장). 개별 요청의 queue→prefill→decode 스팬 분해는 victoria-traces 수집 후 제공됩니다.</p>
          </>
        )}
      </SlidePanel>
    </>
  );
}
