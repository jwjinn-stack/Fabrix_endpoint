// IMP-105 — IMP-7 임계 카탈로그의 정적·순수 단일 출처.
//
// IMP-7(done)이 프론트/백 임계 중복을 없앤 원칙("카탈로그 임계는 한 곳") 위에서,
// mock.ts 의 ALERT_METRIC_CATALOG(키+단위+방향) + ALERT_RULES(기본 warn/alert 임계)를
// **순수 상수**로 승격한다. widgetMeta.describeWidget(IMP-105)·describe_widget MCP resource(IMP-106)가
// fetch 없이 동기·결정적으로 '이 숫자 좋은가/나쁜가'를 파생하려면 임계가 순수 값이어야 하기 때문.
//
// 단일 출처 규율: mock.ts 의 ALERT_METRIC_CATALOG/ALERT_RULES 는 이 카탈로그에서 파생한다
// (숫자를 두 곳에 적지 않는다 — 임계가 바뀌면 여기 한 곳만 고친다). widgetMeta 는 goodBadRef 로
// AlertMetric 키만 가리키고, 판정은 답변 시점에 라이브 값 vs 이 임계에서 파생한다.

import type { AlertMetric } from "./types";

export interface ThresholdCatalogEntry {
  title: string;
  unit: string; // ms | ratio | qps | count
  lowerBetter: boolean; // true=낮을수록 좋음(지연·에러 류), false=높을수록 좋음(처리량 류)
  warn?: number; // 주의 임계(warn_threshold). 없으면 warn 밴드 없음.
  alert?: number; // 위험 임계(alert_threshold).
}

// IMP-7 임계 단일 출처 — AlertMetric 키별 메타 + 기본 임계. mock ALERT_RULES/ALERT_METRIC_CATALOG 파생 원천.
export const THRESHOLD_CATALOG: Record<AlertMetric, ThresholdCatalogEntry> = {
  ttft_p95: { title: "TTFT p95", unit: "ms", lowerBetter: true, warn: 500, alert: 800 },
  latency_avg: { title: "E2E 지연 p95", unit: "ms", lowerBetter: true },
  error_rate: { title: "에러율", unit: "ratio", lowerBetter: true, warn: 0.02, alert: 0.05 },
  block_rate: { title: "가드 차단율", unit: "ratio", lowerBetter: true, alert: 0.1 },
  throughput: { title: "처리량(QPS)", unit: "qps", lowerBetter: false },
  count: { title: "가드 차단 건수", unit: "count", lowerBetter: true },
};

// metricThreshold — 키로 카탈로그 항목 조회(미지 키 → undefined, 환각 금지).
export function metricThreshold(key: string): ThresholdCatalogEntry | undefined {
  return (THRESHOLD_CATALOG as Record<string, ThresholdCatalogEntry>)[key];
}

export type Verdict = "good" | "warn" | "bad" | "unknown";

const VERDICT_LABEL: Record<Verdict, string> = {
  good: "양호",
  warn: "주의",
  bad: "위험",
  unknown: "판정 불가",
};

export interface DerivedVerdict {
  verdict: Verdict;
  label: string; // 색-only 금지 — 텍스트 병기(WCAG 1.4.1)
  // 임계 인용 — '이 판정이 어디서 왔는가'(IMP-7 카탈로그 키 + 임계값). 환각 방지 근거.
  citation: string;
}

// deriveVerdict — 라이브 값 vs IMP-7 임계에서 좋음/나쁨을 파생(숫자 인라인 없음, 단일 출처).
//   lowerBetter=true : value ≥ alert → bad, ≥ warn → warn, else good.
//   lowerBetter=false: value ≤ alert → bad, ≤ warn → warn, else good(높을수록 좋음이면 임계는 하한).
// 키 미지 / 값 미제공 / 임계 부재 → unknown(파생 불가 — 지어내지 않는다).
export function deriveVerdict(key: string, value?: number): DerivedVerdict {
  const t = metricThreshold(key);
  if (!t) return { verdict: "unknown", label: VERDICT_LABEL.unknown, citation: `임계 미선언 (IMP-7 catalog: ${key})` };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { verdict: "unknown", label: VERDICT_LABEL.unknown, citation: `현재 값 미제공 (IMP-7 catalog: ${key})` };
  }
  if (t.warn == null && t.alert == null) {
    // 임계 밴드가 없는 메트릭(처리량·지연 avg 등) — 방향은 알지만 good/bad 컷이 없음.
    return { verdict: "unknown", label: VERDICT_LABEL.unknown, citation: `임계 밴드 미설정 (IMP-7 catalog: ${key})` };
  }
  let verdict: Verdict;
  if (t.lowerBetter) {
    verdict = t.alert != null && value >= t.alert ? "bad" : t.warn != null && value >= t.warn ? "warn" : "good";
  } else {
    verdict = t.alert != null && value <= t.alert ? "bad" : t.warn != null && value <= t.warn ? "warn" : "good";
  }
  const bands = [t.warn != null ? `주의 ${t.warn}` : null, t.alert != null ? `위험 ${t.alert}` : null]
    .filter(Boolean)
    .join(" · ");
  const dir = t.lowerBetter ? "낮을수록 좋음" : "높을수록 좋음";
  return {
    verdict,
    label: VERDICT_LABEL[verdict],
    citation: `${t.title} ${value}${t.unit === "ratio" ? "" : t.unit} — 임계 ${bands} (${dir}, IMP-7 catalog: ${key})`,
  };
}
