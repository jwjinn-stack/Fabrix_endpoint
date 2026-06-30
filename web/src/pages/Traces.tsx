import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchTrace, fetchTraces, recordScore } from "../api/client";
import VirtualRows from "../components/VirtualRows";
import type { Score, SpanKind, TimeRange, TraceDetail, TraceListReport, TraceSpan } from "../api/types";
import Badge, { type BadgeTone } from "../components/Badge";
import { ScoreBadges, ScorePanel } from "../components/ScoreBadge";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import { SkeletonRows } from "../components/Skeleton";
import { useTableDensity, DensityToggle } from "../components/DensityToggle";
import ExportButton from "../components/ExportButton";
import ViewBar from "../components/ViewBar";
import { useUrlState, decodeState, strField, enumField, rangeField } from "../urlState";
import { useCap } from "../capabilities";
import { humanizeError } from "../utils/errors";
import { spanGeometry, spanDepth, selfMs, kindCounts } from "../components/spanWaterfall";

// IMP-24: 필터·기간을 URL 단일 출처로(시드+되쓰기 통합). 미세조정은 replaceState.
const TRACE_SCHEMA = {
  range: rangeField,
  decision: enumField(["all", "allowed", "flagged", "blocked"] as const, "all"),
  status: enumField(["all", "ok", "error"] as const, "all"),
  model: strField("all"),
  app: strField("all"),
  q: strField(""), // IMP-32: 자유 텍스트 전문검색(가산적). 빈 문자열이면 URL 에서 생략.
} as const;

const RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "최근 1시간" },
  { value: "6h", label: "최근 6시간" },
  { value: "24h", label: "최근 24시간" },
  { value: "7d", label: "최근 7일" },
];

// span kind → 색/한글 라벨 (status 가 아니라 type 기반 색코딩 — Langfuse/Phoenix 패턴).
// Langfuse observation type 10종 + 서빙 내부(victoria-traces) 6종.
const SPAN_COLOR: Record<SpanKind, string> = {
  // Langfuse observation types
  generation: "var(--primary)", guardrail: "var(--pink)", retriever: "var(--blue)",
  embedding: "var(--teal)", tool: "var(--green)", agent: "var(--primary-strong)",
  chain: "var(--blue)", evaluator: "var(--amber)", event: "var(--text-faint)", span: "var(--text-dim)",
  // 서빙 내부 (otel / victoria-traces)
  proxy: "var(--text-dim)", router: "var(--teal)", queue: "var(--amber)",
  prefill: "var(--primary)", decode: "var(--primary-lite)", network: "var(--text-faint)",
};
const SPAN_LABEL: Record<SpanKind, string> = {
  generation: "생성(LLM)", guardrail: "가드레일", retriever: "검색", embedding: "임베딩", tool: "툴",
  agent: "에이전트", chain: "체인", evaluator: "평가", event: "이벤트", span: "스팬",
  proxy: "프록시", router: "라우터", queue: "큐", prefill: "Prefill", decode: "Decode", network: "네트워크",
};

function decisionTone(d: string): BadgeTone {
  return d === "blocked" ? "red" : d === "flagged" ? "amber" : "green";
}
function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}
function p95(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}
const timeFmt = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour12: false });

