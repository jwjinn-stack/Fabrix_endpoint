// IMP-106 — 어시스트 컨텍스트 seam 소비부(순수·read-only).
//
// MCP primitive 분할(ontologyTools.ts 레지스트리 단일 출처에서 파생):
//  - glossary://{term}·widget://{id} = RESOURCE 템플릿 → 아래 resolver 가 GLOSSARY/WIDGET_META 를
//    순수 조회해 해석한다(tool-call 비용 0, addressable). 미지 → found:false(환각 금지).
//  - get_screen_context = read-only TOOL → 아래 executor 가 그 화면(route)에 마운트된 위젯 id·메타 +
//    동적 컨텍스트(objectId/facet/selection)만 반환한다(앱 전체 덤프 금지).
//
// **injection surface**: resolver/executor 는 GLOSSARY/WIDGET_META 의 선언된 값만 반환하고,
// 사용자 입력을 텍스트에 보간하지 않는다(prompt-injection 방어). URI 는 스킴 검증 후 term/id 만 추출.

import { lookupTerm, type GlossaryTerm } from "../api/glossary";
import { getScreenContext, describeWidget, type ScreenWidget } from "../components/widgetMeta";
import type { WidgetDescription, WidgetNotFound } from "../components/widgetMeta";
import type { Page } from "../components/Layout";

// ── URI 파서 — 스킴 + 부분(term/id) 추출(정적 검증만; 실행/부작용 없음) ──────────────────────
// glossary://ttft → { scheme:"glossary", part:"ttft" }. 알 수 없는 스킴 → null.
export interface ParsedAssistUri {
  scheme: "glossary" | "widget";
  part: string;
}
export function parseAssistUri(uri: string): ParsedAssistUri | null {
  if (typeof uri !== "string") return null;
  const m = /^(glossary|widget):\/\/(.+)$/.exec(uri.trim());
  if (!m) return null;
  const scheme = m[1] as "glossary" | "widget";
  const part = decodeURIComponent(m[2]).trim();
  if (!part) return null;
  return { scheme, part };
}

// ── glossary://{term} resolver — key/alias 완전일치(lookupTerm). 미지 → found:false ──────────────
export interface GlossaryResourceFound {
  found: true;
  uri: string;
  term: GlossaryTerm;
}
export interface GlossaryResourceNotFound {
  found: false;
  uri: string;
  message: "선언된 용어 없음"; // HARD grounding — 지어내지 않는다.
}
export function resolveGlossaryResource(term: string): GlossaryResourceFound | GlossaryResourceNotFound {
  const uri = `glossary://${term}`;
  const t = lookupTerm(term); // key 또는 alias 완전일치(대소문자 무시), 미지 = null
  if (!t) return { found: false, uri, message: "선언된 용어 없음" };
  return { found: true, uri, term: t };
}

// ── widget://{id} resolver — describeWidget 위임. 미지 → "선언된 메타 없음" ────────────────────
// liveValue 는 받지 않는다(리소스는 정적/read-only — verdict 라이브 파생은 tool/UI 답변 시점의 몫).
export interface WidgetResourceResult {
  uri: string;
  result: WidgetDescription | WidgetNotFound;
}
export function resolveWidgetResource(id: string): WidgetResourceResult {
  return { uri: `widget://${id}`, result: describeWidget(id) };
}

// ── resolveAssistResource(uri) — 스킴 디스패치(어시스트/mock/백엔드 공용 진입점) ──────────────
export type AssistResourceResolution =
  | { kind: "glossary"; uri: string; payload: GlossaryResourceFound | GlossaryResourceNotFound }
  | { kind: "widget"; uri: string; payload: WidgetDescription | WidgetNotFound }
  | { kind: "unknown"; uri: string };
export function resolveAssistResource(uri: string): AssistResourceResolution {
  const parsed = parseAssistUri(uri);
  if (!parsed) return { kind: "unknown", uri };
  if (parsed.scheme === "glossary") {
    return { kind: "glossary", uri, payload: resolveGlossaryResource(parsed.part) };
  }
  return { kind: "widget", uri, payload: resolveWidgetResource(parsed.part).result };
}

// ── get_screen_context executor(read-only TOOL) — route 스코프 위젯 + 동적 컨텍스트 ──────────────
// route 의 on-screen widget 만(SCREEN_WIDGETS 경계 — 정보폭탄 금지) + per-turn 동적 상태를 패스스루.
export interface ScreenContextArgs {
  route: Page;
  objectId?: string;
  facet?: string;
  selection?: string;
}
export interface ScreenContextResult {
  route: Page;
  widgets: ScreenWidget[]; // 그 화면에 마운트된 위젯 id + 정적 메타(선언된 것만)
  widgetIds: string[];     // 편의 — id 목록만
  objectId?: string;       // 열린 객체(동적)
  facet?: string;          // 활성 facet(동적)
  selection?: string;      // 선택 영역(동적)
  readOnly: true;          // 계약 표기 — 부작용 없음
}
export function getScreenContextResult(args: ScreenContextArgs): ScreenContextResult {
  const ctx = getScreenContext(args.route); // 선언된 메타 있는 위젯만(환각 금지)
  return {
    route: ctx.route,
    widgets: ctx.widgets,
    widgetIds: ctx.widgets.map((w) => w.id),
    objectId: args.objectId,
    facet: args.facet,
    selection: args.selection,
    readOnly: true,
  };
}
