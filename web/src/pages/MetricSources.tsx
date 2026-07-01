import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMetricSourceCoverage } from "../api/client";
import type {
  MetricSourceCoverage, MetricSourceCard, MetricSourceStatus, SignalCoverageCell, ObjectType,
} from "../api/types";
import type { NavFn } from "../router";
import Badge, { type BadgeTone } from "../components/Badge";
import { SkeletonRows } from "../components/Skeleton";
import InfoTip from "../components/InfoTip";
import { humanizeError } from "../utils/errors";

// IMP-74 — 메트릭 소스 / 익스포터 커버리지 매트릭스.
// Diagnostics(연동 상태)는 외부 의존성 능동 프로브(도달성)이고, 이 화면은 Grafana Entity-catalog /
// OTel-coverage 방식의 '신호→온톨로지 객체 커버리지 매트릭스'다. "연결 카드 나열"이 아니라
// (1) 익스포터 축(제공 계열·대상 객체 타입·3단 상태) + (2) 신호×객체 GAP 셀(클릭→드릴다운/추천) + (4) protocol(OTel).
// 실 상태/수집은 IMP-79 spike — mock-first(결정적), 깨끗한 스왑을 위해 up/scrape/age 필드를 그대로 노출.

// 3단 상태 → 배지 톤·라벨(색-only 금지: 텍스트 병기).
const STATUS_BADGE: Record<MetricSourceStatus, { tone: BadgeTone; label: string }> = {
  HEALTHY: { tone: "green", label: "정상 (신선)" },
  CONFIGURED_NO_DATA: { tone: "amber", label: "구성됨·데이터 없음" },
  NOT_CONFIGURED: { tone: "neutral", label: "미구성" },
};

// 대상 객체 타입 → 한국어 라벨(온톨로지 ObjectType 정합).
const OBJ_LABEL: Record<ObjectType, string> = {
  Model: "Model", Endpoint: "Endpoint", Service: "Service",
  GpuDevice: "GpuDevice", Node: "Node", Trace: "Trace", Incident: "Incident", Task: "Task",
};

// GAP 셀 드릴다운 라벨 — 어디로 이동하는지 사람이 읽게.
const DRILL_LABEL: Record<NonNullable<SignalCoverageCell["drilldown"]>, string> = {
  gpu: "GPU 드릴다운", nodes: "노드 메트릭", investigate: "근본원인 추적",
};

function StatusBadge({ status }: { status: MetricSourceStatus }) {
  const m = STATUS_BADGE[status];
  return <Badge tone={m.tone} dot>{m.label}</Badge>;
}

// 소스(익스포터) 카드 — 제공 계열 + 대상 객체 타입 + 상태 + protocol + 인라인 갭 배지(DCGM per-process 등).
function SourceCard({ c }: { c: MetricSourceCard }) {
  return (
    <div className={`ms-source-card ms-${c.status.toLowerCase()}`}>
      <div className="ms-source-head">
        <span className="ms-source-name">{c.label}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="ms-proto" title="signal provider 프로토콜(OTel Collector 리시버로 흡수 가능)">{c.protocol}</span>
        <StatusBadge status={c.status} />
      </div>
      <div className="ms-source-role">{c.role}</div>

      {/* 대상 온톨로지 객체 타입(무엇을 관측하는가) */}
      <div className="ms-source-targets">
        <span className="ms-label">대상 객체</span>
        {c.targetTypes.map((t) => (
          <span key={t} className="pill">{OBJ_LABEL[t]}</span>
        ))}
        {c.targetNote && <span className="muted ms-target-note">· {c.targetNote}</span>}
      </div>

      {/* 제공 메트릭 계열 */}
      <div className="ms-source-families">
        <span className="ms-label">메트릭 계열</span>
        <div className="ms-family-list">
          {c.families.map((f) => (
            <code key={f} className="ms-family">{f}</code>
          ))}
        </div>
      </div>

      {/* scrape 근거(실 스왑 대상) — up 단독 금지 판정을 투명하게. */}
      <div className="ms-scrape" title="실 상태 판정 근거(IMP-79 스왑 대상) — up 단독 금지: up + 샘플수 + 신선도">
        <code>up={c.scrape.up}</code>
        <code>samples={c.scrape.scrape_samples_scraped}</code>
        <code>age={c.scrape.last_scrape_age_sec}s</code>
      </div>

      {/* 인라인 갭/경고 배지 — NVML per-process 미지원(이슈 #521)은 여기(DCGM 카드 안)로만. 독립 카드 금지. */}
      {c.notes.map((n) => (
        <div key={n.label} className={`ms-note ms-note-${n.tone}`} role="note">
          <span className="ms-note-badge">{n.tone === "warn" ? "⚠ " : "ⓘ "}{n.label}{n.issue ? ` (이슈 ${n.issue})` : ""}</span>
          <span className="ms-note-detail">{n.detail}</span>
        </div>
      ))}
    </div>
  );
}

