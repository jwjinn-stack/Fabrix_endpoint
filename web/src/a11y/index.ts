// IMP-102 — 어시스트 접근성 계약 재사용 primitive 배럴.
// IMP-103 전역 Assist 패널이 이 조각들을 mount 한다:
//   · useDialogA11y      — role=dialog 초기포커스/Esc/트랩/트리거 복원(APG Dialog)
//   · useStreamingLog    — 스트리밍 상태기(완료 낭독 + role=status 진행, 증분 aria-live 금지)
//   · StreamingLog       — 위 계약의 표현 컴포넌트(role=log + aria-busy draft + role=status)
//   · useGlobalShortcutGuard — ⌘/ chord primary, input/IME 가드, 끄기(WCAG 2.1.4)
export { useDialogA11y, default as useDialogA11yDefault } from "./useDialogA11y";
export { useStreamingLog, shouldFollowScroll, STATUS_TEXT } from "./useStreamingLog";
export type { StreamPhase, LogMessage, StreamingLogApi } from "./useStreamingLog";
export { default as StreamingLog } from "./StreamingLog";
export { useGlobalShortcutGuard } from "./useGlobalShortcutGuard";
