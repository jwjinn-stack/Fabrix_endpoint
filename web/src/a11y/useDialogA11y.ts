import { useEffect, useRef, type RefObject } from "react";

// useDialogA11y — APG Dialog(모달) 접근성 계약을 임의 컨테이너에 얹는 재사용 훅.
// (IMP-102, IMP-103 어시스트 패널이 소비할 기반 계약)
//
// IMP-12/31 은 네이티브 <dialog>.showModal() 이 무료로 주는 트랩·복원·Esc 를 썼다.
// 그 패턴은 그대로 유지하되, 여기서는 <dialog> 를 강제하지 않는 **순수 훅**으로 계약을 추출한다 —
// IMP-103 은 슬라이드 div[role=dialog] 에 얹을 수 있어야 하기 때문(complementary 승격 여지).
// 훅이 담당하는 것:
//   · 열릴 때 initialFocusRef(예: 입력창)로 초기 포커스 이동(APG: 다이얼로그 진입 포커스)
//   · Esc → onClose
//   · 포커스 트랩(Tab/Shift+Tab 순환) — 열린 동안만
//   · 닫힐 때 열기 직전 포커스였던 트리거로 복원(restoreFocus, 기본 true)
// role=dialog·aria-modal·aria-labelledby 는 호출부가 dialogRef 대상에 부여한다(마크업 계약).

// 컨테이너 안에서 포커스 가능한 요소들. disabled/hidden/tabindex=-1 은 제외.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    // display:none / visibility:hidden / hidden 속성인 요소는 제외(트랩 대상 아님).
    // offsetParent 는 jsdom 에서 항상 null 이라 신뢰 불가 → 활성 요소는 무조건 포함하고,
    // 나머지는 명시적 hidden 신호만 배제(getComputedStyle 은 jsdom 에서 기본값 반환).
    if (el === document.activeElement) return true;
    if (el.hasAttribute("hidden")) return false;
    const style = typeof window !== "undefined" ? window.getComputedStyle(el) : null;
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    return true;
  });
}

export function useDialogA11y<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  initialFocusRef,
  restoreFocus = true,
}: {
  open: boolean;
  onClose: () => void;
  /** 열릴 때 첫 포커스를 받을 요소(입력창 등). 미지정 시 컨테이너 첫 포커서블. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** 닫힐 때 트리거로 포커스 복원(기본 true). */
  restoreFocus?: boolean;
}): { dialogRef: RefObject<T | null> } {
  const dialogRef = useRef<T | null>(null);
  // 열기 직전 포커스였던 요소(트리거) — 닫을 때 여기로 되돌린다.
  const triggerRef = useRef<HTMLElement | null>(null);

  // ── 초기 포커스 진입 + 닫힐 때 트리거 복원 ──────────────────────────────
  useEffect(() => {
    if (!open) return;
    // 열기 직전 활성 요소를 트리거로 기억(문서 body 로 튀는 경우는 복원 생략).
    const trigger = document.activeElement as HTMLElement | null;
    triggerRef.current = trigger && trigger !== document.body ? trigger : null;

    const dlg = dialogRef.current;
    // 지정된 초기 포커스 > 컨테이너 첫 포커서블 > 컨테이너 자신.
    const target =
      initialFocusRef?.current ??
      (dlg ? focusables(dlg)[0] : null) ??
      dlg ??
      null;
    // 마운트 직후 레이아웃이 잡히도록 microtask 뒤 포커스(IMP-75 팔레트와 동형).
    const id = window.setTimeout(() => target?.focus(), 0);

    return () => {
      window.clearTimeout(id);
      if (restoreFocus) triggerRef.current?.focus?.();
    };
  }, [open, initialFocusRef, restoreFocus]);

  // ── Esc 닫기 + 포커스 트랩(열린 동안만) ───────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dlg = dialogRef.current;
      if (!dlg) return;
      const items = focusables(dlg);
      if (items.length === 0) {
        // 포커서블이 없으면 컨테이너 밖으로 새어나가지 않게 컨테이너에 묶는다.
        e.preventDefault();
        dlg.focus?.();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeInside = dlg.contains(document.activeElement);
      if (e.shiftKey) {
        // 처음에서 Shift+Tab → 마지막으로 순환.
        if (document.activeElement === first || !activeInside) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // 마지막에서 Tab → 처음으로 순환.
        if (document.activeElement === last || !activeInside) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return { dialogRef };
}

export default useDialogA11y;
