// 엔티티-앵커 Metric Explorer (IMP-71) — GPU·노드 전량 메트릭 드릴다운.
// 큐레이션 요약(IMP-46/Gpu SlidePanel/ObjectView Properties)은 KNOWNS 대시보드로 그대로 두고, 이 컴포넌트는
// UNKNOWNS 검색가능 전량 드릴다운(Splunk Observability Metric Explorer 의 entity→all-metrics→drill 미러).
// 온톨로지 객체(GpuDevice/Node)가 엔티티 앵커 — entityId 만 주면 그 엔티티가 emit 하는 모든 메트릭을
// 카테고리 트리(접힘/펼침) + 자유텍스트 검색 + label/tag facet 필터 + 단위/타입/신선도/임계/스파크라인으로.
//
//  - 데이터: fetchObjectMetricTree(entityId, range) — mock/실백엔드 동일 계약(ObjectMetricTree).
//  - 수백 행: 펼친 카테고리의 행을 평탄화해 VirtualRows(IMP-30) 게이트로 windowing.
//  - 표준 triad: loading(skeleton) / empty(0 메트릭) / error(재시도).
//  - raw DCGM/node exporter 값은 단위 없이 무의미 → TYPE+UNIT 항상 병기. 색-only 금지(상태 텍스트 병기).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchObjectMetricTree } from "../api/client";
import type { MetricRow, MetricStatus, MetricType, ObjectMetricTree } from "../api/types";
import { humanizeError } from "../utils/errors";
import { formatBytes } from "./GpuHardwareSection";
import Sparkline from "./Sparkline";
import VirtualRows from "./VirtualRows";

const nf = new Intl.NumberFormat("ko-KR");

// MetricType → 짧은 뱃지 라벨(툴팁으로 의미). raw 값 해석에 필수(counter=단조누적 vs gauge=순간값).
const TYPE_LABEL: Record<MetricType, string> = { gauge: "gauge", counter: "counter", rate: "rate" };
const TYPE_HINT: Record<MetricType, string> = {
  gauge: "순간값(현재 상태)",
  counter: "단조 누적(증가만) — 비율은 rate()로",
  rate: "초당 비율",
};

const STATUS_LABEL: Record<MetricStatus, string> = { ok: "정상", warn: "주의", crit: "위험", none: "" };
// 상태 색 — 임계 밴드. none 은 중립(색 없음). 색+텍스트 병기(WCAG 1.4.1).
const STATUS_COLOR: Record<MetricStatus, string | undefined> = {
  ok: undefined, warn: "var(--amber)", crit: "var(--red)", none: undefined,
};
function sparkColor(s: MetricStatus): string {
  return s === "crit" ? "var(--red)" : s === "warn" ? "var(--amber)" : "var(--primary)";
}

