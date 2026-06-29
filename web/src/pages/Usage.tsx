import { useCallback, useEffect, useState } from "react";
import { fetchOverview, fetchUsage, fetchUsageTrend } from "../api/client";
import type { DashboardOverview, UsageReport, UsageRow, UsageTrend } from "../api/types";
import type { Page } from "../components/Layout";
import StatCard from "../components/StatCard";
import { SkeletonCards, SkeletonRows } from "../components/Skeleton";
import StackedShareBar from "../components/StackedShareBar";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import UsageTrendChart from "../components/UsageTrendChart";
import LatencyPanel from "../components/LatencyPanel";
import RankCard from "../components/RankCard";
import { RangeSelect, useTimeRange } from "../timeRange";

const pct = (v: number) => `${Math.round(v * 100)}%`;

const GROUPS: { value: string; label: string; col: string }[] = [
  { value: "model", label: "모델별", col: "모델" },
  { value: "dept", label: "부서별", col: "부서" },
  { value: "app", label: "앱별", col: "앱" },
  { value: "api_key", label: "API 키별", col: "API 키" },
];

const nf = new Intl.NumberFormat("ko-KR");

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return nf.format(n);
}

function rowKey(r: UsageRow, group: string): string {
  if (group === "dept") return r.dept_id || "—";
  if (group === "app") return r.app_id || "—";
  if (group === "api_key") return r.api_key_id || "—";
  return r.model;
}

