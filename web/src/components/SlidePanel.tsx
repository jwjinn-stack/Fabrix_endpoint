import { useEffect, useId, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";

// 마스터-디테일 우측 슬라이드 패널 — 목록 행 클릭 → 페이지 이동 없이 상세.
// Datadog/Splunk/Langfuse 공통 동선(상용SW-화면UIUX-리서치 P4-0).
// 전 화면의 목록 드릴다운 상세는 이 패널로 통일한다(O-13: 중앙 DetailModal 폐기).
//
// IMP-31 — IMP-12 의 Modal.tsx 와 동일한 네이티브 <dialog>.showModal() 메커니즘을
// "우측 슬라이드" 변형으로 재사용. showModal 이 무료로 제공하는 것:
// 포커스 트랩 · 배경 inert · Escape(cancel) 닫기 · top-layer 승격 · 열 때 포커스 진입 · 닫을 때 트리거 복원.
// 손수 짠 포커스 트랩/overlay div/panelRef.focus() 는 제거. 슬라이드인은 dialog[open] transition, 배경은 ::backdrop.
export default function SlidePanel({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
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

  if (!open) return null; // 닫힘 시 언마운트 — 상세 내용/탭 상태 리셋 시맨틱 유지

  // 백드롭(::backdrop) 클릭만 닫는다 — 클릭 타겟이 dialog 자신이면 배경.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === ref.current) onClose();
  };

  return (
    <dialog
      ref={ref}
      className="slide-panel"
      style={{ width }}
      onClick={onBackdrop}
      aria-labelledby={titleId}
      aria-label={typeof title === "string" ? title : "상세"}
    >
      <header className="slide-head">
        <div className="slide-title">
          <h3 id={titleId}>{title}</h3>
          {subtitle && <div className="slide-sub">{subtitle}</div>}
        </div>
        <button type="button" className="slide-close" onClick={onClose} aria-label="상세 패널 닫기">
          ✕
        </button>
      </header>
      <div className="slide-body">{children}</div>
      {footer && <footer className="slide-foot">{footer}</footer>}
    </dialog>
  );
}

// 상세 패널 안에서 쓰는 라벨-값 행.
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{children}</span>
    </div>
  );
}
