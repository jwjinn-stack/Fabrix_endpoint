import type { ReactNode } from "react";

export interface DetailField {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

// 모든 테이블 화면 공통 — 행 클릭 시 상세 모달. (가시성·일관 UX)
export default function DetailModal({
  title,
  fields,
  note,
  children,
  onClose,
}: {
  title: string;
  fields: DetailField[];
  note?: string;
  children?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        <dl className="detail-grid">
          {fields.map((f) => (
            <div key={f.label} className="detail-pair">
              <dt>{f.label}</dt>
              <dd className={f.mono ? "mono" : undefined}>{f.value}</dd>
            </div>
          ))}
        </dl>
        {children}
        {note && <div className="modal-note">{note}</div>}
      </div>
    </div>
  );
}
