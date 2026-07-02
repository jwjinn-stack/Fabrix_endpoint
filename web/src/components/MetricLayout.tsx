// IMP-80 — 객체 상세 3층 위계 레이아웃 프리미티브(단일 출처).
// GPU 상세(Gpu.tsx SlidePanel)와 노드 상세(NodeMetrics HostDetail)가 공유하는 컨테이너:
//   (Tier 1) SummaryStrip     — 핵심 KPI 게이지/값(IMP-54 Gauge 재사용). 요약 헤더.
//   (Tier 2) CategoryGrid     — 카테고리 카드 반응형 2~3열 그리드.
//            MetricCategoryCard — 접이식 카드(제목+상태 배지+mini 스파크라인+신호 행).
//   (Tier 3) 전체 메트릭 <details>(IMP-71 MetricExplorer) — 호출부가 그대로 중첩.
//
// Palantir Object View 360° / Datadog Host·GPU / Grafana 패널 그리드 밀도·위계를 지향.
// 상태색은 statusFromThresholds 계열 단일 출처(GPU/노드 관례) — 색-only 금지(상태 텍스트 병기, WCAG 1.4.1).
// 라이트 + 스틸블루, 네온 금지. caret/gauge transition 은 CSS(@media prefers-reduced-motion)가 정지(코드베이스 규약).
import { useId, useState } from "react";
import type { ReactNode } from "react";
import Gauge from "./Gauge";
import Sparkline from "./Sparkline";

export type MetricStatus3 = "ok" | "warn" | "crit";

const STATUS_LABEL: Record<MetricStatus3, string> = { ok: "정상", warn: "주의", crit: "위험" };
const STATUS_TAG: Record<MetricStatus3, string> = { ok: "green", warn: "amber", crit: "red" };
// 스파크라인/값 상태색 — 임계 밴드. ok 는 스틸블루(중립 positive), warn/crit 강조.
export function statusColor(s: MetricStatus3): string {
  return s === "crit" ? "var(--red)" : s === "warn" ? "var(--amber)" : "var(--primary)";
}

// ── (Tier 1) 요약 스트립 ─────────────────────────────────────────────
export interface SummaryKPI {
  label: string;
  valueText: string; // 값+단위(포맷 완료 텍스트) — 항상 텍스트로 노출(색-only 아님).
  status: MetricStatus3;
  /** 있으면 임계밴드 게이지(IMP-54). 없으면 값만. */
  gauge?: { value: number; warn: number; crit: number; max?: number };
}

// 핵심 KPI 게이지/값을 한 줄(반응형 그리드)로. 객체 상세 최상단 — "한눈에 상태".
// IMP-105 — widgetId 부착 시 어시스트가 이 요약 스트립을 화면-컨텍스트로 집는다(data-widget-id).
export function SummaryStrip({ items, widgetId }: { items: SummaryKPI[]; widgetId?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="metric-summary" role="group" aria-label="핵심 지표 요약" data-widget-id={widgetId}>
      {items.map((k) => (
        <div className={`metric-kpi metric-kpi-${k.status}`} key={k.label}>
          <span className="metric-kpi-label">{k.label}</span>
          <span className="metric-kpi-val" style={k.status !== "ok" ? { color: statusColor(k.status) } : undefined}>
            {k.valueText}
            {/* 색-only 금지: 임계 시 상태 텍스트 병기(WCAG 1.4.1). */}
            {k.status !== "ok" && <span className="metric-kpi-flag"> · {STATUS_LABEL[k.status]}</span>}
          </span>
          {k.gauge && (
            <Gauge
              value={k.gauge.value}
              warn={k.gauge.warn}
              crit={k.gauge.crit}
              max={k.gauge.max}
              valueText={k.valueText}
              label={k.label}
              height={6}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── (Tier 2) 카테고리 카드 그리드 ─────────────────────────────────────
export interface CategoryCardProps {
  title: string;
  /** 카테고리 최악 상태 — 헤더 배지(색+텍스트). 없으면 배지 생략. */
  status?: MetricStatus3;
  /** 헤더 우측 mini 스파크라인(대표 신호 추세 + 임계 밴드). */
  spark?: { values: number[]; status: MetricStatus3; warnValue?: number; critValue?: number };
  /** 기본 펼침. */
  defaultOpen?: boolean;
  children: ReactNode;
}

// 접이식 카테고리 카드 — 제목 + 상태 배지 + mini 스파크라인(헤더) → 펼치면 신호 행(children).
// <details> 대신 버튼 + aria-expanded(헤더에 스파크라인·배지를 겹쳐 배치하기 위해 커스텀 disclosure).
export function MetricCategoryCard({ title, status, spark, defaultOpen = true, children }: CategoryCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className={`card metric-cat-card${status ? ` metric-cat-${status}` : ""}`}>
      <button
        type="button"
        className="metric-cat-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`metric-cat-caret ${open ? "open" : ""}`} aria-hidden="true">▸</span>
        <span className="metric-cat-title">{title}</span>
        {status && (
          <span className={`tag tag-${STATUS_TAG[status]} metric-cat-badge`}>{STATUS_LABEL[status]}</span>
        )}
        {spark && spark.values.length > 1 && (
          <span className="metric-cat-spark" aria-hidden="true">
            <Sparkline
              values={spark.values}
              color={statusColor(spark.status)}
              width={96}
              height={24}
              warnValue={spark.warnValue}
              critValue={spark.critValue}
            />
          </span>
        )}
      </button>
      {open && (
        <div className="metric-cat-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

// 카드들을 반응형 2~3열 그리드로. 좁으면 1열(minmax auto-fill).
export function CategoryGrid({ children }: { children: ReactNode }) {
  return <div className="metric-cat-grid">{children}</div>;
}
