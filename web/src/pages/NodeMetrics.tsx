import { useCallback, useMemo, useState } from "react";
import { fetchNodeMetrics } from "../api/client";
import type { NodeMetrics, NodePoint, NodeStatus } from "../api/types";
import { statusFromThresholds, worstStatus } from "../api/mockFactory";
import Sparkline from "../components/Sparkline";
import MetricExplorer from "../components/MetricExplorer";
import StatMini from "../components/StatMini";
import Gauge from "../components/Gauge";
import { SummaryStrip, CategoryGrid, MetricCategoryCard } from "../components/MetricLayout";
import type { SummaryKPI } from "../components/MetricLayout";
import { SkeletonCards } from "../components/Skeleton";
import SlidePanel from "../components/SlidePanel";
import InfoTip from "../components/InfoTip";
import DataFreshness from "../components/DataFreshness";
import PauseToggle from "../components/PauseToggle";
import { usePolling } from "../utils/usePolling";
import { queryParam } from "../router";

// IMP-46 — 핵심 운용 메트릭 화면 (USE / 골든시그널 큐레이션, cause 뷰).
// node_exporter 는 수백 메트릭 — 전량 덤프("Node Exporter Full" id 1860)는 안티패턴.
// 온콜이 실제 보는 '핵심'(USE = Utilization/Saturation/Errors + Traffic)만 큐레이션한다
// (Grafana "USE Method / Node" id 13977 참조 세트). mock-first(IMP-55 fetchNodeMetrics).
// request-level RED 뷰(Traffic/Traces)와 구분되는 원인(cause) 뷰.

const REFRESH_MS = 15_000;
// mock 정합(mock.ts genGPU / buildTopology 호스트) — 실 수집 시 노드 인벤토리로 대체.
const HOSTS = ["gpu-node-01", "gpu-node-02", "gpu-node-03"];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const nf = new Intl.NumberFormat("ko-KR");

const STATUS_LABEL: Record<NodeStatus, string> = { ok: "정상", warn: "주의", crit: "위험" };
const STATUS_TAG: Record<NodeStatus, string> = { ok: "green", warn: "amber", crit: "red" };
// StatMini tone(green|red|amber) 매핑 — ok 는 톤 없음(중립).
const STATUS_TONE: Record<NodeStatus, "green" | "amber" | "red" | undefined> = {
  ok: undefined,
  warn: "amber",
  crit: "red",
};

// 위험 → 주의 → 정상 순으로 상단 정렬(통증 먼저). worstStatus 와 동일 위계.
function sevRank(s: NodeStatus): number {
  return s === "crit" ? 0 : s === "warn" ? 1 : 2;
}

// GPU utilCellColor/tempColor 관례 재사용: statusFromThresholds → 셀 색(단일 출처).
function cellColor(value: number, warn: number, crit: number): string | undefined {
  const s = statusFromThresholds(value, warn, crit);
  if (s === "crit") return "var(--red)";
  if (s === "warn") return "var(--amber)";
  return undefined;
}

// USE 신호 정의 — 큐레이션 세트(전량 아님). saturation 은 최강 강조(통증 예측).
interface Signal {
  key: keyof NodePoint;
  label: string;
  group: "util" | "saturation" | "errors" | "traffic";
  warn: number;
  crit: number;
  fmt: (v: number) => string;
}

// 임계는 buildNodeMetrics 의 status 파생과 동일 계열(단일 출처 규약).
const SIGNALS: Signal[] = [
  { key: "cpu_util", label: "CPU", group: "util", warn: 0.8, crit: 0.95, fmt: pct },
  { key: "mem_util", label: "메모리", group: "util", warn: 0.85, crit: 0.95, fmt: pct },
  { key: "disk_util", label: "디스크", group: "util", warn: 0.85, crit: 0.95, fmt: pct },
  { key: "load1", label: "Load 1m", group: "saturation", warn: 12, crit: 16, fmt: (v) => v.toFixed(1) },
  { key: "swap_used_perc", label: "Swap", group: "saturation", warn: 0.2, crit: 0.5, fmt: pct },
  { key: "disk_io_perc", label: "Disk IO", group: "saturation", warn: 0.7, crit: 0.9, fmt: pct },
  { key: "net_err_per_s", label: "Net 에러", group: "errors", warn: 5, crit: 20, fmt: (v) => `${v.toFixed(1)}/s` },
  { key: "net_rx_mbps", label: "Net RX", group: "traffic", warn: 1600, crit: 1900, fmt: (v) => `${nf.format(Math.round(v))}Mbps` },
  { key: "net_tx_mbps", label: "Net TX", group: "traffic", warn: 1600, crit: 1900, fmt: (v) => `${nf.format(Math.round(v))}Mbps` },
];