// 커버리지 GAP 셀 — '신호 × 객체'. 클릭 → 드릴다운/추천 익스포터로(스파이크·근거 grounding).
function GapCell({ cell, sourceLabel, onNavigate, onFocusSource }: {
  cell: SignalCoverageCell;
  sourceLabel: string | undefined;
  onNavigate: NavFn;
  onFocusSource: (id: string) => void;
}) {
  // 드릴다운이 있으면 화면 이동(host 컨텍스트 운반), 없으면 추천 익스포터 카드로 포커스 스크롤.
  const go = () => {
    if (cell.drilldown === "nodes") onNavigate("nodes", { host: "gpu-node-01" });
    else if (cell.drilldown === "gpu") onNavigate("gpu");
    else if (cell.drilldown === "investigate") onNavigate("investigate");
    else if (cell.recommended) onFocusSource(cell.recommended);
  };
  const target = cell.drilldown ? DRILL_LABEL[cell.drilldown] : (sourceLabel ?? cell.recommended);
  return (
    <button type="button" className="ms-gap-cell" onClick={go}
      aria-label={`갭: ${OBJ_LABEL[cell.objectType]} × ${cell.signal} — ${target ?? "추천 익스포터"}로 이동`}>
      <div className="ms-gap-head">
        <span className="ms-gap-obj">{cell.objectLabel ?? OBJ_LABEL[cell.objectType]}</span>
        <span className="ms-gap-x" aria-hidden="true">×</span>
        <span className="ms-gap-signal">{cell.signal}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <Badge tone="red">GAP</Badge>
      </div>
      <div className="ms-gap-reason">{cell.reason}</div>
      <div className="ms-gap-foot">
        {cell.recommended && <span className="ms-gap-rec">추천: <code>{cell.recommended}</code></span>}
        {cell.issue && <span className="ms-gap-issue">이슈 {cell.issue}</span>}
        <span className="ms-gap-link">{target} →</span>
      </div>
    </button>
  );
}

// 커버된(covered) 셀 — 매트릭스 대비군(무엇이 되는가). 간결한 확인 행.
function CoveredRow({ cell, sourceLabel }: { cell: SignalCoverageCell; sourceLabel: string | undefined }) {
  return (
    <div className="ms-covered-row">
      <span className="ms-cov-obj">{cell.objectLabel ?? OBJ_LABEL[cell.objectType]}</span>
      <span className="ms-gap-x" aria-hidden="true">×</span>
      <span className="ms-cov-signal">{cell.signal}</span>
      <span className="spacer" style={{ flex: 1 }} />
      <Badge tone="green" dot>커버</Badge>
      <span className="muted ms-cov-src">{sourceLabel ?? cell.sourceId}</span>
    </div>
  );
}

