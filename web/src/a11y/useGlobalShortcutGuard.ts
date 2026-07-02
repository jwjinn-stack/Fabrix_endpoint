import { useEffect } from "react";

// useGlobalShortcutGuard — WCAG 2.1.4 Character Key Shortcuts 준수 전역 단축키 훅.
// (IMP-102, IMP-103 어시스트 트리거 ⌘/ 가 소비)
//
// 오발화 방지 규약:
//   · activeElement 가 input/textarea/[contenteditable] 이면 무시(폼 타이핑을 깨지 않음).
//   · IME 조합 중(isComposing / keyCode 229)이면 무시(한글 입력 중 오발화 금지).
//   · 수식키 chord(⌘/ = meta|ctrl + '/')를 primary — 브라우저/한글IME 충돌 최소.
//   · 단독 문자 '?'는 secondary(allowBareChar 이고 입력 밖일 때만).
//   · enabled:false 로 완전히 끌 수 있음 — WCAG 2.1.4 의 "끄기/재매핑" 경로.

// 입력 컨텍스트(타이핑 중)인지 — 여기서는 단축키를 삼킨다.
function isEditingContext(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  // closest 로 contenteditable 래퍼 내부도 커버.
  return !!el.closest?.('[contenteditable="true"], [contenteditable=""]');
}

export function useGlobalShortcutGuard({
  onTrigger,
  enabled = true,
  allowBareChar = true,
}: {
  onTrigger: () => void;
  /** false 면 단축키 비활성(WCAG 2.1.4 끄기). */
  enabled?: boolean;
  /** 단독 '?'(수식키 없이)도 트리거로 허용(입력 밖에서만). 기본 true. */
  allowBareChar?: boolean;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // IME 조합 중이면 어떤 경우든 무시(오발화 금지).
      if (e.isComposing || e.keyCode === 229) return;

      // primary chord: ⌘/ 또는 Ctrl+/.
      const chord = (e.metaKey || e.ctrlKey) && e.key === "/";
      // secondary: 수식키 없는 단독 '?'(Shift+/의 결과 문자). meta/ctrl/alt 조합은 제외.
      const bare = allowBareChar && e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey;

      if (!chord && !bare) return;

      // 입력/편집 컨텍스트에서는 chord·bare 모두 무시 — 폼 타이핑을 깨지 않는다.
      if (isEditingContext(document.activeElement)) return;

      e.preventDefault();
      onTrigger();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTrigger, enabled, allowBareChar]);
}

export default useGlobalShortcutGuard;