const GROUP_LABEL: Record<Signal["group"], string> = {
  util: "사용량 (Utilization)",
  saturation: "포화 (Saturation)",
  errors: "에러 (Errors)",
  traffic: "트래픽 (Traffic)",
};

// fleet 카드에 핵심만(4~6): CPU·메모리·Load·Swap·Disk IO·Net에러.
const FLEET_KEYS: Signal["key"][] = ["cpu_util", "mem_util", "load1", "swap_used_perc", "disk_io_perc", "net_err_per_s"];

function lastVal(m: NodeMetrics, key: keyof NodePoint): number {
  const p = m.points[m.points.length - 1];
  return p ? (p[key] as number) : 0;
}
function series(m: NodeMetrics, key: keyof NodePoint): number[] {
  return m.points.map((p) => p[key] as number);
}

// 호스트별 fetchNodeMetrics 병렬 조회(IMP-55). 일부 실패는 무시하고 성공분만 반환.
// 전부 실패하면 throw → usePolling 이 humanizeError + 마지막 데이터 유지 처리.
async function fetchAllNodes(signal: AbortSignal): Promise<NodeMetrics[]> {
  const results = await Promise.allSettled(HOSTS.map((h) => fetchNodeMetrics(h, "1h", signal)));
  const ok = results
    .filter((r): r is PromiseFulfilledResult<NodeMetrics> => r.status === "fulfilled")
    .map((r) => r.value);
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (ok.length === 0 && rejected.length > 0) {
    const reason = rejected[0].reason as Error;
    throw new Error(reason?.message ?? "노드 메트릭 조회 실패");
  }
  return ok;
}

export default function NodeMetrics() {
  // IMP-50: 토폴로지/트레이스에서 host 를 실어 드릴다운해 오면 해당 호스트 상세를 자동 오픈(correlation seed).
  const [selectedHost, setSelectedHost] = useState<string | null>(() => queryParam("host") ?? null);

  const {
    data: nodes,
    error,
    loading,
    lastLoaded,
    paused,
    isStale,
    reload,
    setPaused,
  } = usePolling<NodeMetrics[]>(fetchAllNodes, { intervalMs: REFRESH_MS });

  // 최신 point 기준 상태 재파생(단일 출처) — mock 이 준 status 도 동일하지만 정렬 키로 로컬 계산.
  const statusOf = useCallback((m: NodeMetrics): NodeStatus => {
    const statuses = SIGNALS.map((s) => statusFromThresholds(lastVal(m, s.key), s.warn, s.crit));
    return statuses.length ? worstStatus(statuses) : m.status;
  }, []);

  // 임계 초과 호스트 상단 정렬(통증 먼저). 동급이면 호스트명.
  const sorted = useMemo(() => {
    if (!nodes) return [];
    return [...nodes].sort((a, b) => {
      const d = sevRank(statusOf(a)) - sevRank(statusOf(b));
      return d !== 0 ? d : a.host.localeCompare(b.host);
    });
  }, [nodes, statusOf]);

  const riskCount = useMemo(() => sorted.filter((m) => statusOf(m) !== "ok").length, [sorted, statusOf]);
  const isEmpty = !!nodes && (nodes.length === 0 || nodes.every((m) => m.points.length === 0));

  const selected = selectedHost ? nodes?.find((m) => m.host === selectedHost) ?? null : null;

  return (
    <>
      <div className="page-head">
        <h1>노드 메트릭</h1>
        <span className="crumb">인프라 / 운용 메트릭 (USE)</span>
        <div className="spacer" />
        <DataFreshness updatedAt={lastLoaded} intervalMs={REFRESH_MS} />
        <PauseToggle paused={paused} onToggle={() => setPaused(!paused)} />
        <button type="button" className="refresh-btn" onClick={() => reload()} aria-label="노드 메트릭 새로고침">
          <span className="spin" aria-hidden="true">⟳</span>
          새로고침
        </button>
      </div>

      {/* mock 배지 + cause/RED 구분 안내(항상 노출 — 데이터 출처 투명성). */}
      <div className="node-mock-badge" role="note">
        <span className="tag tag-amber">mock 데이터</span>
        <span className="node-mock-text">
          실 수집은 node_exporter + Prometheus(IMP-41/52) 연동 시 — 자세한 계획은{" "}
          <code>evolve/plans/IMP-52-nodeexporter-spike.md</code>. 이 화면은 원인(cause)
          <b> USE</b> 뷰로, request-level <b>RED</b> 뷰(트래픽·트레이스)와 구분됩니다.
        </span>
      </div>

      {error && (
        <div className="state error" role="alert">
          노드 메트릭을 불러오지 못했습니다. ({error})
          {isStale && <span className="state-stale"> · 마지막으로 받은 데이터를 표시 중입니다.</span>}
        </div>
      )}
      {!error && loading && !nodes && <SkeletonCards count={3} />}

      {nodes && !isEmpty && (
        <>
          <p className="node-fleet-summary" aria-live="polite">
            호스트 <b>{sorted.length}</b>대 —{" "}
            임계 초과 <b className={riskCount > 0 ? "node-risk" : ""}>{riskCount}</b>대
            {riskCount > 0 && <> (위험·주의 호스트 상단 정렬)</>}
          </p>
          <div className="node-fleet">
            {sorted.map((m) => (
              <HostCard key={m.host} m={m} status={statusOf(m)} onOpen={() => setSelectedHost(m.host)} />
            ))}
          </div>
        </>
      )}

      {isEmpty && (
        <div className="card"><div className="empty">관측된 노드 메트릭이 없습니다.</div></div>
      )}

      <SlidePanel
        open={!!selected}
        title={selected ? `노드 상세 — ${selected.host}` : ""}
        subtitle={selected ? `${STATUS_LABEL[statusOf(selected)]} · USE 전체 신호 · 최근 1시간` : ""}
        onClose={() => setSelectedHost(null)}
        width={560}
      >
        {selected && <HostDetail m={selected} status={statusOf(selected)} />}
      </SlidePanel>
    </>
  );
}

