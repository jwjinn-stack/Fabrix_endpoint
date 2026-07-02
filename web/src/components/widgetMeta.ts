// IMP-105 — 위젯·영역 메타 선언(얇은 선언적 레지스트리).
//
// 대시보드 카드·KPI·패널이 '무엇을 보여주고(what) 좋음/나쁨 기준이 뭔지(good/bad)' 를 선언적으로
// 갖게 한다. 어시스트(IMP-106 describe_widget/get_screen_context)가 '이 숫자 좋은가/나쁜가'를
// 근거 인용해 즉답하고, InfoTip/EvidencePanel 이 사람에게도 self-document 하는 단일 계약.
//
// 설계 규율:
//  - 얇음: id → { title, whatItShows, goodBadRef?, relatedTerms[] } 뿐. 렌더 로직·숫자 없음.
//  - 단일 출처(no inline numbers): goodBadRef 는 IMP-7 임계 카탈로그(thresholdCatalog) 키 + 방향만
//    가리킨다. 좋음/나쁨 판정은 답변 시점에 라이브 값 vs 임계에서 deriveVerdict 로 파생한다.
//  - 정보폭탄 금지: getScreenContext(route)는 그 화면에 마운트된 위젯만 준다(앱 전체 덤프 금지).
//  - HARD grounding: 메타 없는 위젯 → "선언된 메타 없음"(환각 금지).
//  - relatedTerms 는 IMP-108 glossary key 를 가리킨다(용어 정의 단일 출처).
//
// Grafana Assistant(2025-08)의 패널-컨텍스트 + Dashboard Design Patterns(Data Description/Threshold)
// 계약을 FABRIX 부재분으로 채운다.

import type { Page } from "./Layout";
import type { AlertMetric } from "../api/types";
import { deriveVerdict, metricThreshold, type DerivedVerdict } from "../api/thresholdCatalog";
import { glossaryTerm, type GlossaryTerm } from "../api/glossary";

// goodBadRef — IMP-7 임계 카탈로그 참조(숫자 인라인 금지). direction 은 사람이 읽는 방향 표기이며
// 실제 판정 방향은 thresholdCatalog 의 lowerBetter 가 결정한다(단일 출처).
export interface GoodBadRef {
  metric: AlertMetric; // thresholdCatalog 키(단일 출처)
  direction: "lower-better" | "higher-better"; // 사람 표기 — 판정은 카탈로그 lowerBetter 파생
}

export interface WidgetMeta {
  title: string; // 위젯 제목(카드 헤더와 정합)
  whatItShows: string; // 무엇을 보여주는가(한 줄, 정보폭탄 금지)
  goodBadRef?: GoodBadRef; // 좋음/나쁨 판정 근거(IMP-7 임계 키). 없으면 판정 없이 설명만.
  relatedTerms: string[]; // IMP-108 glossary key(탐색/정의)
}

// 위젯 메타 레지스트리 — 고트래픽 KPI/스코어카드부터 점진 부착.
// id 규약: "<route>.<widget>"(getScreenContext 가 route 로 스코핑하기 쉽게).
export const WIDGET_META: Record<string, WidgetMeta> = {
  // ── Dashboard 고트래픽 StatCard 4종 ──────────────────────────────────────
  "dashboard.traffic": {
    title: "실시간 트래픽",
    whatItShows: "vLLM 엔진의 실행/대기 요청 수·초당 처리량(QPS)·성공률 — 지금 얼마나 들어오고 처리되는지.",
    goodBadRef: { metric: "throughput", direction: "higher-better" },
    relatedTerms: ["qps", "concurrency", "queue-depth", "backpressure"],
  },
  "dashboard.quality": {
    title: "응답 품질",
    whatItShows: "첫 토큰까지 지연(TTFT p95)·토큰 간 지연(ITL)·KV/prefix 캐시 적중률 — 체감 응답성.",
    goodBadRef: { metric: "ttft_p95", direction: "lower-better" },
    relatedTerms: ["ttft", "p95", "prefill", "decode"],
  },
  "dashboard.guardrail": {
    title: "가드레일",
    whatItShows: "가드레일이 차단한 요청·PII·Jailbreak·flagged 건수(증적 기반) — 정책 개입 규모.",
    goodBadRef: { metric: "block_rate", direction: "lower-better" },
    relatedTerms: ["block-rate", "error-rate"],
  },
  "dashboard.gpu": {
    title: "GPU / MIG",
    whatItShows: "GPU 사용률·KV 캐시 점유·MIG 슬라이스 효율 — 자원이 얼마나 알차게 쓰이는지.",
    // goodBadRef 없음: 사용률은 IMP-7 알림 카탈로그에 없는 메트릭 — 판정 없이 설명·용어만 제공(환각 금지).
    relatedTerms: ["xid", "nvlink", "ecc", "replica"],
  },
};

