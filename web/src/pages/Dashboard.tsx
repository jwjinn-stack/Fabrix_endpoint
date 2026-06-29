import { useCallback, useEffect, useState } from "react";
import { fetchOverview, fetchTimeseries } from "../api/client";
import type { DashboardOverview, Timeseries } from "../api/types";
import type { NavFn } from "../router";
import StatCard from "../components/StatCard";
import BarList from "../components/BarList";
import type { BarItem } from "../components/BarList";
import TimeseriesChart from "../components/TimeseriesChart";
import Alarms from "../components/Alarms";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import { SkeletonCards } from "../components/Skeleton";
import { RANGES, RangeSelect, useTimeRange } from "../timeRange";

const REFRESH_MS = 15_000;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

// ── 골든 시그널 "지금 정상?" 요약 ──
// 관제 1순위 질문에 한눈에 답한다: 트래픽·에러·지연·포화 4신호 + 종합 상태등(green/amber/red).
type SigTone = "green" | "amber" | "red";
const TONE_RANK: Record<SigTone, number> = { green: 0, amber: 1, red: 2 };
const STATUS_LABEL: Record<SigTone, string> = { green: "정상", amber: "주의", red: "위험" };
// 임계: 값이 warn 이상이면 주의, crit 이상이면 위험(높을수록 나쁜 지표 기준).
function sigTone(v: number, warn: number, crit: number): SigTone {
  return v >= crit ? "red" : v >= warn ? "amber" : "green";
}

