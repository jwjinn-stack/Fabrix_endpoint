import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSession, fetchSessions } from "../api/client";
import type { SessionDetail, SessionListReport, SessionTurn, TimeRange } from "../api/types";
import Badge, { type BadgeTone } from "../components/Badge";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import { SkeletonRows } from "../components/Skeleton";
import { useTableDensity, DensityToggle } from "../components/DensityToggle";
import ViewBar from "../components/ViewBar";
import { useUrlState, decodeState, strField, rangeField } from "../urlState";
import { useCap } from "../capabilities";
import { humanizeError } from "../utils/errors";

// IMP-24: 세션 화면도 기간·앱 필터를 URL 단일 출처로.
const SESSION_SCHEMA = { range: rangeField, app: strField("all") } as const;

const RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "최근 1시간" },
  { value: "6h", label: "최근 6시간" },
  { value: "24h", label: "최근 24시간" },
  { value: "7d", label: "최근 7일" },
];

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const fmtDur = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}분 ${s % 60}초` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
};
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const timeFmt = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour12: false });
const decTone = (d: string): BadgeTone => (d === "blocked" ? "red" : d === "flagged" ? "amber" : "green");

export default function Sessions() {
  const [st, patch] = useUrlState(SESSION_SCHEMA);
  const { range, app } = st;
  const setRange = (r: TimeRange) => patch({ range: r });
  const setApp = (v: string) => patch({ app: v });
  const applyView = (query: string) => patch(decodeState(SESSION_SCHEMA, query));
  const canSave = !useCap().caps.readonly;
  const { density, setDensity } = useTableDensity("sessions");
  const [data, setData] = useState<SessionListReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>([]);

  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const d = await fetchSessions(range, app, signal);
        setData(d);
        setError(null);
        if (app === "all") setApps([...new Set(d.sessions.map((s) => s.app_id))].sort());
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
      } finally {
        setLoading(false);
      }
    },
    [range, app],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    if (!selId) { setDetail(null); return; }
    const ctrl = new AbortController();
    setDetailLoading(true);
    fetchSession(selId, ctrl.signal).then(setDetail).catch(() => setDetail(null)).finally(() => setDetailLoading(false));
    return () => ctrl.abort();
  }, [selId]);

  const sessions = data?.sessions ?? [];
  const stats = useMemo(() => ({
    count: sessions.length,
    avgTurns: sessions.length ? (sessions.reduce((s, x) => s + x.turns, 0) / sessions.length).toFixed(1) : "0",
    cost: sessions.reduce((s, x) => s + x.total_cost_krw, 0),
    blocked: sessions.filter((x) => x.blocked > 0).length,
  }), [sessions]);

  return (
    <>
      <div className="page-head">
        <h1>대화 세션</h1>
        <span className="crumb">관제 / 세션</span>
        <div className="spacer" />
        <span className="updated">{data ? `${sessions.length}개 · ${data.source}` : "—"}</span>
        <DensityToggle density={density} onChange={setDensity} />
        <select className="range-select" value={range} onChange={(e) => setRange(e.target.value as TimeRange)}>
          {RANGES.map((r) => <option key={r.value} value={r.value}>기간: {r.label}</option>)}
        </select>
        <button type="button" className={`refresh-btn ${loading ? "is-loading" : ""}`} onClick={() => load()} disabled={loading} aria-label="세션 새로고침">
          <span className="spin" aria-hidden="true">⟳</span>새로고침
        </button>
      </div>

      <div className="cards-4">
        <div className="card stat-mini"><div className="sm-label">세션</div><div className="sm-val">{stats.count}<span className="sm-unit">개</span></div><div className="sm-sub">sessionId 로 묶인 멀티턴 대화</div></div>
        <div className="card stat-mini"><div className="sm-label">평균 턴</div><div className="sm-val">{stats.avgTurns}</div><div className="sm-sub">세션당 평균 요청 수</div></div>
        <div className="card stat-mini"><div className="sm-label">총 비용</div><div className="sm-val">₩{stats.cost.toLocaleString()}</div><div className="sm-sub">세션 누적 추정 비용</div></div>
        <div className="card stat-mini"><div className="sm-label">차단 포함 세션</div><div className="sm-val" style={{ color: stats.blocked ? "var(--red)" : "var(--green)" }}>{stats.blocked}</div><div className="sm-sub">가드레일 차단이 1건 이상</div></div>
      </div>

      <div className="card">
        <div className="filter-bar" role="group" aria-label="세션 필터">
          <label className="fb-field"><span>앱</span>
            <select value={app} onChange={(e) => setApp(e.target.value)}>
              <option value="all">전체</option>{apps.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          {app !== "all" && <button type="button" className="btn-ghost btn-sm" onClick={() => setApp("all")}>필터 초기화</button>}
          <span className="spacer" style={{ flex: 1 }} />
          <ViewBar page="sessions" canSave={canSave} onApply={applyView} />
        </div>

        {error && <div className="state error" role="alert">세션을 불러오지 못했습니다. ({error})</div>}
        {!error && loading && !data && <SkeletonRows rows={8} cols={6} />}
        {!error && data && sessions.length === 0 && <div className="state">조건에 맞는 세션이 없습니다.</div>}

        {sessions.length > 0 && (
          <div className="tbl-scroll">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="데이터 표 — 좌우 스크롤 가능">
            <table className={`usage-table density-${density}`}>
              <thead>
                <tr>
                  <th>세션</th><th>시작</th><th className="num">턴</th><th>사용자</th><th>앱</th>
                  <th>모델</th><th className="num">토큰</th><th className="num">비용</th><th className="num">길이</th><th>차단</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.session_id} className={`row-click ${selId === s.session_id ? "row-sel" : ""}`} tabIndex={0}
                    onClick={() => setSelId(s.session_id)} onKeyDown={(e) => { if (e.key === "Enter") setSelId(s.session_id); }}>
                    <td className="cell-dim"><code>{s.session_id}</code></td>
                    <td>{timeFmt(s.started_at)}</td>
                    <td className="num"><b>{s.turns}</b></td>
                    <td className="cell-dim">{s.user_id}</td>
                    <td>{s.app_id}</td>
                    <td className="cell-dim">{s.models.join(", ")}</td>
                    <td className="num">{fmtTok(s.total_tokens)}</td>
                    <td className="num">₩{s.total_cost_krw.toLocaleString()}</td>
                    <td className="num">{fmtDur(s.duration_ms)}</td>
                    <td>{s.blocked > 0 ? <Badge tone="red" dot>{s.blocked}건</Badge> : <Badge tone="green">없음</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      <SlidePanel
        open={!!selId}
        width={680}
        title={detail ? `세션 · ${detail.summary.turns}턴` : "세션 상세"}
        subtitle={selId ? <code className="trace-id">{selId}</code> : undefined}
        onClose={() => setSelId(null)}
      >
        {detailLoading && <div className="state" role="status">세션 턴을 불러오는 중…</div>}
        {detail && <SessionDetailView detail={detail} />}
      </SlidePanel>
    </>
  );
}

const REPLAY_MS = 1200; // 자동 재생 간격(턴당).

function SessionDetailView({ detail }: { detail: SessionDetail }) {
  const s = detail.summary;
  const turns = detail.turns;
  const last = turns.length - 1;

  // O-06 세션 리플레이: 현재 turn 인덱스 + 자동재생.
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
  };

  // 세션(detail)이 바뀌면 리플레이 상태 초기화 + 타이머 정리.
  useEffect(() => {
    setCur(0);
    setPlaying(false);
    return clearTimer;
  }, [detail.summary.session_id]);

  // 재생 중에는 REPLAY_MS 마다 다음 turn 으로. 끝에 닿으면 멈춤.
  useEffect(() => {
    if (!playing) { clearTimer(); return; }
    timerRef.current = window.setInterval(() => {
      setCur((c) => {
        if (c >= last) { setPlaying(false); return c; }
        return c + 1;
      });
    }, REPLAY_MS);
    return clearTimer;
  }, [playing, last]);

  // 컨트롤. 끝에서 ▶ 누르면 처음부터 다시.
  const togglePlay = () => {
    if (last <= 0) return;
    if (!playing && cur >= last) setCur(0);
    setPlaying((p) => !p);
  };
  const prev = () => { setPlaying(false); setCur((c) => Math.max(0, c - 1)); };
  const next = () => { setPlaying(false); setCur((c) => Math.min(last, c + 1)); };
  const jump = (i: number) => { setPlaying(false); setCur(i); };

  const cT = turns[cur];

  return (
    <>
      <div className="trace-summary">
        <DetailRow label="사용자">{s.user_id}</DetailRow>
        <DetailRow label="앱 / 부서">{s.app_id} · {s.dept_id}</DetailRow>
        <DetailRow label="모델">{s.models.join(", ")}</DetailRow>
        <DetailRow label="총 토큰">{s.total_tokens.toLocaleString()}</DetailRow>
        <DetailRow label="총 비용">₩{s.total_cost_krw.toLocaleString()}</DetailRow>
        <DetailRow label="세션 길이">{fmtDur(s.duration_ms)}</DetailRow>
      </div>

      {/* O-06 리플레이 컨트롤 */}
      <div
        className="sess-replay"
        style={{
          display: "flex", alignItems: "center", gap: "var(--sp-2)",
          padding: "var(--sp-2) var(--sp-3)", margin: "var(--sp-3) 0 var(--sp-2)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface-2)",
        }}
      >
        <button type="button" className="btn-ghost btn-sm" onClick={prev} disabled={cur === 0} aria-label="이전 턴">◀</button>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={togglePlay}
          disabled={last <= 0}
          aria-label={playing ? "일시정지" : cur >= last ? "처음부터 재생" : "재생"}
          title={playing ? "일시정지" : cur >= last ? "처음부터 다시 재생" : "재생"}
          style={{ minWidth: 36 }}
        >
          {playing ? "⏸" : cur >= last ? "↻" : "▶"}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={next} disabled={cur >= last} aria-label="다음 턴">▶|</button>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "var(--fs-sm)", color: "var(--text-dim)", minWidth: 52, textAlign: "center" }}>
          {cur + 1} / {turns.length}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, last)}
          value={cur}
          onChange={(e) => jump(Number(e.target.value))}
          aria-label="턴 타임트래블 스크럽"
          style={{ flex: 1, accentColor: "var(--primary)" }}
          disabled={last <= 0}
        />
      </div>

      {/* 현재 턴 메트릭 패널 */}
      {cT && (
        <div style={{ border: "1px solid var(--primary-weak)", borderLeft: "3px solid var(--primary)", borderRadius: "var(--radius-sm)", padding: "var(--sp-2) var(--sp-3)", marginBottom: "var(--sp-3)", background: "var(--surface)" }}>
          <div className="st-line1" style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <b>턴 {cur + 1}</b>
            <span className="st-time">{timeFmt(cT.ts)}</span>
            <span className="st-model">{cT.model}</span>
            <Badge tone={decTone(cT.decision)} dot>{cT.decision === "blocked" ? "차단" : cT.decision === "flagged" ? "표시" : "통과"}</Badge>
            {cT.status === "error" && <Badge tone="red" dot>에러</Badge>}
          </div>
          <div className="st-prompt" style={{ margin: "var(--sp-1) 0" }}>{cT.user_preview}</div>
          <div className="st-metrics">
            <span>TTFT {cT.ttft_ms}ms</span>
            <span>E2E {fmtMs(cT.total_ms)}</span>
            <span>{fmtTok(cT.prompt_tokens)}→{fmtTok(cT.completion_tokens)} tok</span>
            <span>₩{cT.cost_krw}</span>
            <code className="st-trace">{cT.trace_id}</code>
          </div>
        </div>
      )}

      <div className="sess-timeline-head">턴 타임라인 ({turns.length})</div>
      <ol className="sess-timeline">
        {turns.map((t: SessionTurn, i) => {
          // 진행 느낌: 현재=강조, 지나간 턴=약간 흐림, 이후 턴=더 흐림.
          const opacity = i === cur ? 1 : i < cur ? 0.55 : 0.35;
          const isCur = i === cur;
          return (
            <li
              key={t.trace_id}
              className={`sess-turn ${t.decision === "blocked" ? "blocked" : ""} ${t.status === "error" ? "error" : ""}`}
              onClick={() => jump(i)}
              style={{
                opacity,
                cursor: "pointer",
                transition: "opacity .2s ease",
                background: isCur ? "var(--primary-weak)" : undefined,
                outline: isCur ? "2px solid var(--primary)" : undefined,
                borderRadius: isCur ? "var(--radius-sm)" : undefined,
              }}
              aria-current={isCur ? "step" : undefined}
            >
              <div className="st-dot" aria-hidden="true">{i + 1}</div>
              <div className="st-body">
                <div className="st-line1">
                  <span className="st-time">{timeFmt(t.ts)}</span>
                  <span className="st-model">{t.model}</span>
                  <Badge tone={decTone(t.decision)} dot>{t.decision === "blocked" ? "차단" : t.decision === "flagged" ? "표시" : "통과"}</Badge>
                  {t.status === "error" && <Badge tone="red" dot>에러</Badge>}
                </div>
                <div className="st-prompt">{t.user_preview}</div>
                <div className="st-metrics">
                  <span>TTFT {t.ttft_ms}ms</span>
                  <span>E2E {fmtMs(t.total_ms)}</span>
                  <span>{fmtTok(t.prompt_tokens)}→{fmtTok(t.completion_tokens)} tok</span>
                  <span>₩{t.cost_krw}</span>
                  <code className="st-trace">{t.trace_id}</code>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="gc-hint">▶ 재생으로 턴을 시간 순서대로 되짚어 보거나, 슬라이더·턴 클릭으로 특정 시점으로 점프하세요. 각 턴은 트레이스 뷰어에서 span 단위로 더 깊게 볼 수 있습니다.</p>
    </>
  );
}
