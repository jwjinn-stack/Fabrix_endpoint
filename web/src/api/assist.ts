// IMP-103 — 전역 Assist 답변 seam(순수·결정적·의존성 0).
//
// 전역 in-context Assist 패널(AssistPanel)이 소비하는 답변 생성부. mock-first(honest):
// 실 모델이 없으므로 결정적 rule-based 로만 답한다 — 지어내지 않는다(환각 금지).
//   (a) glossary 용어 완전일치(IMP-108 lookupTerm) → 큐레이션 정의(short + why + 관련어).
//   (b) '이 화면 설명' → 현재 route 의 마운트 위젯 메타(IMP-105/106 getScreenContextResult) 요약.
//   (c) 위 실패 → 정직한 폴백("등록된 용어를 못 찾음 · 실 모델 미연결"). 환각 금지.
//
// **IMP-110 seam**: 아래 buildAssistAnswer 는 완성 답변 문자열을 낸다. chunkAnswer 로 단어 단위
// 청크를 만들어 useStreamingLog(begin→appendToken→commit)에 흘린다 — 실 스트리밍(streamAssist)은
// 이 chunk 소스만 SSE/ReadableStream 으로 스왑하면 되고, UI/낭독 계약(IMP-102)은 그대로다.
//
// **injection surface**: 사용자 입력(query)을 프롬프트/정의에 보간하지 않는다. resolver 는 선언된
// GLOSSARY/WIDGET_META 값만 반환한다(prompt-injection 방어). 부작용 0(read-only).

import { lookupTerm } from "./glossary";
import { getScreenContextResult } from "../actions/assistContext";
import type { Page } from "../components/Layout";

// route → 사람이 읽는 화면명(NAV 라벨 정합 — 단일 출처). 컨텍스트 배너·설명 문두에 쓴다.
const SCREEN_TITLE: Record<Page, string> = {
  dashboard: "관제",
  ontology: "온톨로지",
  usage: "사용량",
  guard: "가드레일",
  traces: "트레이스",
  sessions: "세션",
  models: "모델",
  "model-import": "모델 임포트",
  playground: "플레이그라운드",
  eval: "평가",
  endpoints: "엔드포인트",
  gpu: "GPU / MIG",
  nodes: "노드",
  network: "네트워크",
  topology: "토폴로지",
  investigate: "근본원인 추적(COP)",
  agent: "AI Agent",
  keys: "키·앱",
  traffic: "트래픽",
  settings: "설정",
  credentials: "서드파티 자격증명",
  diagnostics: "연동 상태",
  "metric-sources": "메트릭 소스",
};

export function screenTitle(route: Page): string {
  return SCREEN_TITLE[route] ?? route;
}

export type AssistAnswerKind = "term" | "screen" | "fallback";

export interface AssistAnswer {
  kind: AssistAnswerKind;
  text: string; // 완성 답변(escape 텍스트로 렌더 — HTML 아님)
  grounded: boolean; // glossary/screen 근거가 있었는가(fallback=false)
}

// 현재 화면 컨텍스트 — 자동 주입(getScreenContextResult 파생). 패널이 배너로 표기하고 설명에 인용.
export interface AssistScreenCtx {
  route: Page;
  title: string;
  widgetTitles: string[]; // 마운트 위젯 제목(정보폭탄 금지 — 선언된 것만)
}

export function buildScreenCtx(route: Page): AssistScreenCtx {
  const ctx = getScreenContextResult({ route });
  return {
    route,
    title: screenTitle(route),
    widgetTitles: ctx.widgets.map((w) => w.meta.title),
  };
}

// '이 화면 설명' — 현재 route 의 마운트 위젯 메타를 근거로 결정적 설명을 조립(환각 금지).
export function describeScreen(route: Page): AssistAnswer {
  const ctx = getScreenContextResult({ route });
  const title = screenTitle(route);
  if (ctx.widgets.length === 0) {
    // 선언된 위젯 메타가 없는 화면 — 지어내지 않고 정직히 알린다.
    return {
      kind: "screen",
      grounded: false,
      text: `‘${title}’ 화면입니다. 이 화면에는 아직 어시스트가 설명할 수 있도록 등록된 위젯 메타가 없습니다. 특정 용어(예: TTFT, backpressure)를 물어보시면 정의를 알려드립니다.`,
    };
  }
  const lines = ctx.widgets.map((w) => `· ${w.meta.title}: ${w.meta.whatItShows}`);
  return {
    kind: "screen",
    grounded: true,
    text: `‘${title}’ 화면에는 다음 위젯이 있습니다.\n${lines.join("\n")}\n\n각 위젯의 좋음/나쁨 판정 기준과 관련 용어는 위젯의 ⓘ 도움말에서 확인할 수 있습니다.`,
  };
}

// 자유 질문 → 결정적 rule-based 답변. glossary 완전일치 우선, 없으면 정직 폴백(실 모델 미연결).
export function buildAssistAnswer(query: string, route: Page): AssistAnswer {
  const q = (query ?? "").trim();
  if (!q) {
    return { kind: "fallback", grounded: false, text: "무엇이 궁금하신가요? 용어(예: TTFT, p95, backpressure)나 ‘이 화면 설명’을 물어보세요." };
  }
  // 용어 조회 — key/alias 완전일치(대소문자 무시). 질문형 접미사("란?", "가 뭐야" 등)를 벗겨 재시도.
  const term = lookupTerm(q) ?? lookupTerm(stripQuestion(q));
  if (term) {
    const why = term.why ? `\n\n왜 중요한가: ${term.why}` : "";
    return {
      kind: "term",
      grounded: true,
      text: `${term.term}\n\n${term.short}${why}`,
    };
  }
  // 미등록 — 지어내지 않는다. 실 모델 미연결임을 정직히 표기(IMP-110 이 실모델 폴백으로 승격).
  return {
    kind: "fallback",
    grounded: false,
    text: `‘${q}’에 대해 등록된 용어 정의를 찾지 못했습니다.\n\n현재는 mock(rule-based) 모드라 등록된 용어(관측·지연·GPU·트래픽 카테고리)와 ‘이 화면(${screenTitle(route)}) 설명’만 답할 수 있습니다. 실제 추론 모델을 연결하면 자유질문에 답합니다(VITE_MOCK=off).`,
  };
}

// 한국어 질문형 접미사/조사 제거 — glossary 완전일치 재시도용(관대한 매칭, 지어내진 않음).
function stripQuestion(q: string): string {
  return q
    .replace(/[?？]+$/g, "")
    .replace(/(란|이란|는|은|가|이|를|을|에 대해|에 대하여|이 뭐야|가 뭐야|뭐야|설명해줘|설명|알려줘)\s*$/g, "")
    .trim();
}

// 답변을 단어 단위 청크로 — useStreamingLog.appendToken 에 순차 흘린다(진행상태 낭독 + 시각 caret).
// IMP-110: 이 배열 소스만 실 스트림 토큰으로 스왑하면 UI/낭독 계약은 불변.
export function chunkAnswer(text: string): string[] {
  if (!text) return [];
  // 공백/개행을 유지하며 토큰화(가독성 있는 청크 — 줄바꿈 보존).
  const parts = text.match(/\S+\s*|\s+/g);
  return parts ?? [text];
}
