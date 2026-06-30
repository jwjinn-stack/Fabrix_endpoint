import { type ReactNode, useEffect, useId, useRef, useState } from "react";

// InfoTip — 접근 가능한 toggletip. 클릭/Enter/Space 로 열고 Esc·바깥 클릭으로 닫는다.
// 네이티브 title 툴팁의 키보드/터치 미접근(WCAG 1.4.13) 문제를 대체(무의존 in-house).
export default function InfoTip({ label = "설명 보기", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <span className="infotip" ref={ref}>
      <button
        type="button"
        className="infotip-trigger"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        ⓘ
      </button>
      {/* role=status 라이브 영역을 항상 DOM 에 두고 열릴 때 내용을 채워, 스크린리더가 클릭 시 실제로
          announce 하게 한다(Inclusive Components toggletip 패턴). 닫히면 비어 보이지 않는다. */}
      <span role="status" id={id} className="infotip-live">
        {open && <span className="infotip-bubble">{children}</span>}
      </span>
    </span>
  );
}
