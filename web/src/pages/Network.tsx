import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchNetwork } from "../api/client";
import type { NetworkLink, NetworkPoint, NodeStatus, TimeRange } from "../api/types";
import { statusFromThresholds, worstStatus } from "../api/mockFactory";
import type { NavFn } from "../router";
import Sparkline from "../components/Sparkline";
import StatMini from "../components/StatMini";
import { SkeletonCards } from "../components/Skeleton";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import InfoTip from "../components/InfoTip";
import DataFreshness from "../components/DataFreshness";
import { humanizeError } from "../utils/errors";

// IMP-49 — 네트워크 모니터링 화면 (대역폭·지연·연결·에러) — mock-first.
// '네트워크 그 자체'(링크 rx/tx 대역폭, 지연 p50/p95/p99, 패킷손실, 인터페이스 에러/드롭)의
// 시계열 뷰. Traffic.tsx(앱층 프록시 지연)·Diagnostics(도달성 스냅샷)와 구분되는 인프라 층.
// 온콜 triage = 분리 아닌 상관 → hot link 상세에서 앱층(Traffic)으로 cross-layer pivot.
// 참조: USE method(id 13977)·node_exporter netdev·network monitoring best practices(p95/p99).
// mock-first(IMP-55 fetchNetwork). IMP-46 NodeMetrics 구조·CSS(node-*) 미러.

const REFRESH_MS = 15_000;

// 기본 시간창 = 단기 인시던트 뷰(짧은 창 우선). zoom = 범위 셀렉터.
const RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "1시간" },
  { value: "6h", label: "6시간" },
  { value: "24h", label: "24시간" },
  { value: "7d", label: "7일" },
];

