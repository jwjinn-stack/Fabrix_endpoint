// IMP-97 — 인시던트 상태 용어 glossary(순수·의존성 0).
//
// IMP-108 로 전역 glossary.ts 로 승격됨 — 이 파일은 상태 7개 term 하위셋의 안정 진입점(회귀 0).
// COP(Investigate)·KineticStrip·ObjectView 의 상태 배지(triggered/acked·NotReady·warn/crit·backpressure)를
// 화면 clutter 없이 in-flow 자가설명(tooltip-on-demand). 세 표면이 이 하나만 소비해 문구가 갈라지지 않게 한다.
// '가장 경험 적은 온콜' 기준 — 짧은 정의(short) + 왜 중요한가(why)를 한 줄씩(정보폭탄 금지).
//
// 렌더는 StatusInfoTip(IMP-4 InfoTip 재사용, hover+focus+tap·Esc dismiss·not hover-only) 이 담당.

import { GLOSSARY, STATUS_TERM_KEYS } from "./glossary";
import type { GlossaryTerm } from "./glossary";

// 하위 호환: 스키마 타입·조회 헬퍼 재노출(기존 import 경로 유지).
export type { GlossaryTerm } from "./glossary";
export { glossaryTerm } from "./glossary";

// 상태 용어 단일 출처(하위셋) — 전역 GLOSSARY 에서 상태 7개 key 만 파생.
// key 는 소문자 안정 식별자(배지/상태 문자열과 매핑). 문구는 glossary.ts 가 단일 출처.
export const STATUS_GLOSSARY: Record<string, GlossaryTerm> = Object.fromEntries(
  STATUS_TERM_KEYS.map((k) => [k, GLOSSARY[k]]),
);