function HealthBanner({ overview }: { overview: DashboardOverview }) {
  const errRate = (1 - overview.traffic.success_rate) * 100; // %
  const signals: { k: string; v: string; tone: SigTone }[] = [
    { k: "트래픽", v: `${overview.traffic.qps.toFixed(1)} QPS`, tone: "green" },
    { k: "에러율", v: `${errRate.toFixed(2)}%`, tone: sigTone(errRate, 1, 5) },
    { k: "지연 p95", v: `${overview.quality.ttft_p95_ms}ms`, tone: sigTone(overview.quality.ttft_p95_ms, 140, 250) },
    { k: "GPU 포화", v: pct(overview.gpu.usage_perc), tone: sigTone(overview.gpu.usage_perc * 100, 85, 95) },
  ];
  const overall = signals.reduce<SigTone>((w, s) => (TONE_RANK[s.tone] > TONE_RANK[w] ? s.tone : w), "green");
  return (
    <div className={`health-banner ${overall}`} role="status" aria-live="polite">
      <span className={`health-status ${overall}`}>
        <span className="health-dot" aria-hidden="true" />
        {STATUS_LABEL[overall]}
      </span>
      <span className="health-title">지금 시스템 상태</span>
      <div className="health-signals">
        {signals.map((s) => (
          <span key={s.k} className={`health-sig ${s.tone}`}>
            <span className="health-sig-dot" aria-hidden="true" />
            <span className="health-sig-k">{s.k}</span>
            <b>{s.v}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
// 전기간 대비 변화율(%): 시계열을 전반/후반으로 나눠 평균 비교. 데이터 부족하면 미표시.
function deltaPct(vals: number[]): number | undefined {
  if (vals.length < 4) return undefined;
  const h = Math.floor(vals.length / 2);
  const prev = mean(vals.slice(0, h));
  const cur = mean(vals.slice(h));
  if (prev === 0) return cur === 0 ? 0 : undefined;
  return ((cur - prev) / prev) * 100;
}

export default function Dashboard({ onNavigate }: { onNavigate?: NavFn }) {
  // 기간은 전역 컨텍스트 공유 — 사용량·트레이스 화면과 동일 선택이 유지된다(G-05).
  const { range } = useTimeRange();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [series, setSeries] = useState<Timeseries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // 관제뷰 빌더(#16) — 패널 표시 토글, localStorage 저장.
  const [editView, setEditView] = useState(false);
  // D-03 인지부하: 기본은 핵심 3카드만(글랜스). GPU/MIG는 "더 보기"로 펼침(카드 영역 한정).
  const [showMore, setShowMore] = useState(false);
  const [panels, setPanels] = useState<Record<string, boolean>>(() => {
    try {
      const s = localStorage.getItem("fabrix.dashboard.panels");
      if (s) return JSON.parse(s) as Record<string, boolean>;
    } catch { /* ignore */ }
    return { cards: true, distribution: true, timeseries: true, alarms: true };
  });
  const togglePanel = (k: string) => {
    setPanels((p) => {
      const next = { ...p, [k]: !p[k] };
      try { localStorage.setItem("fabrix.dashboard.panels", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setRefreshing(true);
      try {
        const [o, s] = await Promise.all([fetchOverview(range, signal), fetchTimeseries(range, signal)]);
        setOverview(o);
        setSeries(s);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [range],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    const id = setInterval(() => load(), REFRESH_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [load]);

  // 분포 BarList 행 클릭 → 우측 슬라이드 상세.
  const [distDetail, setDistDetail] = useState<{ kind: "dept" | "app"; item: BarItem } | null>(null);

  const updatedAt = overview
    ? new Date(overview.generated_at).toLocaleTimeString("ko-KR", { hour12: false })
    : "—";

  // KPI 카드 스파크라인/변화율 — 이미 받아온 시계열에서 산출(추가 호출 없음).
  const sparkQps = series?.points.map((p) => p.qps) ?? [];
  const sparkTtft = series?.points.map((p) => p.ttft_p95_ms) ?? [];
  const sparkBlocked = series?.points.map((p) => p.blocked) ?? [];

  return (
    <>
      <div className="page-head">
        <h1>관제 대시보드</h1>
        <span className="crumb">관제 / 대시보드</span>
        <div className="spacer" />
        <span className="updated">업데이트 {updatedAt}</span>
        <RangeSelect />
        <button type="button" className="btn-ghost" onClick={() => setEditView((v) => !v)} aria-pressed={editView}>
          {editView ? "편집 완료" : "뷰 편집"}
        </button>
        <button
          type="button"
          className={`refresh-btn ${refreshing ? "is-loading" : ""}`}
          onClick={() => load()}
          disabled={refreshing}
          aria-label="대시보드 전체 새로고침"
        >
          <span className="spin" aria-hidden="true">
            ⟳
          </span>
          전체 새로고침
        </button>
      </div>

      {editView && (
        <div className="card view-builder">
          <span className="vb-label">표시할 패널:</span>
          {([
            ["cards", "지표 카드"],
            ["distribution", "부서/앱 분포"],
            ["timeseries", "시계열"],
            ["alarms", "알람"],
          ] as const).map(([k, label]) => (
            <label key={k} className={`vb-chip ${panels[k] ? "on" : ""}`}>
              <input type="checkbox" checked={!!panels[k]} onChange={() => togglePanel(k)} />
              {label}
            </label>
          ))}
          <span className="vb-hint">설정은 이 브라우저에 저장됩니다.</span>
        </div>
      )}

      {error && (
        <div className="state error" role="alert">
          지표를 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다. ({error})
        </div>
      )}

      {!error && loading && !overview && <SkeletonCards count={4} />}

      {overview && series && (
        <>
          <HealthBanner overview={overview} />
          {panels.cards && (
          <>
          {/* D-01/D-03: 동일 높이 KPI 타일 그리드(auto-fit) — 폭에 따라 3~4열로 자연 줄바꿈,
              카드 높이가 어긋나지 않는다. GPU/MIG 는 기본 숨김, "더 보기"로 4번째 타일 추가. */}
          <div className="kpi-grid">
            <StatCard
              title="실시간 트래픽"
              info="vLLM 엔진 실행/대기 요청 수와 성공률"
              link="트래픽 상세 →"
              onLink={() => onNavigate?.("traffic")}
              onRefresh={() => load()}
              metrics={[
                { label: "QPS", value: overview.traffic.qps.toFixed(1), spark: sparkQps, delta: deltaPct(sparkQps), deltaGood: "up" },
                { label: "실행중", value: overview.traffic.running },
                { label: "대기", value: overview.traffic.waiting, tone: overview.traffic.waiting > 5 ? "amber" : undefined },
                {
                  label: "성공률",
                  value: pct1(overview.traffic.success_rate),
                  tone: overview.traffic.success_rate < 0.99 ? "amber" : "green",
                  bar: overview.traffic.success_rate,
                  barColor: overview.traffic.success_rate < 0.99 ? "var(--amber)" : "var(--green)",
                },
              ]}
            />
            <StatCard
              title="응답 품질"
              info="TTFT/ITL 분포와 KV prefix 캐시 적중률"
              link="차원 분해 →"
              onLink={() => onNavigate?.("usage")}
              onRefresh={() => load()}
              metrics={[
                { label: "TTFT p95", value: overview.quality.ttft_p95_ms, unit: "ms", tone: overview.quality.ttft_p95_ms > 140 ? "amber" : undefined, spark: sparkTtft, delta: deltaPct(sparkTtft), deltaGood: "down" },
                { label: "ITL avg", value: overview.quality.itl_avg_ms, unit: "ms" },
                { label: "캐시 hit", value: pct(overview.quality.cache_hit_rate), bar: overview.quality.cache_hit_rate, barColor: "var(--teal)" },
              ]}
            />
            <StatCard
              title="가드레일"
              info="가드레일 차단/PII/Jailbreak/flagged 건수 (증적 기반)"
              link="증적보기 →"
              onLink={() => onNavigate?.("guard")}
              onRefresh={() => load()}
              metrics={[
                { label: "차단", value: overview.guardrail.blocked, tone: overview.guardrail.blocked > 0 ? "red" : undefined, spark: sparkBlocked, delta: deltaPct(sparkBlocked), deltaGood: "down" },
                { label: "PII", value: overview.guardrail.pii, tone: "pink" },
                { label: "flagged", value: overview.guardrail.flagged, tone: "amber" },
              ]}
            />
            {/* D-03: GPU/MIG는 기본 숨김 — "더 보기"로 펼친다. */}
            {showMore && (
              <StatCard
                title="GPU / MIG"
                info="GPU 사용률·KV 캐시·MIG 슬라이스 효율"
                link="GPU 상세 →"
                onLink={() => onNavigate?.("gpu")}
                onRefresh={() => load()}
                metrics={[
                  { label: "사용률", value: pct(overview.gpu.usage_perc), bar: overview.gpu.usage_perc },
                  { label: "KV 캐시", value: pct(overview.gpu.kv_cache_perc), bar: overview.gpu.kv_cache_perc, barColor: "var(--teal)" },
                  {
                    label: "MIG 효율",
                    value: overview.gpu.mig_efficiency.toFixed(2),
                    tone: overview.gpu.mig_efficiency < 0.7 ? "amber" : "green",
                    bar: overview.gpu.mig_efficiency,
                    barColor: overview.gpu.mig_efficiency < 0.7 ? "var(--amber)" : "var(--green)",
                  },
                ]}
              />
            )}
          </div>
          <div style={{ marginTop: "calc(-1 * var(--sp-2))", marginBottom: "var(--sp-3)" }}>
            <button type="button" className="btn-ghost" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
              {showMore ? "GPU / MIG 접기 ▲" : "GPU / MIG 더 보기 ▼"}
            </button>
          </div>
          </>
          )}

          {panels.distribution && (
          <div className="grid-2">
            <BarList
              title="부서별 사용량 (Top 6)"
              onRefresh={() => load()}
              maxItems={6}
              onItemClick={(it) => setDistDetail({ kind: "dept", item: it })}
              items={overview.dept_usage.map((d) => ({ key: d.dept_id, name: d.name, percent: d.percent }))}
            />
            <BarList
              title="앱별 요청 분포 (Top 6)"
              color="var(--teal)"
              onRefresh={() => load()}
              maxItems={6}
              onItemClick={(it) => setDistDetail({ kind: "app", item: it })}
              items={overview.app_usage.map((a) => ({ key: a.app_id, name: a.app_id, percent: a.percent }))}
            />
          </div>
          )}

          {panels.timeseries && <TimeseriesChart points={series.points} />}

          {panels.alarms && <Alarms alarms={overview.alarms} />}
        </>
      )}

      <SlidePanel
        open={!!distDetail}
        title={distDetail?.kind === "dept" ? `부서 · ${distDetail?.item.name}` : `앱 · ${distDetail?.item.name}`}
        subtitle={distDetail?.kind === "dept" ? "부서별 사용량 상세" : "앱별 요청 분포 상세"}
        onClose={() => setDistDetail(null)}
        footer={
          <button type="button" className="btn-primary" onClick={() => { onNavigate?.("usage"); setDistDetail(null); }}>
            사용량 리포트에서 보기 →
          </button>
        }
      >
        {distDetail && (
          <>
            <DetailRow label={distDetail.kind === "dept" ? "부서" : "앱 ID"}>{distDetail.item.name}</DetailRow>
            <DetailRow label="구간 점유율">{Math.round(distDetail.item.percent * 100)}%</DetailRow>
            <DetailRow label="집계 기간">{RANGES.find((r) => r.value === range)?.label}</DetailRow>
            <p className="slide-note">
              이 {distDetail.kind === "dept" ? "부서" : "앱"}의 모델·키별 토큰/요청 상세는 사용량 리포트에서 해당 축으로 그룹핑하여 확인할 수 있습니다.
            </p>
          </>
        )}
      </SlidePanel>
    </>
  );
}