const nf = new Intl.NumberFormat("ko-KR");
const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 2 : 0)}%`;
const ms = (v: number) => `${v.toFixed(1)}ms`;
// 대역폭 자동 단위(Mbps→Gbps). node_exporter netdev 는 bytes 지만 mock 은 Mbps 로 정규화.
const bw = (mbps: number) => (mbps >= 1000 ? `${(mbps / 1000).toFixed(1)}Gbps` : `${nf.format(Math.round(mbps))}Mbps`);

const STATUS_LABEL: Record<NodeStatus, string> = { ok: "정상", warn: "주의", crit: "위험" };
const STATUS_TAG: Record<NodeStatus, string> = { ok: "green", warn: "amber", crit: "red" };
const STATUS_TONE: Record<NodeStatus, "green" | "amber" | "red" | undefined> = {
  ok: undefined,
  warn: "amber",
  crit: "red",
};

// 위험 → 주의 → 정상. worstStatus 와 동일 위계.
function sevRank(s: NodeStatus): number {
  return s === "crit" ? 0 : s === "warn" ? 1 : 2;
}

// 색-only 금지(WCAG 1.4.1): 셀 색 + 상태 텍스트 병기용 상태 파생(단일 출처).
function cellColor(status: NodeStatus): string | undefined {
  if (status === "crit") return "var(--red)";
  if (status === "warn") return "var(--amber)";
  return undefined;
}
function sparkColor(status: NodeStatus): string {
  return status === "crit" ? "var(--red)" : status === "warn" ? "var(--amber)" : "var(--primary)";
}

// 신호 정의 — 임계는 statusFromThresholds 단일출처(buildNetwork status 파생과 동일 계열).
// utilization warn=75%/crit=90%, retransmit(=loss) warn=1%/crit=2% (IMP-49 스펙).
const LAT_WARN = 6;
const LAT_CRIT = 12;
const LOSS_WARN = 0.005;
const LOSS_CRIT = 0.02;
const RETX_WARN = 0.01; // retransmit warn=1%
const RETX_CRIT = 0.02; // retransmit crit=2%
const UTIL_WARN = 0.75;
const UTIL_CRIT = 0.9;
const ERR_WARN = 5;
const ERR_CRIT = 20;

function lastPoint(l: NetworkLink): NetworkPoint | undefined {
  return l.points[l.points.length - 1];
}

// 링크 이용률 = max(rx,tx)/capacity. capacity=0 방어.
function utilOf(p: NetworkPoint, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.max(p.rx_mbps, p.tx_mbps) / capacity;
}

// mock 은 retransmit 별도 필드가 없어 loss_perc 를 retransmit 대리 지표로 사용(재전송∝손실).
function retxOf(p: NetworkPoint): number {
  return p.loss_perc;
}

// 링크 상태 로컬 파생(단일 출처) — util·p95·loss·retransmit·errs 최악값. 정렬 키로도 사용.
function linkStatus(l: NetworkLink): NodeStatus {
  const p = lastPoint(l);
  if (!p) return l.status;
  return worstStatus([
    statusFromThresholds(utilOf(p, l.capacity_mbps), UTIL_WARN, UTIL_CRIT),
    statusFromThresholds(p.latency_p95_ms, LAT_WARN, LAT_CRIT),
    statusFromThresholds(p.loss_perc, LOSS_WARN, LOSS_CRIT),
    statusFromThresholds(retxOf(p), RETX_WARN, RETX_CRIT),
    statusFromThresholds(p.errs_per_s, ERR_WARN, ERR_CRIT),
  ]);
}

// error+retransmit 급증 우선 → 상태 → id. 통증(에러/재전송) 먼저.
function errStatus(l: NetworkLink): NodeStatus {
  const p = lastPoint(l);
  if (!p) return "ok";
  return worstStatus([
    statusFromThresholds(p.errs_per_s, ERR_WARN, ERR_CRIT),
    statusFromThresholds(retxOf(p), RETX_WARN, RETX_CRIT),
    statusFromThresholds(p.loss_perc, LOSS_WARN, LOSS_CRIT),
  ]);
}

function series(l: NetworkLink, sel: (p: NetworkPoint) => number): number[] {
  return l.points.map(sel);
}

export default function Network({ onNavigate }: { onNavigate: NavFn }) {
  const [links, setLinks] = useState<NetworkLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [range, setRange] = useState<TimeRange>("1h"); // 단기 인시던트 뷰 기본
  const [linkFilter, setLinkFilter] = useState<string>("all"); // 인터페이스/링크 셀렉터
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (r: TimeRange, signal?: AbortSignal) => {
    try {
      const rep = await fetchNetwork(r, signal);
      if (signal?.aborted) return;
      setLinks(rep.links);
      setLastLoaded(Date.now());
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(range, ctrl.signal);
    const id = setInterval(() => load(range), REFRESH_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, [load, range]);

  // 인터페이스/링크 필터 적용.
  const filtered = useMemo(() => {
    if (!links) return [];
    return linkFilter === "all" ? links : links.filter((l) => l.id === linkFilter);
  }, [links, linkFilter]);

  // error+retransmit 급증 우선 → 상태 → id 정렬(통증 먼저).
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const de = sevRank(errStatus(a)) - sevRank(errStatus(b));
      if (de !== 0) return de;
      const ds = sevRank(linkStatus(a)) - sevRank(linkStatus(b));
      return ds !== 0 ? ds : a.id.localeCompare(b.id);
    });
  }, [filtered]);

  const riskCount = useMemo(() => sorted.filter((l) => linkStatus(l) !== "ok").length, [sorted]);
  const isEmpty = !!links && (links.length === 0 || links.every((l) => l.points.length === 0));

  // KPI — worst-link p95(꼬리 지연 우선, avg 아님), 총 rx/tx, 최대 util, 최대 손실.
  const kpi = useMemo(() => {
    const pts = sorted.map(lastPoint).filter((p): p is NetworkPoint => !!p);
    if (pts.length === 0) return null;
    const worstP95 = Math.max(...pts.map((p) => p.latency_p95_ms));
    const totalRx = pts.reduce((s, p) => s + p.rx_mbps, 0);
    const totalTx = pts.reduce((s, p) => s + p.tx_mbps, 0);
    const maxUtil = Math.max(...sorted.map((l) => { const p = lastPoint(l); return p ? utilOf(p, l.capacity_mbps) : 0; }));
    const maxLoss = Math.max(...pts.map((p) => p.loss_perc));
    return { worstP95, totalRx, totalTx, maxUtil, maxLoss };
  }, [sorted]);

  const selected = selectedId ? links?.find((l) => l.id === selectedId) ?? null : null;

  return (
    <>
      <div className="page-head">
        <h1>네트워크</h1>
        <span className="crumb">인프라 / 네트워크 (대역폭·지연·손실·에러)</span>
        <div className="spacer" />
        <DataFreshness updatedAt={lastLoaded} intervalMs={REFRESH_MS} />
        <select
          className="range-select"
          value={range}
          onChange={(e) => setRange(e.target.value as TimeRange)}
          aria-label="시간 범위"
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>범위: {r.label}</option>
          ))}
        </select>
        <button type="button" className="refresh-btn" onClick={() => load(range)} aria-label="네트워크 새로고침">
          <span className="spin" aria-hidden="true">⟳</span>
          새로고침
        </button>
      </div>

      {/* network=인프라 층 배너 + mock 배지(데이터 출처 투명성). */}
      <div className="node-mock-badge" role="note">
        <span className="tag tag-amber">mock 데이터</span>
        <span className="node-mock-text">
          이 화면은 <b>인프라 층</b> 네트워크(링크 대역폭·지연·손실·인터페이스 에러) 뷰입니다.
          앱층 프록시 지연은 <b>트래픽</b> 화면과 상관해 보세요(온콜 triage = 상관). 실 수집은{" "}
          node_exporter <code>netdev</code> + blackbox(IMP-52 spike,{" "}
          <code>evolve/plans/IMP-52-nodeexporter-spike.md</code>) 연동 시.
        </span>
      </div>

      {error && (
        <div className="state error" role="alert">
          네트워크 지표를 불러오지 못했습니다. ({error})
        </div>
      )}
      {!error && loading && !links && <SkeletonCards count={4} />}

      {links && !isEmpty && (
        <>
          {kpi && (
            <div className="net-kpis">
              {/* 'avg latency' KPI = p95(단일 avg 아님, 꼬리 지연 우선). */}
              <StatMini
                label="지연 (worst p95)"
                value={ms(kpi.worstP95)}
                tone={STATUS_TONE[statusFromThresholds(kpi.worstP95, LAT_WARN, LAT_CRIT)]}
                sub="p50/p95/p99 중 p95"
              />
              <StatMini label="총 수신 (RX)" value={bw(kpi.totalRx)} />
              <StatMini label="총 송신 (TX)" value={bw(kpi.totalTx)} />
              <StatMini
                label="최대 이용률"
                value={pct(kpi.maxUtil)}
                tone={STATUS_TONE[statusFromThresholds(kpi.maxUtil, UTIL_WARN, UTIL_CRIT)]}
              />
              <StatMini
                label="최대 손실률"
                value={pct(kpi.maxLoss)}
                tone={STATUS_TONE[statusFromThresholds(kpi.maxLoss, LOSS_WARN, LOSS_CRIT)]}
              />
            </div>
          )}

          <div className="net-toolbar">
            <p className="node-fleet-summary" aria-live="polite">
              링크 <b>{sorted.length}</b>개 —{" "}
              임계 초과 <b className={riskCount > 0 ? "node-risk" : ""}>{riskCount}</b>개
              {riskCount > 0 && <> (에러·재전송 급증 상단 정렬)</>}
            </p>
            <span className="spacer" />
            <label className="net-link-filter">
              <span className="sr-only">링크 필터</span>
              <select
                className="range-select"
                value={linkFilter}
                onChange={(e) => setLinkFilter(e.target.value)}
                aria-label="링크(인터페이스) 필터"
              >
                <option value="all">모든 링크</option>
                {(links ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.from} → {l.to}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="node-fleet">
            {sorted.map((l) => (
              <LinkCard key={l.id} link={l} status={linkStatus(l)} onOpen={() => setSelectedId(l.id)} />
            ))}
          </div>
        </>
      )}

      {isEmpty && (
        <div className="card"><div className="empty">관측된 네트워크 링크가 없습니다.</div></div>
      )}

      <SlidePanel
        open={!!selected}
        title={selected ? `링크 상세 — ${selected.from} → ${selected.to}` : ""}
        subtitle={selected ? `${STATUS_LABEL[linkStatus(selected)]} · 대역폭·지연·손실·에러` : ""}
        onClose={() => setSelectedId(null)}
        width={560}
      >
        {selected && (
          <LinkDetail
            link={selected}
            status={linkStatus(selected)}
            onPivotTraffic={() => { setSelectedId(null); onNavigate("traffic"); }}
          />
        )}
      </SlidePanel>
    </>
  );
}

// 링크 카드 — 상태 태그(색+텍스트) + 핵심 StatMini(이용률·p95·손실·에러). 클릭 → 상세.
function LinkCard({ link, status, onOpen }: { link: NetworkLink; status: NodeStatus; onOpen: () => void }) {
  const p = lastPoint(link);
  const util = p ? utilOf(p, link.capacity_mbps) : 0;
  const utilSt = statusFromThresholds(util, UTIL_WARN, UTIL_CRIT);
  const p95St = p ? statusFromThresholds(p.latency_p95_ms, LAT_WARN, LAT_CRIT) : "ok";
  const lossSt = p ? statusFromThresholds(p.loss_perc, LOSS_WARN, LOSS_CRIT) : "ok";
  const errSt = p ? statusFromThresholds(p.errs_per_s, ERR_WARN, ERR_CRIT) : "ok";
  return (
    <button
      type="button"
      className={`card node-card clickable node-card-${status}`}
      onClick={onOpen}
      aria-label={`${link.from} → ${link.to} 링크 상세 — 상태 ${STATUS_LABEL[status]}`}
    >
      <div className="card-head">
        <h3>{link.from} → {link.to}</h3>
        <span className={`tag tag-${STATUS_TAG[status]}`}>{STATUS_LABEL[status]}</span>
        <span className="spacer" />
        <span className="node-card-hint" aria-hidden="true">상세 ›</span>
      </div>
      <div className="node-card-metrics">
        <StatMini label="이용률" value={p ? pct(util) : "—"} tone={STATUS_TONE[utilSt]} spark={series(link, (x) => utilOf(x, link.capacity_mbps))} />
        <StatMini label="지연 p95" value={p ? ms(p.latency_p95_ms) : "—"} tone={STATUS_TONE[p95St]} spark={series(link, (x) => x.latency_p95_ms)} />
        <StatMini label="손실" value={p ? pct(p.loss_perc) : "—"} tone={STATUS_TONE[lossSt]} spark={series(link, (x) => x.loss_perc)} />
        <StatMini label="에러/s" value={p ? p.errs_per_s.toFixed(1) : "—"} tone={STATUS_TONE[errSt]} spark={series(link, (x) => x.errs_per_s)} />
      </div>
    </button>
  );
}

interface DetailSignal {
  label: string;
  sel: (p: NetworkPoint) => number;
  warn: number;
  crit: number;
  fmt: (v: number) => string;
}

// per-link 상세 — 대역폭·지연(p50/p95/p99)·손실·재전송·에러 전체 신호(스파크라인+임계 색·텍스트).
function LinkDetail({ link, status, onPivotTraffic }: { link: NetworkLink; status: NodeStatus; onPivotTraffic: () => void }) {
  const p = lastPoint(link);
  if (!p) {
    return <p className="rank-empty">이 링크의 시계열 데이터가 아직 충분하지 않습니다.</p>;
  }
  const cap = link.capacity_mbps;
  const bandwidth: DetailSignal[] = [
    { label: "수신 RX", sel: (x) => x.rx_mbps, warn: cap * UTIL_WARN, crit: cap * UTIL_CRIT, fmt: bw },
    { label: "송신 TX", sel: (x) => x.tx_mbps, warn: cap * UTIL_WARN, crit: cap * UTIL_CRIT, fmt: bw },
    { label: "이용률", sel: (x) => utilOf(x, cap), warn: UTIL_WARN, crit: UTIL_CRIT, fmt: pct },
  ];
  const latency: DetailSignal[] = [
    { label: "지연 p50", sel: (x) => x.latency_p50_ms, warn: LAT_WARN, crit: LAT_CRIT, fmt: ms },
    { label: "지연 p95", sel: (x) => x.latency_p95_ms, warn: LAT_WARN, crit: LAT_CRIT, fmt: ms },
    { label: "지연 p99", sel: (x) => x.latency_p99_ms, warn: LAT_WARN, crit: LAT_CRIT, fmt: ms },
  ];
  const errors: DetailSignal[] = [
    { label: "패킷 손실", sel: (x) => x.loss_perc, warn: LOSS_WARN, crit: LOSS_CRIT, fmt: pct },
    { label: "재전송", sel: retxOf, warn: RETX_WARN, crit: RETX_CRIT, fmt: pct },
    { label: "에러/s", sel: (x) => x.errs_per_s, warn: ERR_WARN, crit: ERR_CRIT, fmt: (v) => `${v.toFixed(1)}/s` },
  ];
  const groups: { title: string; sigs: DetailSignal[] }[] = [
    { title: "대역폭 (Bandwidth)", sigs: bandwidth },
    { title: "지연 (Latency p50/p95/p99)", sigs: latency },
    { title: "에러 · 손실 · 재전송", sigs: errors },
  ];
  return (
    <>
      <DetailRow label="상태">
        <span className={`tag tag-${STATUS_TAG[status]}`}>{STATUS_LABEL[status]}</span>
      </DetailRow>
      <DetailRow label="용량">{bw(cap)}</DetailRow>
      <DetailRow label="링크 ID"><code>{link.id}</code></DetailRow>
      {groups.map((g) => (
        <div key={g.title} className="node-dd-group">
          <h4 className="node-dd-gtitle">{g.title}</h4>
          {g.sigs.map((s) => {
            const v = s.sel(p);
            const st = statusFromThresholds(v, s.warn, s.crit);
            const color = cellColor(st);
            return (
              <div className="node-dd-row" key={s.label}>
                <span className="node-dd-label">{s.label}</span>
                <Sparkline values={series(link, s.sel)} color={sparkColor(st)} width={240} height={30} />
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
      {/* cross-layer pivot — 인프라 층 → 앱층(Traffic) 상관 뷰(triage = 상관). */}
      <div className="net-pivot">
        <button type="button" className="btn-primary" onClick={onPivotTraffic}>
          앱층 트래픽(프록시)으로 상관 보기 →
        </button>
        <p className="node-dd-hint">
          <InfoTip>네트워크(인프라 층)의 지연·손실이 앱층 요청 지연으로 이어졌는지 트래픽 화면에서 상관 확인합니다.</InfoTip>
          {" "}이 링크가 hot 이면 앱층 영향 여부를 함께 보세요.
        </p>
      </div>
    </>
  );
}
