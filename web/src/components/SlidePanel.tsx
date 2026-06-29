import { useEffect } from "react";
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
  useEffect(() => {
    if (!open) return;
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
        className="slide-panel"
        style={{ width }}
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
