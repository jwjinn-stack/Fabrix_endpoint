import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

// 마스터-디테일 우측 슬라이드 패널 — 목록 행 클릭 → 페이지 이동 없이 상세.
// Datadog/Splunk/Langfuse 공통 동선(상용SW-화면UIUX-리서치 P4-0).
// 전 화면의 목록 드릴다운 상세는 이 패널로 통일한다(O-13: 중앙 DetailModal 폐기).
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
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    // 열릴 때 패널로 첫 포커스 이동 — 키보드/스크린리더가 상세 내용으로 진입.
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="slide-overlay" onClick={onClose} role="presentation">
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="slide-panel"
        style={{ width, outline: "none" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "상세"}
      >
        <header className="slide-head">
          <div className="slide-title">
            <h3>{title}</h3>
            {subtitle && <div className="slide-sub">{subtitle}</div>}
          </div>
          <button type="button" className="slide-close" onClick={onClose} aria-label="상세 패널 닫기">
            ✕
          </button>
        </header>
        <div className="slide-body">{children}</div>
        {footer && <footer className="slide-foot">{footer}</footer>}
      </aside>
    </div>
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
