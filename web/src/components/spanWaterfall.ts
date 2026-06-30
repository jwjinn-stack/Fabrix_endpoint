import type { SpanKind, TraceSpan } from "../api/types";

// IMP-34: 스팬 워터폴 순수 기하/집계 헬퍼 — 시각 로직과 분리해 테스트한다.
// 라이트+스틸블루 UI 의 시간축 정렬 막대·깊이 들여쓰기·self시간·범례를 위한 계산만.

const MIN_BAR_PCT = 0.8; // 0ms 에 가까운 span 도 보이게 하는 최소 막대 폭(%)

// span 의 트레이스 시작 기준 offset(start_ms)·duration_ms 를 전체(total) 대비 % 로.
// left/width 모두 0..100 클램프, width 는 최소폭 보장(시각적으로 사라지지 않게).
export function spanGeometry(span: TraceSpan, total: number): { leftPct: number; widthPct: number } {
  const t = total > 0 ? total : 1;
  const rawLeft = (span.start_ms / t) * 100;
  const rawWidth = (span.duration_ms / t) * 100;
  const leftPct = clampPct(rawLeft);
  // 시작점이 우측 끝이면 막대가 넘치지 않도록 폭을 남은 공간으로 제한.
  const widthPct = Math.min(Math.max(rawWidth, MIN_BAR_PCT), 100 - leftPct || MIN_BAR_PCT);
  return { leftPct, widthPct };
}

function clampPct(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(Math.max(v, 0), 100);
}

// parent_id 체인을 따라 들여쓰기 레벨 산출(사이클 가드). 평면이면 0.
export function spanDepth(sp: TraceSpan, byId: Map<string, TraceSpan>): number {
  let depth = 0;
  let cur = sp.parent_id ? byId.get(sp.parent_id) : undefined;
  const seen = new Set<string>([sp.span_id]);
  while (cur && !seen.has(cur.span_id)) {
    depth += 1;
    seen.add(cur.span_id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return depth;
}

// self 시간 = 이 span 의 duration − 직속 자식 duration 합. 음수면 0 클램프.
// (자식이 부모 구간을 넘겨도 음수로 표시하지 않음 — Langfuse self-time 패턴.)
export function selfMs(span: TraceSpan, spans: TraceSpan[]): number {
  const childSum = spans
    .filter((c) => c.parent_id === span.span_id)
    .reduce((s, c) => s + Math.max(0, c.duration_ms), 0);
  return Math.max(0, span.duration_ms - childSum);
}

// 등장 순서를 보존한 kind 별 개수(응집 범례 칩용).
export function kindCounts(spans: TraceSpan[]): { kind: SpanKind; count: number }[] {
  const order: SpanKind[] = [];
  const counts = new Map<SpanKind, number>();
  for (const sp of spans) {
    if (!counts.has(sp.kind)) { counts.set(sp.kind, 0); order.push(sp.kind); }
    counts.set(sp.kind, counts.get(sp.kind)! + 1);
  }
  return order.map((k) => ({ kind: k, count: counts.get(k)! }));
}
