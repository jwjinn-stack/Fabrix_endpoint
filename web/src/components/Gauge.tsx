import { statusFromThresholds } from "../api/mockFactory";

// IMP-54 — 경량 선형 임계밴드 게이지. 포화(util/load/retransmit)를 즉시 읽히게.
// Grafana bar gauge / Datadog host map 밀도 관례: 트랙에 warn/crit 임계 밴드 + 값 채움 + 임계 눈금.
// 자체 SVG, 신규 deps 없음. 색은 statusFromThresholds → 기존 GPU 포화색 토큰 재사용(화면 간 일관).
// 색-only 금지(WCAG 1.4.1): aria-label 에 라벨·값·상태 병기, 값 텍스트는 호출부에서 함께 노출.

const STATUS_LABEL = { ok: "정상", warn: "주의", crit: "위험" } as const;
const FILL_COLOR = { ok: "var(--primary)", warn: "var(--amber)", crit: "var(--red)" } as const;

export interface GaugeProps {
  value: number;
  warn: number;
  crit: number;
  /** 게이지 최대. 기본 = crit*1.15(위험 임계가 트랙 우측 근처에 오도록). */
  max?: number;
  /** 표시할 포맷 값 텍스트. */
  valueText: string;
  /** 신호 라벨(aria·표시). */
  label: string;
  /** viewBox 폭(부모 폭은 CSS 100%). 기본 100. */
  width?: number;
  /** 트랙 두께(px). 기본 8. */
  height?: number;
}

// clamp 0..1
const frac = (v: number, m: number) => (m <= 0 ? 0 : Math.min(1, Math.max(0, v / m)));

export default function Gauge({ value, warn, crit, max, valueText, label, width = 100, height = 8 }: GaugeProps) {
  const hi = crit >= warn; // higher-is-worse(대부분 포화). statusFromThresholds 와 동일 규약.
  const m = max ?? (hi ? crit * 1.15 || 1 : Math.max(value, warn) * 1.15 || 1);
  const status = statusFromThresholds(value, warn, crit);
  const fillW = frac(value, m) * width;
  const r = height / 2;

  // 임계 밴드(트랙 배경): higher-is-worse 일 때 ok[0..warn) / warn[warn..crit) / crit[crit..max].
  const warnX = frac(warn, m) * width;
  const critX = frac(crit, m) * width;

  return (
    <svg
      className="gauge"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} ${valueText} — 상태 ${STATUS_LABEL[status]}`}
    >
      {/* 트랙 밴드 — 임계 구간 색(포화 즉시 인지). 라이트 톤(weak). */}
      <rect className="gauge-band gauge-band-ok" x={0} y={0} width={hi ? warnX : width} height={height} rx={r} ry={r} fill="var(--grid-line)" />
      {hi && (
        <>
          <rect className="gauge-band gauge-band-warn" x={warnX} y={0} width={Math.max(0, critX - warnX)} height={height} fill="var(--amber-weak)" />
          <rect className="gauge-band gauge-band-crit" x={critX} y={0} width={Math.max(0, width - critX)} height={height} rx={r} ry={r} fill="var(--red-weak)" />
        </>
      )}
      {/* 값 채움 — 상태 색(statusFromThresholds 단일 출처). */}
      <rect className="gauge-fill" x={0} y={0} width={Math.max(0, fillW)} height={height} rx={r} ry={r} fill={FILL_COLOR[status]} />
      {/* 임계 눈금(tick) — warn/crit 위치 세로선(밴드 경계 강조). higher-is-worse 만. */}
      {hi && (
        <>
          <line className="gauge-tick gauge-tick-warn" x1={warnX} x2={warnX} y1={0} y2={height} stroke="var(--amber)" strokeWidth={0.75} opacity={0.7} />
          <line className="gauge-tick gauge-tick-crit" x1={critX} x2={critX} y1={0} y2={height} stroke="var(--red)" strokeWidth={0.75} opacity={0.7} />
        </>
      )}
    </svg>
  );
}