// 값+단위 포맷 — 단위별로 사람이 읽게. bytes 는 GpuHardwareSection.formatBytes(단일 출처) 재사용.
function fmtValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "—";
  switch (unit) {
    case "bytes": return formatBytes(value);
    case "%": return `${value.toFixed(1)}%`;
    case "°C": return `${Math.round(value)}°C`;
    case "W": return `${nf.format(Math.round(value))} W`;
    case "MHz": return `${nf.format(Math.round(value))} MHz`;
    case "MiB": return `${nf.format(Math.round(value))} MiB`;
    case "mJ": return `${nf.format(Math.round(value))} mJ`;
    case "KiB/s": {
      if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} GiB/s`;
      if (value >= 1024) return `${(value / 1024).toFixed(1)} MiB/s`;
      return `${nf.format(Math.round(value))} KiB/s`;
    }
    case "Mbps": return `${nf.format(Math.round(value))} Mbps`;
    case "err/s": return `${value.toFixed(2)} /s`;
    case "req/s": return `${value.toFixed(1)} req/s`;
    case "seconds": return `${nf.format(Math.round(value))} s`;
    case "count": return `${nf.format(Math.round(value))} count`;
    case "load": return value.toFixed(2);
    case "code": return String(Math.round(value));
    case "bitmask": return `0x${(Math.round(value) >>> 0).toString(16)}`;
    default: return unit ? `${nf.format(+value.toFixed(2))} ${unit}` : nf.format(+value.toFixed(2));
  }
}

// 검색·facet 매칭 대상 텍스트(메트릭명·라벨·facet 값). 소문자 부분일치.
function rowHaystack(r: MetricRow): string {
  return `${r.key} ${r.label} ${Object.values(r.facets).join(" ")}`.toLowerCase();
}

interface MetricExplorerProps {
  entityId: string;             // 온톨로지 객체 id(gpu:… / node:…) — 엔티티 앵커.
  range?: string;               // 1h|6h|24h|7d (기본 1h)
  /** 테스트 주입용: VirtualRows viewport 강제(jsdom 레이아웃 0 대비). */
  viewportOverride?: { scrollTop: number; clientHeight: number };
}

export default function MetricExplorer({ entityId, range = "1h", viewportOverride }: MetricExplorerProps) {
  const [tree, setTree] = useState<ObjectMetricTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [facetKey, setFacetKey] = useState<string>("");   // 선택 facet 키(빈="전체")
  const [facetVal, setFacetVal] = useState<string>("");   // 선택 facet 값
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    fetchObjectMetricTree(entityId, range, signal)
      .then((t) => { setTree(t); setError(null); })
      .catch((e) => { if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message)); })
      .finally(() => setLoading(false));
  }, [entityId, range]);

  useEffect(() => {
    const ac = new AbortController();
    setTree(null);
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // facet 값 후보 — 선택된 facetKey 의 모든 값(중복 제거, 결정적 정렬).
  const facetValues = useMemo(() => {
    if (!tree || !facetKey) return [];
    const set = new Set<string>();
    for (const c of tree.categories) for (const r of c.rows) {
      const v = r.facets[facetKey];
      if (v) set.add(v);
    }
    return [...set].sort();
  }, [tree, facetKey]);

  // 검색 + facet 필터 적용된 카테고리(빈 카테고리는 제외). 원본 순서 보존(결정적).
  const filtered = useMemo(() => {
    if (!tree) return [];
    const q = query.trim().toLowerCase();
    return tree.categories
      .map((c) => ({
        ...c,
        rows: c.rows.filter((r) => {
          if (facetKey && facetVal && r.facets[facetKey] !== facetVal) return false;
          if (q && !rowHaystack(r).includes(q)) return false;
          return true;
        }),
      }))
      .filter((c) => c.rows.length > 0);
  }, [tree, query, facetKey, facetVal]);

  const totalRows = useMemo(() => filtered.reduce((s, c) => s + c.rows.length, 0), [filtered]);

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // 펼친 카테고리의 행을 (카테고리 헤더 + 행)으로 평탄화 → windowing 대상(수백 행 대비).
  // 검색 중이면 전부 펼쳐 보여준다(발견 우선).
  const searching = query.trim().length > 0 || !!(facetKey && facetVal);
  type FlatItem =
    | { kind: "header"; catKey: string; label: string; count: number; open: boolean }
    | { kind: "row"; row: MetricRow };
  const flat = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    for (const c of filtered) {
      const open = searching || !collapsed.has(c.key);
      out.push({ kind: "header", catKey: c.key, label: c.label, count: c.rows.length, open });
      if (open) for (const r of c.rows) out.push({ kind: "row", row: r });
    }
    return out;
  }, [filtered, collapsed, searching]);

  // ── triad: error → loading → empty → 트리 ──
  if (error) {
    return (
      <div className="me-state state error" role="alert">
        전체 메트릭을 불러오지 못했습니다. ({error})
        <button type="button" className="btn-ghost btn-sm me-retry" onClick={() => load()}>다시 시도</button>
      </div>
    );
  }
  if (loading && !tree) {
    return (
      <div className="me-loading" role="status" aria-live="polite">
        <div className="me-skel" /><div className="me-skel" /><div className="me-skel" />
        <span className="me-loading-text">전체 메트릭을 불러오는 중…</span>
      </div>
    );
  }
  const noMetrics = !tree || tree.categories.length === 0;
  if (noMetrics) {
    return (
      <div className="me-state empty">
        이 엔티티에서 수집된 메트릭이 없습니다.
        {tree && tree.object_type !== "GpuDevice" && tree.object_type !== "Node" && (
          <span className="me-empty-hint"> (Metric Explorer 는 GPU·노드 엔티티에만 제공됩니다.)</span>
        )}
      </div>
    );
  }

  return (
    <div className="me-explorer">
      {/* 컨트롤 — facet 셀렉터 + 자유텍스트 검색(faceted-then-search, NN/g). */}
      <div className="me-controls">
        {tree.facet_keys.length > 0 && (
          <div className="me-facets" role="group" aria-label="facet 필터">
            <select
              className="me-facet-key"
              aria-label="facet 종류"
              value={facetKey}
              onChange={(e) => { setFacetKey(e.target.value); setFacetVal(""); }}
            >
              <option value="">전체 (facet 없음)</option>
              {tree.facet_keys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {facetKey && (
              <select
                className="me-facet-val"
                aria-label={`${facetKey} 값`}
                value={facetVal}
                onChange={(e) => setFacetVal(e.target.value)}
              >
                <option value="">— {facetKey} 선택 —</option>
                {facetValues.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
          </div>
        )}
        <input
          type="search"
          className="me-search"
          placeholder="메트릭 이름·라벨 검색 (예: NVLINK, ECC, FB_USED)"
          aria-label="메트릭 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="me-count" aria-live="polite">
        {totalRows}개 메트릭
        {searching && <> · 필터됨</>}
        <span className="me-source">{tree.source}</span>
      </div>

      {totalRows === 0 ? (
        <div className="me-state empty">검색·필터에 맞는 메트릭이 없습니다.</div>
      ) : (
        <div className="me-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="전체 메트릭 목록 — 세로 스크롤">
          <table className="me-table">
            <tbody>
              <VirtualRows
                items={flat}
                colSpan={4}
                rowHeight={38}
                threshold={40}
                scrollRef={scrollRef}
                viewportOverride={viewportOverride}
              >
                {(item, i) =>
                  item.kind === "header" ? (
                    <tr key={`h-${item.catKey}-${i}`} className="me-cat-row">
                      <td colSpan={4}>
                        <button
                          type="button"
                          className="me-cat-head"
                          aria-expanded={item.open}
                          onClick={() => toggle(item.catKey)}
                          disabled={searching}
                        >
                          <span className={`me-caret ${item.open ? "open" : ""}`} aria-hidden="true">▸</span>
                          <span className="me-cat-label">{item.label}</span>
                          <span className="me-cat-count">{item.count}</span>
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <MetricRowView key={`r-${item.row.key}-${i}`} row={item.row} />
                  )
                }
              </VirtualRows>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// 한 메트릭 행 — 이름/라벨 + TYPE + UNIT값 + 상태 + 신선도 + 스파크라인 + pin 힌트.
function MetricRowView({ row }: { row: MetricRow }) {
  const color = STATUS_COLOR[row.status];
  return (
    <tr className="me-row">
      <td className="me-row-name">
        <span className="me-row-label">{row.label}</span>
        <code className="me-row-key" title={row.key}>{row.key}</code>
      </td>
      <td className="me-row-meta">
        <span className="me-type" title={TYPE_HINT[row.type]}>{TYPE_LABEL[row.type]}</span>
        <span className="me-fresh" title="마지막 스크랩 경과">{row.freshness_sec}s 전</span>
      </td>
      <td className="me-row-spark">
        <Sparkline values={row.points} color={sparkColor(row.status)} width={120} height={26} />
      </td>
      <td className="me-row-val">
        <span className="me-val" style={color ? { color, fontWeight: 700 } : undefined}>
          {fmtValue(row.value, row.unit)}
        </span>
        {/* 색-only 금지: 임계 시 상태 텍스트 병기(WCAG 1.4.1). */}
        {row.status !== "none" && row.status !== "ok" && (
          <span className="me-flag" style={color ? { color } : undefined}> · {STATUS_LABEL[row.status]}</span>
        )}
        {/* pin to curated view 힌트(IMP-71 nice-to-have) — unknowns→knowns 루프. 실제 mutation 없이 안내만. */}
        <span className="me-pin-hint" title="이 메트릭을 요약 대시보드(USE/RED)로 승격 — 향후 지원">📌 요약에 고정</span>
      </td>
    </tr>
  );
}