// fleet 카드 — 상태 태그(색+텍스트 병기) + 포화 게이지 + 핵심 USE StatMini 그리드. 클릭 → 상세.
function HostCard({ m, status, onOpen }: { m: NodeMetrics; status: NodeStatus; onOpen: () => void }) {
  const fleetSignals = FLEET_KEYS.map((k) => SIGNALS.find((s) => s.key === k)!);
  // 포화 대표 신호(Load 1m) — 병목을 가장 먼저 예고하는 saturation. 임계밴드 게이지로 즉시 인지.
  const loadSig = SIGNALS.find((s) => s.key === "load1")!;
  const loadV = lastVal(m, "load1");
  return (
    <button type="button" className={`card node-card clickable node-card-${status}`} onClick={onOpen} aria-label={`${m.host} 상세 — 상태 ${STATUS_LABEL[status]}`}>
      <div className="card-head">
        <h3>{m.host}</h3>
        <span className={`tag tag-${STATUS_TAG[status]}`}>{STATUS_LABEL[status]}</span>
        <span className="spacer" />
        <span className="node-card-hint" aria-hidden="true">상세 ›</span>
      </div>
      <div className="node-gauge-row">
        <span className="node-gauge-label">포화 · {loadSig.label}</span>
        <Gauge value={loadV} warn={loadSig.warn} crit={loadSig.crit} valueText={loadSig.fmt(loadV)} label={loadSig.label} />
        <span className="node-gauge-val">{loadSig.fmt(loadV)}</span>
      </div>
      <div className="node-card-metrics">
        {fleetSignals.map((s) => {
          const v = lastVal(m, s.key);
          const st = statusFromThresholds(v, s.warn, s.crit);
          return (
            <StatMini
              key={s.key}
              label={s.label}
              value={s.fmt(v)}
              tone={STATUS_TONE[st]}
              spark={series(m, s.key)}
            />
          );
        })}
      </div>
    </button>
  );
}

