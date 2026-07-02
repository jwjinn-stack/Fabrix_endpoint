// IMP-104 — explain-this 프리필 seam(module-level pub/sub, 순수·의존성 0).
//
// 딥 컴포넌트(배지·메트릭 라벨·위젯·선택 팝오버)가 전역 AssistPanel(IMP-103)을 "콕 집어" 프리필로
// 열도록 하는 얇은 이벤트 버스. AssistPanel 오픈 상태는 Layout 의 셸-로컬(IMP-103·IMP-88 격리)로
// 유지하고, 여기서는 prop-drilling/전역 provider 리렌더 없이 오픈 요청만 전달한다.
//
// 격리(IMP-88): 구독자가 없으면 openExplain 은 조용히 no-op(버스만 있고 AssistPanel 미마운트여도 크래시 0).
// 읽기 전용: 이 버스는 오직 "무엇을 설명해달라"는 요청만 나른다 — 어떤 mutation 도 트리거하지 않는다.

// 프리필 페이로드 — explainKey(glossary key/alias) 우선, 없으면 label(자유 질문 텍스트).
// widgetId 는 위젯 컨텍스트 강조용(IMP-105). 모두 선언된 값만(환각 금지) — label 은 사용자 선택/표시 텍스트.
export interface AssistPrefill {
  explainKey?: string; // IMP-108 glossary key 또는 alias(완전일치 조회)
  label?: string; // 사람이 보는 라벨/선택 텍스트(폴백 자유질문 텍스트)
  widgetId?: string; // IMP-105 widgetMeta id(컨텍스트 배너 강조)
}

type ExplainListener = (prefill: AssistPrefill) => void;

// 단일 구독자면 충분하지만(Layout 1곳), Set 으로 두어 재마운트/중복 구독에도 안전하게 동작.
const listeners = new Set<ExplainListener>();

// 구독 — Layout 이 호출. 반환 함수로 해지(useEffect cleanup).
export function subscribeExplain(cb: ExplainListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// 발화 — data-explain-key 어포던스/선택 팝오버가 호출. 구독자 없으면 no-op(격리).
export function openExplain(prefill: AssistPrefill): void {
  for (const cb of listeners) cb(prefill);
}