export default function MetricSources({ onNavigate }: { onNavigate: NavFn }) {
  const [data, setData] = useState<MetricSourceCoverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // GAP 셀에서 추천 익스포터로 포커스 이동 시 하이라이트할 소스 id.
  const [focusSource, setFocusSource] = useState<string | null>(null);
  const sourceRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    fetchMetricSourceCoverage(signal)
      .then((r) => { setData(r); setLoading(false); })
      .catch((e) => {
        if (signal?.aborted) return;
        setError(humanizeError((e as Error).message));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // 추천 익스포터 카드로 스크롤 + 하이라이트(GAP 해소 경로 시각 연결).
  const onFocusSource = useCallback((id: string) => {
    setFocusSource(id);
    const el = sourceRefs.current[id];
    if (el && "scrollIntoView" in el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const labelOf = useCallback((id?: string) => data?.sources.find((s) => s.id === id)?.label, [data]);

  const gaps = (data?.coverage ?? []).filter((c) => !c.covered);
  const covered = (data?.coverage ?? []).filter((c) => c.covered);
  const counts = {
    healthy: (data?.sources ?? []).filter((s) => s.status === "HEALTHY").length,
    noData: (data?.sources ?? []).filter((s) => s.status === "CONFIGURED_NO_DATA").length,
    notCfg: (data?.sources ?? []).filter((s) => s.status === "NOT_CONFIGURED").length,
  };
  const isEmpty = !!data && data.sources.length === 0;

  return (
    <>
      <div className="page-head">
        <h1>메트릭 소스</h1>
        <span className="crumb">연동 / 익스포터 커버리지 매트릭스</span>
        <div className="spacer" />
        {data && (
          <span className="updated">
            정상 {counts.healthy} · 무데이터 {counts.noData} · 미구성 {counts.notCfg}
          </span>
        )}
        <button type="button" className="btn-ghost" onClick={() => load()} disabled={loading}>
          {loading ? "불러오는 중…" : "새로고침"}
        </button>
      </div>

      <p className="muted" style={{ marginTop: -4, fontSize: "var(--fs-body)" }}>
        어떤 신호를 어떤 익스포터가 주고, 무엇이 아직 <b>갭(GAP)</b>인지 보여줍니다. 이 화면은 외부 의존성 도달성 프로브(<b>연동 상태</b>)가
        아니라 <b>메트릭 계열 커버리지</b> 인벤토리입니다. 상태는 <code>up{"{job}"}</code> 단독이 아니라 <code>up</code>+
        <code>scrape_samples_scraped</code>+last-scrape age 로 판정(“타깃 살아있는데 계열 빔”까지 탐지). 실 수집은 IMP-79 spike — 지금은 mock.
      </p>

      {error && <div className="state error" role="alert">메트릭 소스 커버리지를 불러오지 못했습니다 — {error}</div>}

      {loading && !data ? (
        <div className="card"><SkeletonRows rows={6} cols={3} /></div>
      ) : isEmpty ? (
        <div className="card"><div className="empty">등록된 메트릭 소스가 없습니다.</div></div>
      ) : data ? (
        <>
          {/* (1) 소스 축 — 익스포터 카드 그리드. */}
          <div className="card">
            <div className="card-head">
              <h3>익스포터 소스</h3>
              <InfoTip>각 카드 = 제공 메트릭 계열 + 대상 온톨로지 객체 타입 + 3단 상태 + protocol(prometheus/otlp). NVML 은 독립 카드가 아니라 DCGM 하위 라이브러리 — per-process 미지원은 DCGM 카드 안 배지로 표기합니다.</InfoTip>
            </div>
            <div className="ms-source-grid">
              {data.sources.map((c) => (
                <div
                  key={c.id}
                  ref={(el) => { sourceRefs.current[c.id] = el; }}
                  className={focusSource === c.id ? "ms-source-focus" : undefined}
                >
                  <SourceCard c={c} />
                </div>
              ))}
            </div>
          </div>

          {/* (2) 커버리지 갭 — 신호×객체 GAP 셀(1급). 클릭 → 드릴다운/추천 익스포터. */}
          <div className="card">
            <div className="card-head">
              <h3>커버리지 갭 (신호 × 객체)</h3>
              <InfoTip>아직 안 잡히는 신호를 '신호 × 온톨로지 객체' 셀로 노출합니다. 셀을 클릭하면 드릴다운(GPU/노드/근본원인 추적) 또는 GAP 을 닫을 추천 익스포터로 이동합니다.</InfoTip>
            </div>
            {gaps.length === 0 ? (
              <div className="empty">알려진 커버리지 갭이 없습니다.</div>
            ) : (
              <div className="ms-gap-grid">
                {gaps.map((cell) => (
                  <GapCell
                    key={`${cell.objectType}:${cell.signal}`}
                    cell={cell}
                    sourceLabel={labelOf(cell.recommended)}
                    onNavigate={onNavigate}
                    onFocusSource={onFocusSource}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 커버된 신호(매트릭스 대비군) — 무엇이 되는가. */}
          {covered.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h3>커버되는 신호</h3>
                <InfoTip>정상 커버되는 대표 신호 — 갭 대비 '무엇이 되는지'를 함께 보여 매트릭스를 완성합니다.</InfoTip>
              </div>
              <div className="ms-covered-list">
                {covered.map((cell) => (
                  <CoveredRow key={`${cell.objectType}:${cell.signal}`} cell={cell} sourceLabel={labelOf(cell.sourceId)} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