// per-host 상세 — IMP-80 3층 위계: (1)요약 스트립 → (2)USE 카테고리 카드 그리드 → (3)전체 메트릭.
// 각 카드 body 는 기존 node-dd-row(스파크라인+값+상태 텍스트)를 그대로 유지(WCAG·IMP-25 회귀 없음).
function HostDetail({ m, status }: { m: NodeMetrics; status: NodeStatus }) {
  if (m.points.length === 0) {
    return <p className="rank-empty">이 노드의 시계열 데이터가 아직 충분하지 않습니다.</p>;
  }
  const groups: Signal["group"][] = ["util", "saturation", "errors", "traffic"];

  // (Tier 1) 요약 스트립 — 상태 + 대표 포화(Load) + 핵심 사용량(CPU·메모리) 게이지. IMP-54 Gauge.
  const summaryKeys: Signal["key"][] = ["load1", "cpu_util", "mem_util"];
  const kpis: SummaryKPI[] = summaryKeys.map((k) => {
    const sig = SIGNALS.find((s) => s.key === k)!;
    const v = lastVal(m, k);
    return {
      label: sig.label,
      valueText: sig.fmt(v),
      status: statusFromThresholds(v, sig.warn, sig.crit),
      gauge: { value: v, warn: sig.warn, crit: sig.crit },
    };
  });

  return (
    <>
      {/* (Tier 1) 요약 스트립 — 상태 배지 + 핵심 KPI 게이지. */}
      <div className="metric-detail-top">
        <span className={`tag tag-${STATUS_TAG[status]}`}>{STATUS_LABEL[status]}</span>
        <span className="metric-detail-src">데이터 출처 <code>{m.source}</code></span>
      </div>
      <SummaryStrip items={kpis} />

      {/* (Tier 2) USE 카테고리 카드 그리드 — 반응형 2~3열. 카드 헤더 = 최악 상태 배지 + 대표 신호 mini 스파크라인. */}
      <CategoryGrid>
        {groups.map((g) => {
          const sigs = SIGNALS.filter((s) => s.group === g);
          // 카테고리 최악 상태 + 대표 신호(그룹 첫 신호)로 헤더 스파크라인.
          const worst = worstStatus(sigs.map((s) => statusFromThresholds(lastVal(m, s.key), s.warn, s.crit)));
          const lead = sigs[0];
          return (
            <MetricCategoryCard
              key={g}
              title={GROUP_LABEL[g]}
              status={worst}
              spark={{
                values: series(m, lead.key),
                status: statusFromThresholds(lastVal(m, lead.key), lead.warn, lead.crit),
                warnValue: lead.warn,
                critValue: lead.crit,
              }}
            >
              {sigs.map((s) => {
                const v = lastVal(m, s.key);
                const color = cellColor(v, s.warn, s.crit);
                const st = statusFromThresholds(v, s.warn, s.crit);
                const sparkColor = st === "crit" ? "var(--red)" : st === "warn" ? "var(--amber)" : "var(--primary)";
                return (
                  <div className="node-dd-row" key={s.key}>
                    <span className="node-dd-label">{s.label}</span>
                    <Sparkline values={series(m, s.key)} color={sparkColor} width={240} height={30} warnValue={s.warn} critValue={s.crit} />
                    <span className="node-dd-cur" style={color ? { color, fontWeight: 600 } : undefined}>
                      {s.fmt(v)}
                      {/* 색-only 금지: 임계 시 상태 텍스트 병기(WCAG 1.4.1). */}
                      {st !== "ok" && <span className="node-dd-flag"> · {STATUS_LABEL[st]}</span>}
                    </span>
                  </div>
                );
              })}
            </MetricCategoryCard>
          );
        })}
      </CategoryGrid>

      <p className="node-dd-hint">
        <InfoTip>Saturation(Load·Swap·Disk IO)은 병목을 가장 먼저 예고하는 신호라 강조합니다.</InfoTip>
        {" "}USE = Utilization·Saturation·Errors. 큐레이션 세트(전량 나열 아님).
      </p>

      {/* 전체 메트릭(IMP-71) — 큐레이션 USE 뷰(위)는 그대로, 명시적 탈출구. node_exporter 전량 카테고리·검색·facet·단위.
          NodeMetrics.tsx:17 안티패턴 주석은 DEFAULT 대시보드에만 유효 — on-demand explorer 는 sanctioned. */}
      <details className="me-disclosure">
        <summary className="me-disclosure-head">
          <span className="me-disclosure-caret" aria-hidden="true">▸</span>
          전체 메트릭 (node_exporter 전량 — 카테고리·검색·단위)
        </summary>
        <MetricExplorer entityId={`node:${m.host}`} />
      </details>
    </>
  );
}