// 화면(route=Page) → 마운트된 위젯 id 목록(on-screen only). 정보폭탄 방지의 스코프 경계.
export const SCREEN_WIDGETS: Partial<Record<Page, string[]>> = {
  dashboard: ["dashboard.traffic", "dashboard.quality", "dashboard.guardrail", "dashboard.gpu"],
};

// widgetMeta — id 로 메타 조회(미지 → undefined).
export function widgetMeta(id: string): WidgetMeta | undefined {
  return WIDGET_META[id];
}

// ── getScreenContext(route) — 현재 화면에 마운트된 위젯 id + 메타만(앱 전체 덤프 금지) ─────────
export interface ScreenWidget {
  id: string;
  meta: WidgetMeta;
}
export interface ScreenContext {
  route: Page;
  widgets: ScreenWidget[];
}

export function getScreenContext(route: Page): ScreenContext {
  const ids = SCREEN_WIDGETS[route] ?? [];
  const widgets: ScreenWidget[] = [];
  for (const id of ids) {
    const meta = WIDGET_META[id];
    if (meta) widgets.push({ id, meta }); // 선언된 메타가 있는 위젯만(환각 금지)
  }
  return { route, widgets };
}

// ── describeWidget(id, liveValue?) — 전체 메타 + 라이브 값의 파생 판정(임계 인용) ─────────────
export interface WidgetDescription {
  found: true;
  id: string;
  title: string;
  whatItShows: string;
  // goodBadRef 있으면 라이브 값 vs IMP-7 임계에서 파생한 판정 + 인용. 없으면 undefined(판정 없이 설명만).
  verdict?: DerivedVerdict;
  goodBadRef?: GoodBadRef;
  relatedTerms: string[];
}
export interface WidgetNotFound {
  found: false;
  id: string;
  message: "선언된 메타 없음"; // HARD grounding — 지어내지 않는다.
}

export function describeWidget(id: string, liveValue?: number): WidgetDescription | WidgetNotFound {
  const meta = WIDGET_META[id];
  if (!meta) return { found: false, id, message: "선언된 메타 없음" };
  // 좋음/나쁨은 답변 시점에 IMP-7 임계로 파생(widgetMeta 에 숫자 인라인 없음 — 단일 출처).
  const verdict = meta.goodBadRef ? deriveVerdict(meta.goodBadRef.metric, liveValue) : undefined;
  return {
    found: true,
    id,
    title: meta.title,
    whatItShows: meta.whatItShows,
    verdict,
    goodBadRef: meta.goodBadRef,
    relatedTerms: meta.relatedTerms,
  };
}

// widgetRelatedTerms — relatedTerms 를 glossary term 으로 해석(미지 key 는 제외 — 환각 금지).
// InfoTip/EvidencePanel passive 노출·어시스트 인용이 공용으로 쓴다.
export function widgetRelatedTerms(id: string): GlossaryTerm[] {
  const meta = WIDGET_META[id];
  if (!meta) return [];
  const out: GlossaryTerm[] = [];
  for (const key of meta.relatedTerms) {
    const t = glossaryTerm(key);
    if (t) out.push(t); // 선언된 glossary term 만(없는 용어를 지어내지 않는다)
  }
  return out;
}

// goodBadRef 가 유효한 카탈로그 키를 가리키는지(레지스트리 무결성 — 테스트/개발 가드).
export function widgetGoodBadValid(id: string): boolean {
  const meta = WIDGET_META[id];
  if (!meta || !meta.goodBadRef) return true; // 참조 없으면 유효(판정 없음)
  return metricThreshold(meta.goodBadRef.metric) !== undefined;
}