function toCSV(report: UsageReport, group: string): string {
  const head = [GROUPS.find((g) => g.value === group)?.col ?? "key", "requests", "prompt_tokens", "completion_tokens", "est_cost_krw"];
  const lines = report.rows.map((r) =>
    [rowKey(r, group), r.requests, r.prompt_tokens, r.completion_tokens, r.est_cost_krw ?? 0].join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

export default function Usage({ onNavigate }: { onNavigate?: (p: Page) => void }) {
  // 기간은 전역 컨텍스트 공유(G-05) — 관제·트레이스 화면과 동일 선택 유지.
  const { range } = useTimeRange();
  const [group, setGroup] = useState("model");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [trend, setTrend] = useState<UsageTrend | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null); // 추론 성능·토큰·Top5 소스(기간 기준)
  const [trendMetric, setTrendMetric] = useState<"requests" | "tokens">("requests");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<UsageRow | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [r, t, o] = await Promise.all([
          fetchUsage(range, group, signal),
          fetchUsageTrend(range, signal),
          fetchOverview(range, signal),
        ]);
        setReport(r);
        setTrend(t);
        setOverview(o);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [range, group],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const exportCSV = () => {
    if (!report) return;
    const blob = new Blob([toCSV(report, group)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fabrix-usage-${group}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rows = report?.rows ?? [];
  const totalReq = rows.reduce((s, r) => s + r.requests, 0);
  const totalIn = rows.reduce((s, r) => s + r.prompt_tokens, 0);
  const totalOut = rows.reduce((s, r) => s + r.completion_tokens, 0);
  const totalCost = rows.reduce((s, r) => s + (r.est_cost_krw ?? 0), 0);
  // 가장 비싼 항목 Top — 비용 책임 추적(Datadog "Most Expensive" 패턴).
  const topCost = [...rows].sort((a, b) => (b.est_cost_krw ?? 0) - (a.est_cost_krw ?? 0))[0];
  // 추세 기준선(delta) — 추세 시계열 전반/후반 평균 비교. 실제 데이터가 있는 요청·토큰에만 적용.
  const trendDelta = (pick: (p: { requests: number; tokens: number }) => number): number | undefined => {
    const pts = trend?.points ?? [];
    if (pts.length < 4) return undefined;
    const h = Math.floor(pts.length / 2);
    const prev = pts.slice(0, h).reduce((s, p) => s + pick(p), 0) / h;
    const cur = pts.slice(h).reduce((s, p) => s + pick(p), 0) / (pts.length - h);
    if (prev === 0) return cur === 0 ? 0 : undefined;
    return ((cur - prev) / prev) * 100;
  };
  const reqDelta = trendDelta((p) => p.requests);
  const tokDelta = trendDelta((p) => p.tokens);
  const isModel = group === "model";
  const groupMeta = GROUPS.find((g) => g.value === group)!;

  return (
    <>
      <div className="page-head">
        <h1>사용량 리포트</h1>
        <span className="crumb">사용량 / 귀속</span>
        <div className="spacer" />
        <select className="range-select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="그룹 기준">
          {GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              그룹: {g.label}
            </option>
          ))}
        </select>
        <RangeSelect />
        <button type="button" className="refresh-btn" onClick={exportCSV} disabled={!report || rows.length === 0}>
          CSV 내보내기
        </button>
      </div>

      {error && (
        <div className="state error" role="alert">
          사용량을 불러오지 못했습니다. ({error})
        </div>
      )}
      {!error && loading && !report && (
        <>
          <SkeletonCards count={4} />
          <div className="card" style={{ marginTop: "var(--sp-4)" }}>
            <SkeletonRows rows={6} cols={5} />
          </div>
        </>
      )}

      {report && rows.length > 0 && (
        <>
          <div className="cards-4">
            <StatCard title="총 요청" info={`${groupMeta.label} 합산 · 변화율은 기간 내 전반 대비 후반`} metrics={[{ label: "requests", value: nf.format(totalReq), delta: reqDelta, deltaGood: "up" }]} />
            <StatCard title="총 토큰" info="입력 + 출력 토큰 · 변화율은 기간 내 전반 대비 후반" metrics={[
              { label: "입력", value: compact(totalIn), tone: "teal" },
              { label: "출력", value: compact(totalOut), tone: "amber" },
              { label: "합계 추세", value: compact(totalIn + totalOut), delta: tokDelta, deltaGood: "up" },
            ]} />
            <StatCard title="추정 비용" info="토큰 × 모델 단가 (자가호스팅 추정)" metrics={[
              { label: "합계", value: `₩${compact(totalCost)}` },
              ...(topCost ? [{ label: `최고 ${rowKey(topCost, group)}`, value: `₩${compact(topCost.est_cost_krw ?? 0)}`, tone: "amber" as const }] : []),
            ]} />
            <StatCard title={`활성 ${groupMeta.col}`} info="집계 구간에 사용량이 있는 항목 수" metrics={[{ label: groupMeta.col, value: rows.length }]} />
          </div>
          <div className="card">
            <StackedShareBar
              title={`${groupMeta.col}별 요청 점유율`}
              items={rows.map((r) => ({ key: rowKey(r, group), name: rowKey(r, group), value: r.requests }))}
              onSegmentClick={(key) => { const r = rows.find((x) => rowKey(x, group) === key); if (r) setDetail(r); }}
            />
          </div>
        </>
      )}

      {/* P4-4 사용량 추세 + forecast — 토글을 차트 헤더 흐름에 넣어 제목과 겹치지 않게(반응형). */}
      {trend && trend.points.length >= 3 && (
        <UsageTrendChart
          points={trend.points}
          metric={trendMetric}
          headerRight={
            <div className="seg-toggle" role="tablist" aria-label="추세 지표 전환">
              <button type="button" role="tab" aria-selected={trendMetric === "requests"} className={trendMetric === "requests" ? "active" : ""} onClick={() => setTrendMetric("requests")}>요청</button>
              <button type="button" role="tab" aria-selected={trendMetric === "tokens"} className={trendMetric === "tokens" ? "active" : ""} onClick={() => setTrendMetric("tokens")}>토큰</button>
            </div>
          }
        />
      )}

      {/* 추론 성능·토큰·랭킹 (관제에서 이전 — 기간 기준 분석) */}
      {overview && (
        <>
          <div className="grid-2">
            <LatencyPanel latency={overview.latency} onRefresh={() => load()} />
            <StatCard
              title="엔진 스케줄러 (현재)"
              info="vLLM 스케줄러 실시간 실행/대기 요청, 큐 대기 p95, KV 캐시 점유 (vllm:num_requests_*, request_plane_queue, kv_cache_usage)"
              onRefresh={() => load()}
              metrics={[
                { label: "실행중(running)", value: overview.scheduler.running },
                { label: "대기(waiting)", value: overview.scheduler.waiting, tone: overview.scheduler.waiting > 5 ? "amber" : undefined },
                { label: "큐 대기 p95", value: overview.scheduler.queue_p95_ms, unit: "ms", tone: overview.scheduler.queue_p95_ms > 100 ? "amber" : undefined },
                { label: "KV 캐시", value: pct(overview.scheduler.kv_cache_perc), bar: overview.scheduler.kv_cache_perc, barColor: overview.scheduler.kv_cache_perc > 0.9 ? "var(--red)" : "var(--teal)", tone: overview.scheduler.kv_cache_perc > 0.9 ? "red" : undefined },
              ]}
            />
          </div>
          {(overview.tokens.prompt_tokens + overview.tokens.completion_tokens) > 100 && (
            <div className="card">
              <StackedShareBar
                title={`토큰 분해 (기간 누적) · 입력 ${overview.tokens.prompt_tokens.toLocaleString("ko-KR")} / 출력 ${overview.tokens.completion_tokens.toLocaleString("ko-KR")}`}
                unit=""
                items={[
                  { key: "cached", name: "캐시 적중 입력", value: Math.min(overview.tokens.cached_tokens, overview.tokens.prompt_tokens) },
                  { key: "fresh", name: "신규 입력", value: Math.max(overview.tokens.prompt_tokens - overview.tokens.cached_tokens, 0) },
                  { key: "completion", name: "출력(생성)", value: overview.tokens.completion_tokens },
                ]}
              />
            </div>
          )}
          <div className="grid-2">
            <RankCard
              title="Top 5 엔드포인트 (모델)"
              rows={overview.top_endpoints}
              unitLabel="요청"
              emptyHint="이 기간 동안 집계된 엔드포인트 사용량이 없습니다."
            />
            <RankCard
              title="Top 5 API 키"
              rows={overview.top_keys}
              unitLabel="요청"
              color="var(--teal)"
              onRowClick={onNavigate ? () => onNavigate("keys") : undefined}
              emptyHint="이 기간 동안 집계된 키 사용량이 없습니다."
            />
          </div>
        </>
      )}

      {report && (
        <div className="card">
          <div className="card-head">
            <h3>사용량 · 그룹: {groupMeta.label}</h3>
            <span className="info" title={isModel ? "모델 축은 vmselect 메트릭 실측입니다." : "부서·앱·키 축은 추론 프록시 → usage_rollup 귀속 집계입니다(문서 §3-1)."}>ⓘ</span>
            <span className="spacer" />
            <span className="updated">요청 {nf.format(totalReq)} · 입력 {compact(totalIn)} · 출력 {compact(totalOut)} 토큰</span>
          </div>

          {rows.length === 0 ? (
            <div className="empty">
              {isModel
                ? "선택한 기간에 기록된 사용량이 없습니다."
                : "이 축의 귀속 데이터가 아직 없습니다. 플레이그라운드/프록시 요청이 누적되면 채워집니다."}
            </div>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>{groupMeta.col}</th>
                  <th className="num">요청</th>
                  <th className="num">입력 토큰</th>
                  <th className="num">출력 토큰</th>
                  <th className="num">추정 비용</th>
                  {isModel && <th className="num">TTFT p95</th>}
                  {isModel && <th className="num">ITL avg</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={rowKey(r, group)} className="clickable" onClick={() => setDetail(r)}>
                    <td>{rowKey(r, group)}</td>
                    <td className="num">{nf.format(r.requests)}</td>
                    <td className="num">{compact(r.prompt_tokens)}</td>
                    <td className="num">{compact(r.completion_tokens)}</td>
                    <td className="num">₩{compact(r.est_cost_krw ?? 0)}</td>
                    {isModel && <td className="num">{r.ttft_p95_ms}ms</td>}
                    {isModel && <td className="num">{r.itl_avg_ms}ms</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <SlidePanel
        open={!!detail}
        title={detail ? `사용량 · ${rowKey(detail, group)}` : ""}
        subtitle={`${groupMeta.label} 상세`}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <DetailRow label={groupMeta.col}>{rowKey(detail, group)}</DetailRow>
            <DetailRow label="요청">{nf.format(detail.requests)}</DetailRow>
            <DetailRow label="입력 토큰">{nf.format(detail.prompt_tokens)}</DetailRow>
            <DetailRow label="출력 토큰">{nf.format(detail.completion_tokens)}</DetailRow>
            <DetailRow label="총 토큰">{nf.format(detail.prompt_tokens + detail.completion_tokens)}</DetailRow>
            <DetailRow label="요청당 평균 토큰">{detail.requests > 0 ? nf.format(Math.round((detail.prompt_tokens + detail.completion_tokens) / detail.requests)) : "—"}</DetailRow>
            <DetailRow label="요청 점유율">{totalReq > 0 ? `${((detail.requests / totalReq) * 100).toFixed(1)}%` : "—"}</DetailRow>
            {isModel && <DetailRow label="TTFT p95">{detail.ttft_p95_ms}ms</DetailRow>}
            {isModel && <DetailRow label="ITL avg">{detail.itl_avg_ms}ms</DetailRow>}
            <p className="slide-note">{isModel ? "모델 축 = vmselect 메트릭 실측." : "부서·앱·키 축 = 프록시→usage_rollup 귀속 집계(문서 §3-1)."}</p>
          </>
        )}
      </SlidePanel>
    </>
  );
}
