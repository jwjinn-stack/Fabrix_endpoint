import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

// 고위험·비가역 액션 확인 다이얼로그 — 삭제/회수/권한 상향 등에 공통 사용.
// 금융 엔터프라이즈 안전 요건: 비가역 작업에 명시적 마찰(확인 단계)을 둔다.
// 접근성: Esc 닫기, 열릴 때 취소 버튼에 첫 포커스(파괴적 기본값 회피).
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  danger = false,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 파괴적 액션이면 확인 버튼을 위험 톤(빨강)으로 */
  danger?: boolean;
  busy?: boolean;
  /** type-to-confirm 등 추가 조건이 미충족이면 확인 버튼 비활성(IMP-65, 가산 옵션) */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div
        className="modal"
        style={{ width: "min(420px, 92vw)" }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3>{title}</h3>
        <div className="confirm-message">{message}</div>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" ref={cancelRef} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? "처리 중…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
