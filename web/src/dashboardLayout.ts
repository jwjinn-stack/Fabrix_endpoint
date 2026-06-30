// IMP-40 — 커스텀 대시보드 v1: 위젯 레이아웃(순서 + 표시여부)을 localStorage 에 영속.
//
// 의존성 0. savedViews.ts 의 방어적 read/write 패턴을 재사용한다 —
// 저장값은 위젯 id 참조(순서/숨김)뿐이라 민감정보가 없고, 잘못된 값은 throw 없이 default 로 폴백한다.
// observe 프로파일도 개인 레이아웃은 localStorage 이므로 write-gate 불요(서버 mutation 아님).
//
// v1 범위: show/hide + reorder(위/아래) + localStorage 영속.
// follow-up(미구현): drag/resize, 명명된 multi-dashboard, persona 템플릿 원클릭, share-by-URL, 서버 동기화.

export type WidgetId =
  | "traffic"
  | "quality"
  | "guardrail"
  | "gpu"
  | "distribution"
  | "timeseries"
  | "alarms";

// 위젯이 주로 어느 역할(persona)에 유용한지 — 편집모드 UI 의 보조 태그. 동작에는 영향 없음.
export type Persona = "cost" | "sre" | "security" | "ops";

export interface DashboardLayout {
  order: WidgetId[]; // 전체 위젯 id 의 순열(표시 순서)
  hidden: WidgetId[]; // 숨김 처리된 위젯 id (order ⊇ hidden)
}

// canonical 기본 순서 — 누락 보강·정규화의 기준.
export const ALL_WIDGETS: readonly WidgetId[] = [
  "traffic",
  "quality",
  "guardrail",
  "gpu",
  "distribution",
  "timeseries",
  "alarms",
];

const WIDGET_SET = new Set<string>(ALL_WIDGETS);

function isWidgetId(v: unknown): v is WidgetId {
  return typeof v === "string" && WIDGET_SET.has(v);
}

// 기본 레이아웃 — GPU/MIG 는 기본 숨김(기존 "더 보기" 동작 계승: 글랜스 인지부하 ↓).
export const DEFAULT_LAYOUT: DashboardLayout = {
  order: [...ALL_WIDGETS],
  hidden: ["gpu"],
};

const STORE_KEY = "fabrix.dashboard.layout";

// 임의의 값 → 유효한 레이아웃. throw 금지(crafted/legacy localStorage 방어).
// order: ALL_WIDGETS 가 정확히 1회씩 등장하도록 보정(미지/중복 제거 후 누락은 canonical 순서로 append).
// hidden: ALL_WIDGETS 교집합 + 중복 제거.
export function normalizeLayout(raw: unknown): DashboardLayout {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const rawOrder = Array.isArray(obj.order) ? obj.order : [];
  const seen = new Set<WidgetId>();
  const order: WidgetId[] = [];
  for (const v of rawOrder) {
    if (isWidgetId(v) && !seen.has(v)) {
      seen.add(v);
      order.push(v);
    }
  }
  // 누락된 위젯은 canonical 순서로 뒤에 채운다.
  for (const w of ALL_WIDGETS) {
    if (!seen.has(w)) order.push(w);
  }

  const rawHidden = Array.isArray(obj.hidden) ? obj.hidden : [];
  const hiddenSet = new Set<WidgetId>();
  for (const v of rawHidden) {
    if (isWidgetId(v)) hiddenSet.add(v);
  }

  return { order, hidden: order.filter((w) => hiddenSet.has(w)) };
}

export function loadLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return normalizeLayout(DEFAULT_LAYOUT);
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return normalizeLayout(DEFAULT_LAYOUT);
  }
}

export function saveLayout(layout: DashboardLayout): DashboardLayout {
  const normalized = normalizeLayout(layout);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
  } catch {
    /* localStorage 불가(프라이빗 모드 등) — 조용히 무시 */
  }
  return normalized;
}

export function isVisible(layout: DashboardLayout, id: WidgetId): boolean {
  return !layout.hidden.includes(id);
}

// 표시/숨김 토글 — hidden 배열만 갱신(order 불변).
export function toggleWidget(layout: DashboardLayout, id: WidgetId): DashboardLayout {
  if (!isWidgetId(id)) return layout;
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((w) => w !== id)
    : [...layout.hidden, id];
  return { order: [...layout.order], hidden };
}

// 인접 위젯과 swap. 경계(맨위 up / 맨아래 down)는 무변. drag 미도입(v1).
export function moveWidget(layout: DashboardLayout, id: WidgetId, dir: "up" | "down"): DashboardLayout {
  const order = [...layout.order];
  const i = order.indexOf(id);
  if (i < 0) return layout;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return layout;
  [order[i], order[j]] = [order[j], order[i]];
  return { order, hidden: [...layout.hidden] };
}
