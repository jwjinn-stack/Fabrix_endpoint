import { type ReactNode, type MouseEvent, useEffect, useId, useRef } from "react";

// 접근 가능한 모달 프리미티브(IMP-12) — 네이티브 <dialog>.showModal() 기반.
// 손수 만든 .modal-overlay 8곳이 빠뜨린 것을 showModal 이 무료로 제공한다:
// aria-modal=true · 배경 inert · Escape 닫기 · top-layer 승격 · 열 때 포커스 진입 · 닫을 때 트리거로 포커스 복원.
// 수동 보강: aria-labelledby(헤더), 배경 스크롤 잠금, 백드롭 클릭 닫기.
export default function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** 너비 변형 등 추가 클래스(예: "modal-wide"). */
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open) {
      if (!dlg.open) dlg.showModal();
      document.body.style.overflow = "hidden"; // 배경 스크롤 잠금(StrictMode 재마운트에도 보장)
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Escape(네이티브 cancel) → onClose 로 동기화(상위 open 상태를 닫아 재오픈 가능하게).
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dlg.addEventListener("cancel", onCancel);
    return () => dlg.removeEventListener("cancel", onCancel);
  }, [onClose]);

  if (!open) return null; // 닫힘 시 언마운트 — 기존 폼 상태 리셋 시맨틱 유지

  // 백드롭(::backdrop) 클릭만 닫는다 — 클릭 타겟이 dialog 자신이면 배경.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === ref.current) onClose();
  };

  return (
    <dialog ref={ref} className={`modal${className ? ` ${className}` : ""}`} aria-labelledby={titleId} onClick={onBackdrop}>
      <div className="modal-head">
        <h3 id={titleId}>{title}</h3>
        <button type="button" className="icon" aria-label="닫기" onClick={onClose}>
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}
