import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMetricDimensions, fetchMetricsBreakdown } from "../api/client";
import type { MetricDimension, MetricMeta, MetricsBreakdown, MetricsBreakdownRow, TimeRange } from "../api/types";
import { formatMetric } from "../utils/format";
import InfoTip from "./InfoTip";

// DimensionBreakdown — L2(Group) 공통 컴포넌트.
// 차원(model|endpoint|namespace) 셀렉터 + /metrics/breakdown 표 + 카탈로그 기반 이상강조(C6).
// 행 클릭 → onDrill(row, dim) 로 drill-through(예: trace 로 점프) — L2→L3.
// 차원/메트릭 의미는 /metrics/dimensions(카탈로그)에서 받아 UI·툴팁·이상강조를 한 출처로 그린다.

// 표시할 측정 컬럼 순서(카탈로그 key 기준). 카탈로그에 없는 key 는 무시.
const COLS = ["requests", "qps", "ttft_p95_ms", "itl_avg_ms", "e2e_p95_ms", "cache_hit_rate", "prompt_tokens", "completion_tokens"] as const;

function cellValue(row: MetricsBreakdownRow, key: string): number {
  return (row as unknown as Record<string, number>)[key] ?? 0;
}

// median 은 상대 이상치(컬럼 중앙값 대비 편차) 판정 기준(백엔드 미제공 시 폴백용).
function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// isWarn — 카탈로그 임계치(절대) + 컬럼 중앙값 대비(상대) 로 이상 여부. 방향(lower_better) 반영.
function isWarn(meta: MetricMeta, v: number, med: number): boolean {
  if (meta.lower_better) {
    if (meta.warn_above && v > meta.warn_above) return true;
    return med > 0 && v > med * 1.6;
  }
  if (meta.warn_below && v > 0 && v < meta.warn_below) return true;
  return false; // requests/qps/tokens 등 방향 없는 양은 경고 안 함
}

