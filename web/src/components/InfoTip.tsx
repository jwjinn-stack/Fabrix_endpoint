import { type ReactNode, useEffect, useId, useRef, useState } from "react";

// InfoTip — 접근 가능한 tooltip/toggletip. WCAG 1.4.13(Content on Hover or Focus) + 2.1.1(키보드):
//  - 트리거: click 토글(pinned) + hover(mouseenter) + focus 로 모두 열린다(키보드·마우스·터치 전부 접근).
//  - dismissible: Esc·바깥 클릭으로 닫힌다.
//  - hoverable: 버블 위로 마우스를 옮겨도 유지된다(컨테이너가 트리거+버블을 함께 감쌈).
//  - persistent: 타이머 자동소멸 없음 — 사용자가 닫을 때까지 유지.
// 네이티브 title 툴팁의 키보드/터치 미접근(WCAG 1.4.13) 문제를 대체(무의존 in-house). IMP-4 패턴.
//
// pinned(클릭/포커스로 고정) 와 hovering(마우스 오버)을 분리해, 클릭과 hover 가 서로를 상쇄하지 않게 한다.
export default function InfoTip({ label = "설명 보기", children }: { label?: string; children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const open = pinned || hovering;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPinned(false); setHovering(false); }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setPinned(false); setHovering(false); }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <span
      className="infotip"
      ref={ref}
      // hover 트리거(WCAG 1.4.13): 컨테이너(트리거+버블) 진입 시 열고, 벗어나면 hover 만 해제(pinned 유지 → hoverable/persistent).
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        type="button"
        className="infotip-trigger"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setPinned((p) => !p)}
        // focus 트리거(WCAG 2.1.1 키보드): 포커스 시 고정, 컨테이너 밖으로 나가는 blur 에만 해제.
        onFocus={() => setPinned(true)}
        onBlur={(e) => {
          if (ref.current && e.relatedTarget && ref.current.contains(e.relatedTarget as Node)) return;
          setPinned(false);
        }}
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
