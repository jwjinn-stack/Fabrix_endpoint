import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchNodeMetrics } from "../api/client";
import type { NodeMetrics, NodePoint, NodeStatus } from "../api/types";
import { statusFromThresholds, worstStatus } from "../api/mockFactory";
import Sparkline from "../components/Sparkline";
import StatMini from "../components/StatMini";
import { SkeletonCards } from "../components/Skeleton";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import InfoTip from "../components/InfoTip";
import DataFreshness from "../components/DataFreshness";
import { humanizeError } from "../utils/errors";

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

export default function NodeMetrics() {
  const [nodes, setNodes] = useState<NodeMetrics[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      // 호스트별 fetchNodeMetrics 병렬 조회(IMP-55). 일부 실패는 무시하고 성공분만 표시.
      const results = await Promise.allSettled(HOSTS.map((h) => fetchNodeMetrics(h, "1h", signal)));
      if (signal?.aborted) return;
      const ok = results
        .filter((r): r is PromiseFulfilledResult<NodeMetrics> => r.status === "fulfilled")
        .map((r) => r.value);
      const rejected = results.filter((r) => r.status === "rejected");
      if (ok.length === 0 && rejected.length > 0) {
        const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
        if (reason?.name === "AbortError") return;
        setError(humanizeError(reason?.message ?? "노드 메트릭 조회 실패"));
      } else {
        setNodes(ok);
        setLastLoaded(Date.now());
        setError(null);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
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
        <button type="button" className="refresh-btn" onClick={() => load()} aria-label="노드 메트릭 새로고침">
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

// fleet 카드 — 상태 태그(색+텍스트 병기) + 핵심 USE StatMini 그리드. 클릭 → 상세.
function HostCard({ m, status, onOpen }: { m: NodeMetrics; status: NodeStatus; onOpen: () => void }) {
  const fleetSignals = FLEET_KEYS.map((k) => SIGNALS.find((s) => s.key === k)!);
  return (
    <button type="button" className={`card node-card clickable node-card-${status}`} onClick={onOpen} aria-label={`${m.host} 상세 — 상태 ${STATUS_LABEL[status]}`}>
      <div className="card-head">
        <h3>{m.host}</h3>
        <span className={`tag tag-${STATUS_TAG[status]}`}>{STATUS_LABEL[status]}</span>
        <span className="spacer" />
        <span className="node-card-hint" aria-hidden="true">상세 ›</span>
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

// per-host 상세 — USE 그룹별 전체 신호(스파크라인 + 최신값 + 임계 색·텍스트).
function HostDetail({ m, status }: { m: NodeMetrics; status: NodeStatus }) {
  if (m.points.length === 0) {
    return <p className="rank-empty">이 노드의 시계열 데이터가 아직 충분하지 않습니다.</p>;
  }
  const groups: Signal["group"][] = ["util", "saturation", "errors", "traffic"];
  return (
    <>
      <DetailRow label="상태">
        <span className={`tag tag-${STATUS_TAG[status]}`}>{STATUS_LABEL[status]}</span>
      </DetailRow>
      <DetailRow label="데이터 출처"><code>{m.source}</code></DetailRow>
      {groups.map((g) => (
        <div key={g} className="node-dd-group">
          <h4 className="node-dd-gtitle">{GROUP_LABEL[g]}</h4>
          {SIGNALS.filter((s) => s.group === g).map((s) => {
            const v = lastVal(m, s.key);
            const color = cellColor(v, s.warn, s.crit);
            const st = statusFromThresholds(v, s.warn, s.crit);
            const sparkColor = st === "crit" ? "var(--red)" : st === "warn" ? "var(--amber)" : "var(--primary)";
            return (
              <div className="node-dd-row" key={s.key}>
                <span className="node-dd-label">{s.label}</span>
                <Sparkline values={series(m, s.key)} color={sparkColor} width={240} height={30} />
                <span className="node-dd-cur" style={color ? { color, fontWeight: 600 } : undefined}>
                  {s.fmt(v)}
                  {/* 색-only 금지: 임계 시 상태 텍스트 병기(WCAG 1.4.1). */}
                  {st !== "ok" && <span className="node-dd-flag"> · {STATUS_LABEL[st]}</span>}
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <p className="node-dd-hint">
        <InfoTip>Saturation(Load·Swap·Disk IO)은 병목을 가장 먼저 예고하는 신호라 강조합니다.</InfoTip>
        {" "}USE = Utilization·Saturation·Errors. 큐레이션 세트(전량 나열 아님).
      </p>
    </>
  );
}