export default function Traces() {
  // IMP-24: 필터·기간·드릴다운 컨텍스트가 URL 단일 출처로 산다(시드+되쓰기 통합).
  // L2→L3 drill-through 로 넘어온 model/decision/range 쿼리도 그대로 복원된다.
  const [st, patch] = useUrlState(TRACE_SCHEMA);
  const { range, decision, status, model, app, q } = st;
  const setRange = (r: TimeRange) => patch({ range: r });
  const filters = useMemo(() => ({ decision, status, model, app, q }), [decision, status, model, app, q]);
  // IMP-32: 검색창은 즉시 반응(로컬 state) + URL 되쓰기는 디바운스(useUrlState debounce).
  const [qInput, setQInput] = useState(q);
  // popstate/뷰적용 등 외부에서 q 가 바뀌면 입력창도 동기화.
  useEffect(() => { setQInput(q); }, [q]);
  const onQChange = (v: string) => { setQInput(v); patch({ q: v }, { debounce: true }); };
  const clearQ = () => { setQInput(""); patch({ q: "" }); };
  const cap = useCap();
  const canSave = !cap.caps.readonly; // 뷰 저장(쓰기)은 manage 프로파일만 — 링크 복사는 항상 허용
  const canEval = cap.can("eval"); // 평가 점수 기록(인라인 "이거 평가")은 eval cap(manage)만
  const { density, setDensity } = useTableDensity("traces");
  const [data, setData] = useState<TraceListReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 들어온 model 을 옵션 모집단에 시드(필터≠all 이면 옵션 갱신이 막히므로 빈 select 방지).
  const [opts, setOpts] = useState<{ models: string[]; apps: string[] }>({ models: model !== "all" ? [model] : [], apps: [] });

  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [openSpan, setOpenSpan] = useState<string | null>(null);
  const vScrollRef = useRef<HTMLDivElement | null>(null); // IMP-30: 세로 windowing 스크롤 컨테이너

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const d = await fetchTraces(range, filters, signal);
        setData(d);
        setError(null);
        // 필터 미적용(all + q 없음) 일 때만 옵션 모집단 갱신 → 필터링으로 옵션이 줄지 않게.
        if (filters.decision === "all" && filters.status === "all" && filters.model === "all" && filters.app === "all" && !filters.q) {
          setOpts({
            models: [...new Set(d.traces.map((t) => t.model))].sort(),
            apps: [...new Set(d.traces.map((t) => t.app_id))].sort(),
          });
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
      } finally {
        setLoading(false);
      }
    },
    [range, filters],
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
    setOpenSpan(null);
    fetchTrace(selId, ctrl.signal)
      .then((d) => setDetail(d))
      .catch((e) => { if ((e as Error).name !== "AbortError") setDetail(null); })
      .finally(() => setDetailLoading(false));
    return () => ctrl.abort();
  }, [selId]);

  const traces = data?.traces ?? [];
  const stats = useMemo(() => ({
    count: traces.length,
    ttft: p95(traces.map((t) => t.ttft_ms)),
    e2e: p95(traces.map((t) => t.total_ms)),
    blocked: traces.filter((t) => t.decision === "blocked").length,
    errored: traces.filter((t) => t.status === "error").length,
  }), [traces]);

  const setFilter = (k: keyof typeof filters, v: string) => patch({ [k]: v } as Partial<typeof st>);
  const resetFilters = () => { setQInput(""); patch({ decision: "all", status: "all", model: "all", app: "all", q: "" }); };
  // 저장된 뷰 적용: querystring → 화면 state 복원(+URL 되쓰기).
  const applyView = (query: string) => patch(decodeState(TRACE_SCHEMA, query));

  return (
    <>
      <div className="page-head">
        <h1>추론 트레이스</h1>
        <span className="crumb">관제 / 트레이스</span>
        <div className="spacer" />
        <span className="updated">{data ? `${traces.length}건 · ${data.source}` : "—"}</span>
        <DensityToggle density={density} onChange={setDensity} />
        <select className="range-select" value={range} onChange={(e) => setRange(e.target.value as TimeRange)}>
          {RANGES.map((r) => <option key={r.value} value={r.value}>기간: {r.label}</option>)}
        </select>
        <ExportButton
          filename={`fabrix-traces-${range}`}
          rows={traces}
          columns={[
            { key: "trace_id", header: "trace_id", get: (t) => t.trace_id },
            { key: "ts", header: "ts", get: (t) => t.ts },
            { key: "model", header: "model", get: (t) => t.model },
            { key: "app_id", header: "app_id", get: (t) => t.app_id },
            { key: "dept_id", header: "dept_id", get: (t) => t.dept_id },
            { key: "api_key_id", header: "api_key_id", get: (t) => t.api_key_id },
            { key: "decision", header: "decision", get: (t) => t.decision },
            { key: "status", header: "status", get: (t) => t.status },
            { key: "total_ms", header: "total_ms", get: (t) => t.total_ms },
            { key: "ttft_ms", header: "ttft_ms", get: (t) => t.ttft_ms },
            { key: "prompt_tokens", header: "prompt_tokens", get: (t) => t.prompt_tokens },
            { key: "completion_tokens", header: "completion_tokens", get: (t) => t.completion_tokens },
            { key: "total_cost_krw", header: "total_cost_krw", get: (t) => t.total_cost_krw },
          ]}
        />
        <button type="button" className={`refresh-btn ${loading ? "is-loading" : ""}`} onClick={() => load()} disabled={loading} aria-label="트레이스 새로고침">
          <span className="spin" aria-hidden="true">⟳</span>새로고침
        </button>
      </div>

      <div className="cards-4">
        <div className="card stat-mini"><div className="sm-label">트레이스</div><div className="sm-val">{stats.count}<span className="sm-unit">건</span></div><div className="sm-sub">표본 (기간 {RANGES.find((r) => r.value === range)?.label})</div></div>
        <div className="card stat-mini"><div className="sm-label">TTFT p95</div><div className="sm-val">{stats.ttft}<span className="sm-unit">ms</span></div><div className="sm-sub">첫 토큰 지연 95퍼센타일</div></div>
        <div className="card stat-mini"><div className="sm-label">E2E p95</div><div className="sm-val">{fmtMs(stats.e2e)}</div><div className="sm-sub">요청 종단 지연 95퍼센타일</div></div>
        <div className="card stat-mini"><div className="sm-label">차단 / 에러</div><div className="sm-val" style={{ color: stats.blocked || stats.errored ? "var(--red)" : "var(--green)" }}>{stats.blocked}<span className="sm-unit">/ {stats.errored}</span></div><div className="sm-sub">가드레일 차단 / 엔진 에러</div></div>
      </div>

      <div className="card">
        <div className="filter-bar" role="group" aria-label="트레이스 필터">
          {/* IMP-32: 서버사이드 전문검색 — 입력/출력 미리보기 + 메타 화이트리스트(마스킹/차단 원문 제외) */}
          <label className="fb-field" style={{ flex: "1 1 220px", minWidth: 180 }}><span>검색</span>
            <input
              className="inline-search"
              type="search"
              value={qInput}
              onChange={(e) => onQChange(e.target.value)}
              placeholder="입력·출력·모델·앱 등 전문검색"
              aria-label="트레이스 전문검색"
              style={{ width: "100%" }}
            />
          </label>
          <label className="fb-field"><span>판정</span>
            <select value={filters.decision} onChange={(e) => setFilter("decision", e.target.value)}>
              <option value="all">전체</option><option value="allowed">통과</option><option value="flagged">표시</option><option value="blocked">차단</option>
            </select>
          </label>
          <label className="fb-field"><span>상태</span>
            <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="all">전체</option><option value="ok">정상</option><option value="error">에러</option>
            </select>
          </label>
          <label className="fb-field"><span>모델</span>
            <select value={filters.model} onChange={(e) => setFilter("model", e.target.value)}>
              <option value="all">전체</option>{opts.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="fb-field"><span>앱</span>
            <select value={filters.app} onChange={(e) => setFilter("app", e.target.value)}>
              <option value="all">전체</option>{opts.apps.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          {filters.q && (
            <span className="filter-chip" role="status" aria-label={`검색어 ${filters.q}`} style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-1)", padding: "2px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-pill, 999px)", background: "var(--surface-2)", fontSize: "var(--fs-sm)" }}>
              검색: "{filters.q}"
              <button type="button" className="chip-x" onClick={clearQ} aria-label="검색어 지우기" style={{ border: "none", background: "none", cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </span>
          )}
          {(filters.decision !== "all" || filters.status !== "all" || filters.model !== "all" || filters.app !== "all" || filters.q !== "") && (
            <button type="button" className="btn-ghost btn-sm" onClick={resetFilters}>필터 초기화</button>
          )}
          <span className="spacer" style={{ flex: 1 }} />
          <ViewBar page="traces" canSave={canSave} onApply={applyView} />
        </div>

        {error && <div className="state error" role="alert">트레이스를 불러오지 못했습니다. ({error})</div>}
        {!error && loading && !data && <SkeletonRows rows={8} cols={6} />}
        {!error && data && traces.length === 0 && <div className="state">조건에 맞는 트레이스가 없습니다. 필터를 완화해 보세요.</div>}

        {traces.length > 0 && (
          <div className="tbl-scroll">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="데이터 표 — 좌우 스크롤 가능">
            {/* IMP-30: 세로 스크롤 컨테이너 — 행 수가 많으면 보이는 행만 windowing 렌더 */}
            <div ref={vScrollRef} className="vrow-viewport">
            <table className={`usage-table density-${density}`}>
              <thead>
                <tr>
                  <th>시각</th><th>모델</th><th>앱</th><th>엔드포인트</th>
                  <th className="num">TTFT</th><th className="num">Decode</th><th className="num">E2E</th>
                  <th className="num">토큰(in→out)</th><th className="num">tok/s</th><th>평가</th><th>종료</th><th>판정</th>
                </tr>
              </thead>
              <tbody>
                <VirtualRows items={traces} colSpan={12} scrollRef={vScrollRef}>
                  {(t) => (
                  <tr key={t.trace_id} onClick={() => setSelId(t.trace_id)} className={`row-click ${selId === t.trace_id ? "row-sel" : ""}`} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") setSelId(t.trace_id); }}>
                    <td>{timeFmt(t.ts)}</td>
                    <td>{t.model}</td>
                    <td>{t.app_id}</td>
                    <td className="cell-dim">{t.endpoint}</td>
                    <td className="num" style={{ color: t.ttft_ms > 140 ? "var(--amber)" : undefined }}>{t.ttft_ms}ms</td>
                    <td className="num">{fmtMs(t.decode_ms)}</td>
                    <td className="num"><b>{fmtMs(t.total_ms)}</b></td>
                    <td className="num cell-dim">{fmtTokens(t.prompt_tokens)}→{fmtTokens(t.completion_tokens)}</td>
                    <td className="num">{t.tokens_per_sec || "—"}</td>
                    <td>{t.scores && t.scores.length > 0 ? <ScoreBadges scores={t.scores} /> : <span className="cell-dim">—</span>}</td>
                    <td><span className={`finish-tag finish-${t.finish_reason}`}>{t.finish_reason}</span></td>
                    <td>
                      <Badge tone={decisionTone(t.decision)} dot>{t.decision === "blocked" ? "차단" : t.decision === "flagged" ? "표시" : "통과"}</Badge>
                      {t.status === "error" && <Badge tone="red" dot>에러</Badge>}
                    </td>
                  </tr>
                  )}
                </VirtualRows>
              </tbody>
            </table>
            </div>
            </div>
          </div>
        )}
      </div>

      <SlidePanel
        open={!!selId}
        width={760}
        title={detail ? `chat ${detail.summary.model}` : "트레이스 상세"}
        subtitle={selId ? <code className="trace-id">{selId}</code> : undefined}
        onClose={() => setSelId(null)}
      >
        {detailLoading && <div className="state" role="status">트레이스 스팬을 불러오는 중…</div>}
        {detail && <TraceDetailView detail={detail} openSpan={openSpan} onToggleSpan={(id) => setOpenSpan((s) => (s === id ? null : id))} canEval={canEval} onScoreAdded={(sc) => setDetail((d) => (d ? { ...d, summary: { ...d.summary, scores: [...(d.summary.scores ?? []), sc] } } : d))} />}
      </SlidePanel>
    </>
  );
}

// IMP-34: span 속성에서 토큰 합 추출(readout 용). OTel gen_ai / Langfuse usage 공통 키.
// 없으면 undefined → readout 에서 토큰 줄을 숨긴다.
function spanTokens(sp: TraceSpan): number | undefined {
  const a = sp.attributes ?? {};
  // total 우선, 없으면 input+output 합산.
  const total = num(a["gen_ai.usage.total_tokens"] ?? a["usage.total_tokens"] ?? a["total_tokens"] ?? a["tokens"]);
  if (total != null) return total;
  const inTok = num(a["gen_ai.usage.input_tokens"] ?? a["gen_ai.usage.prompt_tokens"]);
  const outTok = num(a["gen_ai.usage.output_tokens"] ?? a["gen_ai.usage.completion_tokens"]);
  if (inTok != null || outTok != null) return (inTok ?? 0) + (outTok ?? 0);
  return undefined;
}
function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

// 스팬 속성에서 에러 사유 추출 — OTel/Langfuse 공통 키 중 먼저 잡히는 값.
function spanErrReason(sp: TraceSpan): string | undefined {
  const a = sp.attributes ?? {};
  const v = a["exception.message"] ?? a["error.message"] ?? a["status_message"] ?? a["gen_ai.error"] ?? a["error"];
  return v != null && v !== "" ? String(v) : undefined;
}

// ───────────────────────── 상세: 요약 + waterfall + 속성 ─────────────────────────
function TraceDetailView({ detail, openSpan, onToggleSpan, canEval, onScoreAdded }: { detail: TraceDetail; openSpan: string | null; onToggleSpan: (id: string) => void; canEval: boolean; onScoreAdded: (sc: Score) => void }) {
  const s = detail.summary;
  const total = Math.max(1, s.total_ms);
  const ttftPct = (s.ttft_ms / total) * 100;
  const children = detail.spans.filter((sp) => sp.parent_id);

  // IMP-18: 인라인 "이거 평가" — 선택 trace 에 점수를 기록(mock, source=llm-judge).
  const [evalBusy, setEvalBusy] = useState(false);
  const [evalErr, setEvalErr] = useState<string | null>(null);
  const runInlineEval = async () => {
    if (evalBusy) return;
    setEvalBusy(true);
    setEvalErr(null);
    try {
      // mock-stage: LLM-as-judge 결과를 모사한 점수 1건을 trace 에 부착.
      const sc = await recordScore(s.trace_id, {
        name: "정확성", value: 4, data_type: "numeric", source: "llm-judge",
        comment: "트레이스 행에서 인라인 평가(LLM-as-judge) 실행", session_id: s.session_id,
      });
      onScoreAdded(sc);
    } catch (e) {
      setEvalErr(humanizeError((e as Error).message));
    } finally {
      setEvalBusy(false);
    }
  };

  // O-01: 타임라인(시간순 waterfall) ↔ 트리(계층 들여쓰기) 토글.
  const [view, setView] = useState<"timeline" | "tree">("timeline");
  // O-02: span 이름/타입/id 부분일치 필터(대소문자 무시).
  const [q, setQ] = useState("");
  // IMP-34: 호버 readout 대상 span(타임라인 막대/행). openSpan(선택) 과 별개로 약한 강조.
  const [hoverSpan, setHoverSpan] = useState<string | null>(null);

  // 트리 모드용 span 인덱스 + 깊이. 부모 정보가 거의 평면이면 kind 별 "단계 그룹"으로 흉내.
  const byId = useMemo(() => new Map(detail.spans.map((sp) => [sp.span_id, sp])), [detail.spans]);
  const hasHierarchy = useMemo(() => children.some((sp) => sp.parent_id && byId.get(sp.parent_id)?.parent_id), [children, byId]);

  const matches = (sp: TraceSpan) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      sp.name.toLowerCase().includes(needle) ||
      sp.kind.toLowerCase().includes(needle) ||
      sp.span_id.toLowerCase().includes(needle)
    );
  };

  // 타임라인: 시작 시각 순 + 깊이(들여쓰기). 트리: 계층 정렬(부모 깊이 있으면 그대로, 없으면 kind 묶음).
  // IMP-34: 타임라인에서도 parent 체인 깊이만큼 라벨을 들여쓰기해 계층을 가시화한다.
  const timelineRows = useMemo(
    () =>
      [...children]
        .sort((a, b) => a.start_ms - b.start_ms)
        .filter(matches)
        .map((sp) => ({ sp, depth: spanDepth(sp, byId) })),
    [children, q, byId],
  );

  // IMP-34: 등장 kind 만 응집 범례 칩(색·라벨·개수)으로.
  const legendChips = useMemo(() => kindCounts(children), [children]);

  // 트리: 계층 데이터가 있으면 깊이로 들여쓰기. 없으면 kind 별 단계 그룹(정직하게 평면 흉내).
  const treeGroups = useMemo(() => {
    const filtered = children.filter(matches);
    if (hasHierarchy) {
      // 부모-자식 순서 유지: start_ms 정렬 후 깊이만 들여쓰기.
      return [{
        label: null as string | null,
        spans: [...filtered].sort((a, b) => a.start_ms - b.start_ms).map((sp) => ({ sp, depth: spanDepth(sp, byId) })),
      }];
    }
    // 평면 → kind 별 그룹(단계). 등장 순서 보존.
    const order: SpanKind[] = [];
    const groups = new Map<SpanKind, TraceSpan[]>();
    for (const sp of [...filtered].sort((a, b) => a.start_ms - b.start_ms)) {
      if (!groups.has(sp.kind)) { groups.set(sp.kind, []); order.push(sp.kind); }
      groups.get(sp.kind)!.push(sp);
    }
    return order.map((k) => ({ label: SPAN_LABEL[k], spans: groups.get(k)!.map((sp) => ({ sp, depth: 1 })) }));
  }, [children, q, hasHierarchy, byId]);

  const visibleCount = timelineRows.length;

  return (
    <>
      {/* 요약 메타 */}
      <div className="trace-summary">
        <DetailRow label="엔드포인트">{s.endpoint}</DetailRow>
        <DetailRow label="앱 / 부서">{s.app_id} · {s.dept_id}</DetailRow>
        <DetailRow label="API 키">{s.api_key_id}</DetailRow>
        <DetailRow label="route / user">{s.route ?? "—"} · {s.user_id ?? "—"}</DetailRow>
        <DetailRow label="session">{s.session_id ?? "—"}</DetailRow>
        <DetailRow label="HTTP 상태"><span style={{ color: s.http_status >= 400 ? "var(--red)" : "var(--green)", fontVariantNumeric: "tabular-nums" }}>{s.http_status}</span></DetailRow>
        <DetailRow label="종료 사유"><span className={`finish-tag finish-${s.finish_reason}`}>{s.finish_reason}</span></DetailRow>
        <DetailRow label="스트리밍">{s.stream ? "stream=True" : "stream=False"}</DetailRow>
      </div>

      {/* TTFT vs decode 분해 막대 */}
      <div className="trace-split" aria-hidden="true">
        <div className="ts-seg" style={{ width: `${ttftPct}%`, background: "var(--primary)" }} title={`TTFT ${s.ttft_ms}ms`} />
        <div className="ts-seg" style={{ width: `${100 - ttftPct}%`, background: "var(--primary-lite)" }} title={`Decode ${s.decode_ms}ms`} />
      </div>
      <div className="trace-split-legend">
        <span><i style={{ background: "var(--primary)" }} />TTFT(첫 토큰) <b>{s.ttft_ms}ms</b></span>
        <span><i style={{ background: "var(--primary-lite)" }} />Decode <b>{fmtMs(s.decode_ms)}</b></span>
        <span className="tsl-right">E2E <b>{fmtMs(s.total_ms)}</b> · {s.tokens_per_sec || 0} tok/s</span>
      </div>

      {/* 토큰 + 비용 분해 (Langfuse usageDetails/costDetails — 서버측 계산값) */}
      <div className="trace-tokens">
        <div><span className="tt-label">입력</span><b>{s.prompt_tokens.toLocaleString()}</b></div>
        <div><span className="tt-label">캐시 적중</span><b style={{ color: "var(--teal)" }}>{s.cached_tokens.toLocaleString()}</b></div>
        <div><span className="tt-label">출력</span><b>{s.completion_tokens.toLocaleString()}</b></div>
        <div className="tt-cost"><span className="tt-label">비용 (Langfuse)</span><b>₩{s.total_cost_krw.toLocaleString()}</b><span className="tt-cost-sub">입력 ₩{s.input_cost_krw} · 출력 ₩{s.output_cost_krw}</span></div>
      </div>

      {/* IMP-18: 비용·지연 배너 (이 요청 한눈에) */}
      <div className="trace-cost-banner" style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap", padding: "var(--sp-2) var(--sp-3)", margin: "var(--sp-2) 0", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", fontSize: "var(--fs-sm)" }}>
        <span>이 요청: <b>₩{s.total_cost_krw.toLocaleString()}</b></span>
        <span>· TTFT <b>{s.ttft_ms}ms</b></span>
        <span>· E2E <b>{fmtMs(s.total_ms)}</b></span>
        <span>· {fmtTokens(s.prompt_tokens)}→{fmtTokens(s.completion_tokens)} tok</span>
      </div>

      {/* IMP-18: 평가 점수 패널 (Langfuse scores 부착) + 인라인 "이거 평가" */}
      <div className="trace-scores" style={{ margin: "var(--sp-2) 0" }}>
        <div className="span-wf-head" style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <span>평가 점수 {s.scores && s.scores.length ? `(${s.scores.length})` : ""}</span>
          <span className="spacer" style={{ flex: 1 }} />
          {canEval && (
            <button type="button" className="btn-ghost btn-sm" onClick={runInlineEval} disabled={evalBusy} title="LLM-as-judge 로 이 트레이스를 평가해 점수를 부착(mock)">
              {evalBusy ? "평가 중…" : "이거 평가"}
            </button>
          )}
        </div>
        {evalErr && <div className="state error" role="alert">{evalErr}</div>}
        <ScorePanel scores={s.scores} />
      </div>

      {/* Span waterfall / tree */}
      <div className="span-wf">
        <div className="span-wf-head">
          <span>스팬 ({visibleCount}{visibleCount !== children.length ? ` / ${children.length}` : ""})</span>
          <div className="seg-toggle" role="tablist" aria-label="스팬 보기 전환" style={{ marginLeft: "var(--sp-3)" }}>
            <button type="button" className={view === "timeline" ? "active" : ""} aria-selected={view === "timeline"} onClick={() => setView("timeline")}>타임라인</button>
            <button type="button" className={view === "tree" ? "active" : ""} aria-selected={view === "tree"} onClick={() => setView("tree")}>트리</button>
          </div>
          <span className="spacer" style={{ flex: 1 }} />
          {view === "timeline" && <span className="span-wf-scale">0 → {fmtMs(total)}</span>}
        </div>

        {/* O-02: span 인라인 검색 */}
        <input
          className="inline-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="스팬 검색 (이름·타입·id)"
          aria-label="스팬 검색"
          style={{ margin: "var(--sp-2) 0" }}
        />

        {visibleCount === 0 ? (
          <div className="state">"{q}" 와 일치하는 스팬이 없습니다.</div>
        ) : view === "timeline" ? (
          <div className="span-wf-rows">
            {/* IMP-34: 시간축 눈금(0 · 1/4 · 1/2 · 3/4 · total) — track 영역(232px..우측64px)에 정렬 */}
            <div className="span-axis" aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <span key={f} className="span-axis-tick" style={{ left: `calc(232px + (100% - 296px) * ${f})` }}>
                  <span className="span-axis-rule" />
                  <span className="span-axis-label">{f === 0 ? "0" : fmtMs(total * f)}</span>
                </span>
              ))}
            </div>
            {/* TTFT 기준선 */}
            <div className="span-ttft-line" style={{ left: `calc(232px + (100% - 296px) * ${ttftPct / 100})` }} title={`TTFT ${s.ttft_ms}ms`} aria-hidden="true" />
            {timelineRows.map(({ sp, depth }) => {
              const { leftPct, widthPct } = spanGeometry(sp, total);
              const open = openSpan === sp.span_id;
              const hovered = hoverSpan === sp.span_id;
              const color = SPAN_COLOR[sp.kind];
              const self = selfMs(sp, detail.spans);
              const tokens = spanTokens(sp);
              return (
                <div key={sp.span_id} className={`span-block${open ? " is-active" : ""}${hovered ? " is-hover" : ""}`}>
                  <button
                    type="button"
                    className={`span-row ${open ? "open" : ""}`}
                    onClick={() => onToggleSpan(sp.span_id)}
                    onMouseEnter={() => setHoverSpan(sp.span_id)}
                    onMouseLeave={() => setHoverSpan((h) => (h === sp.span_id ? null : h))}
                    onFocus={() => setHoverSpan(sp.span_id)}
                    onBlur={() => setHoverSpan((h) => (h === sp.span_id ? null : h))}
                    aria-expanded={open}
                  >
                    <span className="span-label" style={{ paddingLeft: depth > 0 ? `calc(${depth} * var(--sp-2))` : undefined }}>
                      {depth > 0 && <span className="span-indent" aria-hidden="true" />}
                      <span className="span-kind" style={{ background: color }} aria-hidden="true" />
                      <span className="span-name">{sp.name}</span>
                      <span className={`span-src span-src-${sp.source}`} title={sp.source === "langfuse" ? "Langfuse observation (토큰·비용·프롬프트)" : "OTel → victoria-traces (Dynamo/vLLM)"}>{sp.source === "langfuse" ? "LF" : "VT"}</span>
                      {sp.derived && <span className="span-derived" title="별도 span 이 아님 — vLLM llm_request span 의 속성(gen_ai.latency.*)을 구간 분해한 것">attr</span>}
                      {sp.status === "error" && <span className="span-err" title={spanErrReason(sp) ?? "에러"}>!</span>}
                      {sp.status === "error" && spanErrReason(sp) && <span className="span-reason" title={spanErrReason(sp)}>{spanErrReason(sp)}</span>}
                      {sp.status !== "error" && sp.level === "WARNING" && <span className="span-reason warn" title="경고">경고</span>}
                    </span>
                    <span className="span-track">
                      <span className="span-bar" style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color, opacity: sp.status === "error" ? 1 : 0.85 }} />
                      {/* IMP-34: 호버 readout — 막대 시작 위치에 self/total ms + 토큰. 모든 값 텍스트(이스케이프). */}
                      {hovered && (
                        <span className="span-readout" role="status" style={{ left: `${leftPct}%` }}>
                          <span className="span-readout-name"><span className="span-readout-dot" style={{ background: color }} aria-hidden="true" />{sp.name} <em>{SPAN_LABEL[sp.kind]}</em></span>
                          <span className="span-readout-row"><span>시작</span><b>+{fmtMs(sp.start_ms)}</b></span>
                          <span className="span-readout-row"><span>self</span><b>{fmtMs(self)}</b></span>
                          <span className="span-readout-row"><span>total</span><b>{fmtMs(sp.duration_ms)}</b></span>
                          {tokens != null && <span className="span-readout-row"><span>토큰</span><b>{fmtTokens(tokens)}</b></span>}
                        </span>
                      )}
                    </span>
                    <span className="span-ms">{fmtMs(sp.duration_ms)}</span>
                  </button>
                  {open && <SpanAttrs span={sp} />}
                </div>
              );
            })}
          </div>
        ) : (
          // O-01 트리 + O-05 disclose: 계층 들여쓰기, 속성은 기본 접힘.
          <div className="span-tree">
            {!hasHierarchy && <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "0 0 var(--sp-2)" }}>이 트레이스의 span 은 평면 구조라 종류별 단계 그룹으로 묶어 표시합니다.</p>}
            {treeGroups.map((g, gi) => (
              <div key={g.label ?? gi} style={{ marginBottom: g.label ? "var(--sp-2)" : 0 }}>
                {g.label && <div className="muted" style={{ fontSize: "var(--fs-xs)", fontWeight: 600, margin: "var(--sp-1) 0" }}>{g.label}</div>}
                {g.spans.map(({ sp, depth }) => {
                  const open = openSpan === sp.span_id;
                  const color = SPAN_COLOR[sp.kind];
                  return (
                    <div key={sp.span_id} className={`span-block${open ? " is-active" : ""}`} style={{ paddingLeft: `calc(${depth} * var(--sp-3))`, borderLeft: depth > 0 ? "1px solid var(--border)" : undefined, marginLeft: depth > 0 ? 1 : 0 }}>
                      <button type="button" className="disclose-btn" aria-expanded={open} onClick={() => onToggleSpan(sp.span_id)} style={{ width: "100%" }}>
                        <span className="caret">›</span>
                        <span className="span-kind" style={{ background: color, marginRight: "var(--sp-1)" }} aria-hidden="true" />
                        <span className="span-name">{sp.name}</span>
                        <span className={`span-src span-src-${sp.source}`} title={sp.source === "langfuse" ? "Langfuse observation" : "OTel → victoria-traces"}>{sp.source === "langfuse" ? "LF" : "VT"}</span>
                        {sp.status === "error" && <span className="span-err" title="에러">!</span>}
                        <span className="spacer" style={{ flex: 1 }} />
                        <span className="span-ms">{fmtMs(sp.duration_ms)}</span>
                      </button>
                      {open && <SpanAttrs span={sp} />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {/* IMP-34: 응집 범례 칩 — 등장 kind 만 색 칩 + 라벨 + 개수 */}
        <div className="span-wf-legend">
          {legendChips.map(({ kind, count }) => (
            <span key={kind} className="span-chip"><i style={{ background: SPAN_COLOR[kind] }} />{SPAN_LABEL[kind]}<span className="span-chip-n">{count}</span></span>
          ))}
          <span className="span-wf-src"><span className="span-src span-src-langfuse">LF</span> Langfuse · <span className="span-src span-src-otel">VT</span> victoria-traces · <span className="span-derived">attr</span> 파생</span>
        </div>
        <p className="span-wf-note">
          proxy·router 는 Dynamo 분산 span(실제 span), <b>prefill/decode/queue 는 vLLM <code>llm_request</code> 단일 span 의 속성</b>(<code>gen_ai.latency.*</code>)을 구간 분해한 것입니다(별도 span 아님). 가드레일·검색은 Langfuse observation.
        </p>
      </div>

      {/* 입력/출력 미리보기 */}
      <details className="trace-io" open>
        <summary>입력 / 출력 미리보기</summary>
        <div className="trace-io-block"><span className="tio-label">입력</span><p>{detail.input_preview}</p></div>
        <div className="trace-io-block"><span className="tio-label">출력</span><p className={s.decision === "blocked" ? "tio-blocked" : ""}>{detail.output_preview}</p></div>
      </details>
    </>
  );
}

function SpanAttrs({ span }: { span: TraceSpan }) {
  const entries = Object.entries(span.attributes);
  return (
    <div className="span-attrs">
      <div className="span-attrs-meta">
        <span>kind=<b>{span.kind}</b></span>
        <span>start +{Math.round(span.start_ms)}ms</span>
        <span>dur {fmtMs(span.duration_ms)}</span>
        <span className={span.status === "error" ? "sa-err" : "sa-ok"}>{span.status}</span>
      </div>
      {entries.length > 0 && (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="데이터 표 — 좌우 스크롤 가능">
        <table className="span-attr-table">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}><td className="sa-key">{k}</td><td className="sa-val">{String(v)}</td></tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
