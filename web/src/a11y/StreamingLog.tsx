import { useEffect, useRef } from "react";
import type { LogMessage, StreamPhase } from "./useStreamingLog";
import { shouldFollowScroll } from "./useStreamingLog";

// StreamingLog — IMP-102 스트리밍 낭독 계약의 표현 컴포넌트(무의존).
// useStreamingLog 출력(또는 동형 props)을 받아 아래 세 영역을 렌더한다:
//   1. role=log(aria-live=polite, aria-atomic=false) — 확정 메시지만. 완성분이 한 번에 낭독됨.
//   2. draft 버블 — aria-busy=true + aria-hidden(낭독 제외). 진행 중 토큰의 시각 표시 전용.
//   3. role=status(polite) — "응답 생성 중"/"완료"/"연결 오류" 진행상태(무음 실패 금지).
// 스크롤 점프 방지: 사용자가 하단 근처일 때만 새 메시지를 따라간다(shouldFollowScroll).
// 색/대비는 기존 토큰만 사용(Backend.AI 라이트 + 스틸블루). 액션 타깃은 .a11y-target-min(≥24px).
export default function StreamingLog({
  messages,
  draft,
  phase,
  statusText,
  labelledBy,
}: {
  messages: LogMessage[];
  draft: string;
  phase: StreamPhase;
  statusText: string;
  /** role=log 를 설명하는 제목 id(선택). */
  labelledBy?: string;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const streaming = phase === "streaming";

  // 확정 메시지가 늘 때만, 그리고 사용자가 하단 근처일 때만 스크롤을 따라간다(점프 방지).
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (shouldFollowScroll(el)) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div className="streaming-log-wrap">
      {/* 확정 메시지 — 완료된 것만 낭독(증분 아님). */}
      <div
        ref={logRef}
        className="streaming-log"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-labelledby={labelledBy}
        // 스크롤 가능한 log 영역은 키보드로 스크롤·읽기 가능해야 한다(APG scrollable region).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        {messages.map((m) => (
          <div key={m.id} className={`sl-msg sl-${m.role}`} data-role={m.role}>
            {m.text}
          </div>
        ))}

        {/* 진행 중 버퍼 — aria-busy 로 표시하되 낭독에서 제외(aria-hidden). */}
        {streaming && draft && (
          <div className="sl-msg sl-assistant sl-draft" aria-busy="true" aria-hidden="true" data-draft="true">
            {draft}
            <span className="sl-caret" aria-hidden="true" />
          </div>
        )}
      </div>

      {/* 진행/완료/에러 — 별도 status 영역. 시각적으로 숨기고 스크린리더만 낭독(무음 실패 금지). */}
      <div className="sr-only" role="status" aria-live="polite">
        {statusText}
      </div>
    </div>
  );
}
