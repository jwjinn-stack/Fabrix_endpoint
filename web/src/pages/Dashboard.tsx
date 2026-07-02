import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import DataFreshness from "../components/DataFreshness";
import KineticStrip from "../components/KineticStrip";
import { RANGES, RangeSelect, useTimeRange } from "../timeRange";
import { humanizeError } from "../utils/errors";
import {
  isVisible,
  loadLayout,
  moveWidget,
  saveLayout,
  toggleWidget,
  type DashboardLayout,
  type Persona,
  type WidgetId,
} from "../dashboardLayout";

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

// ── IMP-40 위젯 descriptor ──
// 고정 배열 대신 typed 카탈로그로 — id 참조 레이아웃이 순서/표시를 결정한다. render 는 데이터 컨텍스트를 받아
// 기존 위젯(StatCard·BarList·TimeseriesChart·Alarms)을 그대로 그린다(렌더/데이터 로직 보존, 배치만 분리).
interface WidgetDescriptor {
  id: WidgetId;
  title: string; // 편집모드 라벨
  persona: Persona; // 보조 태그(동작 무관)
  render: () => ReactNode;
}
const PERSONA_LABEL: Record<Persona, string> = { cost: "비용", sre: "SRE", security: "보안", ops: "운영" };

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
  const [lastLoaded, setLastLoaded] = useState<number | null>(null); // 성공 fetch 수신 시각(신선도)
  // IMP-40 커스텀 대시보드 v1 — 위젯 show/hide + reorder, 레이아웃을 localStorage 에 영속.
  const [editView, setEditView] = useState(false);
  const [layout, setLayout] = useState<DashboardLayout>(() => loadLayout());
  // 레이아웃 변경은 상태 + localStorage 동시 반영(savedViews 패턴).
  const applyLayout = useCallback((next: DashboardLayout) => {
    setLayout(saveLayout(next));
  }, []);
  const onToggle = useCallback((id: WidgetId) => applyLayout(toggleWidget(layout, id)), [applyLayout, layout]);
  const onMove = useCallback(
    (id: WidgetId, dir: "up" | "down") => applyLayout(moveWidget(layout, id, dir)),
    [applyLayout, layout],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setRefreshing(true);
      try {
        const [o, s] = await Promise.all([fetchOverview(range, signal), fetchTimeseries(range, signal)]);
        setOverview(o);
        setSeries(s);
        setLastLoaded(Date.now());
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
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

  // KPI 카드 스파크라인/변화율 — 이미 받아온 시계열에서 산출(추가 호출 없음).
  const sparkQps = series?.points.map((p) => p.qps) ?? [];
  const sparkTtft = series?.points.map((p) => p.ttft_p95_ms) ?? [];
  const sparkBlocked = series?.points.map((p) => p.blocked) ?? [];

  // 위젯 카탈로그 — 데이터가 있을 때만 구성(render 는 non-null 컨텍스트 위에서만 호출됨).
  const widgets: WidgetDescriptor[] =
    overview && series
      ? [
          {
            id: "traffic",
            title: "실시간 트래픽",
            persona: "sre",
            render: () => (
              <StatCard
                widgetId="dashboard.traffic"
                title="실시간 트래픽"
                info="vLLM 엔진 실행/대기 요청 수와 성공률"
                link="트래픽 상세 →"
                onLink={() => onNavigate?.("traffic")}
                onRefresh={() => load()}
                metrics={[
                  { label: "QPS", value: overview.traffic.qps.toFixed(1), spark: sparkQps, delta: deltaPct(sparkQps), deltaGood: "up", explainKey: "qps" },
                  { label: "실행중", value: overview.traffic.running },
                  { label: "대기", value: overview.traffic.waiting, tone: overview.traffic.waiting > 5 ? "amber" : undefined, explainKey: "queue-depth" },
                  {
                    label: "성공률",
                    value: pct1(overview.traffic.success_rate),
                    tone: overview.traffic.success_rate < 0.99 ? "amber" : "green",
                    bar: overview.traffic.success_rate,
                    barColor: overview.traffic.success_rate < 0.99 ? "var(--amber)" : "var(--green)",
                  },
                ]}
              />
            ),
          },
          {
            id: "quality",
            title: "응답 품질",
            persona: "sre",
            render: () => (
              <StatCard
                widgetId="dashboard.quality"
                title="응답 품질"
                info="TTFT/ITL 분포와 KV prefix 캐시 적중률"
                link="차원 분해 →"
                onLink={() => onNavigate?.("usage")}
                onRefresh={() => load()}
                metrics={[
                  { label: "TTFT p95", value: overview.quality.ttft_p95_ms, unit: "ms", tone: overview.quality.ttft_p95_ms > 140 ? "amber" : undefined, spark: sparkTtft, delta: deltaPct(sparkTtft), deltaGood: "down", explainKey: "ttft" },
                  { label: "ITL avg", value: overview.quality.itl_avg_ms, unit: "ms" },
                  { label: "캐시 hit", value: pct(overview.quality.cache_hit_rate), bar: overview.quality.cache_hit_rate, barColor: "var(--teal)" },
                ]}
              />
            ),
          },
          {
            id: "guardrail",
            title: "가드레일",
            persona: "security",
            render: () => (
              <StatCard
                widgetId="dashboard.guardrail"
                title="가드레일"
                info="가드레일 차단/PII/Jailbreak/flagged 건수 (증적 기반)"
                link="증적보기 →"
                onLink={() => onNavigate?.("guard")}
                onRefresh={() => load()}
                metrics={[
                  { label: "차단", value: overview.guardrail.blocked, tone: overview.guardrail.blocked > 0 ? "red" : undefined, spark: sparkBlocked, delta: deltaPct(sparkBlocked), deltaGood: "down", explainKey: "block-rate" },
                  { label: "PII", value: overview.guardrail.pii, tone: "pink" },
                  { label: "flagged", value: overview.guardrail.flagged, tone: "amber" },
                ]}
              />
            ),
          },
          {
            id: "gpu",
            title: "GPU / MIG",
            persona: "cost",
            render: () => (
              <StatCard
                widgetId="dashboard.gpu"
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
            ),
          },
          {
            id: "distribution",
            title: "부서/앱 분포",
            persona: "cost",
            render: () => (
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
            ),
          },
          {
            id: "timeseries",
            title: "시계열",
            persona: "sre",
            render: () => <TimeseriesChart points={series.points} />,
          },
          {
            id: "alarms",
            title: "알람",
            persona: "ops",
            render: () => <Alarms alarms={overview.alarms} />,
          },
        ]
      : [];

  // 레이아웃 순서대로 정렬한 descriptor(편집모드 목록·렌더 공용). order 는 항상 전체 위젯 순열.
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const ordered = layout.order.map((id) => byId.get(id)).filter((w): w is WidgetDescriptor => !!w);

  return (
    <>
      <div className="page-head">
        <h1>관제 대시보드</h1>
        <span className="crumb">관제 / 대시보드</span>
        <div className="spacer" />
        <DataFreshness updatedAt={lastLoaded} intervalMs={REFRESH_MS} />
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
        <div className="card view-builder" aria-label="대시보드 위젯 편집">
          <span className="vb-label">위젯 표시·순서:</span>
          <div className="vb-widgets">
            {ordered.map((w, i) => {
              const visible = isVisible(layout, w.id);
              return (
                <div key={w.id} className={`vb-row ${visible ? "on" : "off"}`} data-widget={w.id}>
                  <label className="vb-toggle">
                    <input type="checkbox" checked={visible} onChange={() => onToggle(w.id)} aria-label={`${w.title} 표시`} />
                    <span className="vb-row-title">{w.title}</span>
                  </label>
                  <span className="vb-persona">{PERSONA_LABEL[w.persona]}</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="vb-move"
                    onClick={() => onMove(w.id, "up")}
                    disabled={i === 0}
                    aria-label={`${w.title} 위로`}
                    title="위로"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="vb-move"
                    onClick={() => onMove(w.id, "down")}
                    disabled={i === ordered.length - 1}
                    aria-label={`${w.title} 아래로`}
                    title="아래로"
                  >
                    ▼
                  </button>
                </div>
              );
            })}
          </div>
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
          {/* IMP-72 — Kinetic 알림 스트립. 감지→객체 귀속을 4-슬롯 카드로 대시보드 최상단에.
              대시보드엔 ObjectView 드로어가 없어 객체 chip 은 COP(진입점 지정)로 이동시킨다. */}
          <KineticStrip
            onNavigate={onNavigate}
            onOpenObject={onNavigate ? (id) => onNavigate("investigate", { entity: id }) : undefined}
          />
          {/* IMP-40: 레이아웃 순서대로 위젯 렌더. 인접한 KPI(StatCard) 위젯은 동일 높이 그리드로 묶는다
              (D-01/D-03 — auto-fit 3~4열). 숨김(hidden) 위젯은 건너뛴다. */}
          {(() => {
            const KPI: WidgetId[] = ["traffic", "quality", "guardrail", "gpu"];
            const visibleWidgets = ordered.filter((w) => isVisible(layout, w.id));
            const blocks: ReactNode[] = [];
            let kpiRun: WidgetDescriptor[] = [];
            const flushKpi = (keySuffix: number) => {
              if (kpiRun.length === 0) return;
              blocks.push(
                <div className="kpi-grid" key={`kpi-${keySuffix}`}>
                  {kpiRun.map((w) => (
                    <div key={w.id} data-widget={w.id} style={{ display: "contents" }}>
                      {w.render()}
                    </div>
                  ))}
                </div>,
              );
              kpiRun = [];
            };
            visibleWidgets.forEach((w, idx) => {
              if (KPI.includes(w.id)) {
                kpiRun.push(w);
              } else {
                flushKpi(idx);
                blocks.push(
                  <div data-widget={w.id} key={w.id}>
                    {w.render()}
                  </div>,
                );
              }
            });
            flushKpi(visibleWidgets.length);
            return blocks;
          })()}
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
