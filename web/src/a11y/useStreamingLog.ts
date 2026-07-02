import { useCallback, useRef, useState } from "react";

// useStreamingLog — 스트리밍 답변의 접근성 낭독 계약(IMP-102 핵심 정정).
//
// ✗ 하지 말 것: 증분 토큰을 aria-live 에 흘리기.
//   → 스크린리더가 매 변경마다 재낭독·앞 낭독 가로채기 → 사용자는 오히려 "못 알아듣는" 회귀.
// ✓ 할 것(SOTA — '증분 낭독' 아니라 '완료 낭독 + 진행상태 낭독'):
//   (a) 확정 메시지 리스트만 role=log(aria-live=polite, aria-atomic=false) 로 렌더 → 완성분만 온전히 낭독.
//   (b) 진행 중 버퍼(draft)는 aria-busy=true 버블로 두고 낭독 대상에서 제외(aria-hidden).
//   (c) commit() 시 완성 메시지를 log 에 확정 append → 한 번에 낭독.
//   (d) 진행/에러/완료는 별도 role=status(polite)에 짧게 — 무음 실패 금지.
//
// 이 훅은 mock-first 로 어떤 소스(SSE/ReadableStream/rule-based 폴백)든 토큰을 흘려넣는 순수 상태기.

export type StreamPhase = "idle" | "streaming" | "done" | "error";

export interface LogMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

// role=status 진행 문구(무음 실패 금지). 호출부가 커스터마이즈 가능하도록 export.
export const STATUS_TEXT: Record<StreamPhase, string> = {
  idle: "",
  streaming: "응답 생성 중",
  done: "완료",
  error: "연결 오류",
};

let seq = 0;
const nextId = () => `msg-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export interface StreamingLogApi {
  messages: LogMessage[]; // 확정(완료)된 메시지만 — role=log 에 렌더
  draft: string; // 진행 중 버퍼(aria-busy 버블, 낭독 제외)
  phase: StreamPhase;
  statusText: string; // role=status 문구
  /** 사용자 질문을 log 에 확정 append(즉시 낭독돼도 되는 완성 텍스트). */
  pushUser(text: string): void;
  /** 어시스트 응답 스트리밍 시작 — draft 초기화 + phase=streaming. */
  begin(): void;
  /** 토큰 증분을 draft 에 누적(낭독되지 않음). */
  appendToken(token: string): void;
  /** 스트림 완료 — draft 를 확정 메시지로 log 에 append(한 번에 낭독) + phase=done. */
  commit(): void;
  /** 실패 — draft 폐기(부분 응답은 확정하지 않음) + phase=error + status 낭독. */
  fail(message?: string): void;
  /** 전체 초기화. */
  reset(): void;
}

export function useStreamingLog(): StreamingLogApi {
  const [messages, setMessages] = useState<LogMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  // draft 를 ref 로도 들고 있어 commit 시 최신값을 setState 순서와 무관하게 확정.
  const draftRef = useRef("");

  const pushUser = useCallback((text: string) => {
    setMessages((m) => [...m, { id: nextId(), role: "user", text }]);
  }, []);

  const begin = useCallback(() => {
    draftRef.current = "";
    setDraft("");
    setStatusOverride(null);
    setPhase("streaming");
  }, []);

  const appendToken = useCallback((token: string) => {
    draftRef.current += token;
    setDraft(draftRef.current);
  }, []);

  const commit = useCallback(() => {
    const text = draftRef.current;
    draftRef.current = "";
    setDraft("");
    setPhase("done");
    setStatusOverride(null);
    // 완성분만 log 에 확정 append → role=log 가 한 번에 온전히 낭독.
    if (text) setMessages((m) => [...m, { id: nextId(), role: "assistant", text }]);
  }, []);

  const fail = useCallback((message?: string) => {
    // 부분 응답은 확정하지 않는다(불완전 텍스트를 정답처럼 낭독하지 않음).
    draftRef.current = "";
    setDraft("");
    setPhase("error");
    setStatusOverride(message ?? null);
  }, []);

  const reset = useCallback(() => {
    draftRef.current = "";
    setMessages([]);
    setDraft("");
    setStatusOverride(null);
    setPhase("idle");
  }, []);

  const statusText = statusOverride ?? STATUS_TEXT[phase];

  return { messages, draft, phase, statusText, pushUser, begin, appendToken, commit, fail, reset };
}

// 스크롤 점프 방지 판정(순수 함수 — 테스트 가능).
// 사용자가 하단 근처(threshold px 이내)에 있을 때만 새 메시지를 따라 내려간다.
// 위로 스크롤해 지난 답변을 읽는 중이면 강제로 끌어내리지 않는다.
export function shouldFollowScroll(
  el: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  threshold = 48,
): boolean {
  const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
  return distanceFromBottom <= threshold;
}

export default useStreamingLog;