export default function DimensionBreakdown({
  range,
  initialDim = "model",
  title = "차원별 분해 (L2)",
  onDrill,
  drillableDims,
}: {
  range: TimeRange;
  initialDim?: string;
  title?: string;
  onDrill?: (row: MetricsBreakdownRow, dim: string) => void;
  drillableDims?: string[]; // 트레이스 드릴다운이 실제 동작하는 차원(미지정=전부). 그 외엔 false affordance 제거.
}) {
  const [dims, setDims] = useState<MetricDimension[]>([]);
  const [catalog, setCatalog] = useState<MetricMeta[]>([]);
  const [dim, setDim] = useState(initialDim);
  const [data, setData] = useState<MetricsBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<string>("requests");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // 같은 컬럼 재클릭 → 방향 토글, 다른 컬럼 → 그 컬럼 내림차순(IMP-3).
  const toggleSort = (k: string) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  // 차원/카탈로그는 1회 로드.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchMetricDimensions(ctrl.signal)
      .then((r) => { setDims(r.dimensions); setCatalog(r.metrics); })
      .catch(() => { /* 폴백: 차원 셀렉터만 비활성 */ });
    return () => ctrl.abort();
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await fetchMetricsBreakdown(range, dim, signal);
        setData(r);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [range, dim],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const metaByKey = useMemo(() => Object.fromEntries(catalog.map((m) => [m.key, m])), [catalog]);
  const cols = useMemo(() => COLS.filter((k) => metaByKey[k]), [metaByKey]);
  const medians = useMemo(() => {
    const rows = data?.rows ?? [];
    const out: Record<string, number> = {};
    for (const k of cols) out[k] = median(rows.map((r) => cellValue(r, k)));
    return out;
  }, [data, cols]);

  const rows = useMemo(() => {
    const rs = [...(data?.rows ?? [])];
    rs.sort((a, b) => {
      const d = cellValue(b, sortKey) - cellValue(a, sortKey); // 내림차순 기준
      return sortDir === "asc" ? -d : d;
    });
    return rs;
  }, [data, sortKey, sortDir]);

  const dimTitle = dims.find((d) => d.key === dim)?.title ?? dim;
  // 현재 차원에서 트레이스 드릴다운이 실제로 동작하는가 — 미지원 차원의 false affordance 방지(IMP-1).
  const canDrill = !!onDrill && (!drillableDims || drillableDims.includes(dim));

  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        <InfoTip label="차원 분해 도움말">동일 메트릭을 차원으로 분해해 어느 그룹이 튀는지 봅니다. 주황 = 임계치 초과 또는 그룹 중앙값 대비 이상.</InfoTip>
        <span className="spacer" />
        <select
          className="range-select"
          value={dim}
          onChange={(e) => { setLoading(true); setDim(e.target.value); }}
          aria-label="groupby 차원"
          disabled={dims.length === 0}
        >
          {(dims.length ? dims : [{ key: dim, label: dim, title: dim }]).map((d) => (
            <option key={d.key} value={d.key}>차원: {d.title}</option>
          ))}
        </select>
      </div>

      {error && <div className="empty" role="alert">분해를 불러오지 못했습니다. ({error})</div>}
      {!error && loading && !data && <div className="empty">불러오는 중…</div>}
      {!error && data && rows.length === 0 && <div className="empty">선택한 기간/차원에 데이터가 없습니다.</div>}

      {!error && rows.length > 0 && onDrill && !canDrill && (
        <div className="muted" style={{ fontSize: "0.8rem", paddingBottom: "0.5rem" }}>
          이 차원({dimTitle})은 트레이스 드릴다운을 지원하지 않습니다.
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {data && rows.length > 0 ? `정렬 기준 ${metaByKey[sortKey]?.title ?? sortKey}, ${sortDir === "asc" ? "오름차순" : "내림차순"}` : ""}
      </div>

      {!error && rows.length > 0 && (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="데이터 표 — 좌우 스크롤 가능">
        <table className="usage-table">
          <thead>
            <tr>
              <th>{dimTitle}</th>
              {cols.map((k) => {
                const m = metaByKey[k];
                return (
                  <th
                    key={k}
                    className={`num sortable${sortKey === k ? " active" : ""}`}
                    aria-sort={sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <button
                      type="button"
                      className="th-sort"
                      onClick={() => toggleSort(k)}
                      title={`${m.desc}${m.related?.length ? ` · 함께 보기: ${m.related.join(", ")}` : ""} · 클릭: ${m.title} 정렬`}
                    >
                      {m.title}
                      {sortKey === k && <span aria-hidden="true">{sortDir === "asc" ? " ▲" : " ▼"}</span>}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className={canDrill ? "clickable" : undefined}
                onClick={canDrill ? () => onDrill!(r, dim) : undefined}
                title={canDrill ? "트레이스로 드릴다운" : undefined}
              >
                <td>{r.key}</td>
                {cols.map((k) => {
                  const m = metaByKey[k];
                  const v = cellValue(r, k);
                  // 백엔드(domain.AnnotateWarnings)가 내려준 판정을 단일 출처로 사용.
                  // `warn` 은 항상 직렬화되므로(위반 없으면 false) 그 존재로 백엔드 annotate 여부를 판별 —
                  // warn_keys 는 omitempty 라 위반 없는 행에선 생략됨. 미제공(프론트 mock)일 때만 isWarn 폴백.
                  const warn = r.warn !== undefined ? !!r.warn_keys?.includes(k) : isWarn(m, v, medians[k]);
                  return (
                    <td key={k} className="num">
                      <span style={warn ? { color: "var(--amber, #d98e00)", fontWeight: 600 } : undefined}
                        title={warn ? (m.lower_better ? "임계치/중앙값 대비 높음" : "임계치 미만") : undefined}>
                        {formatMetric(m.unit, v)}{warn ? (m.lower_better ? " ▲" : " ▼") : ""}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
