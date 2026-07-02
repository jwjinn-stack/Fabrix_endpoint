import { useCallback, useEffect, useState } from "react";
import { openExplain } from "./assistBus";

// IMP-104 — 텍스트 선택 설명 팝오버(SECONDARY, 마우스 편의 전용).
//
// 사용자가 텍스트를 드래그로 선택하면 선택 rect 근처에 floating 'ⓘ 설명' 버튼을 띄운다.
// 클릭 시 선택 텍스트를 label 로 전역 AssistPanel(IMP-103) 프리필 오픈.
//
// **키보드 함정 아님**: 이 경로는 마우스 편의 ADDITIVE 층이며 유일 경로가 아니다 —
//   data-explain-key(ExplainThis) 어포던스가 항상 키보드 PRIMARY 경로를 제공한다(선택 불필요).
//   버튼 자체는 aria-label 을 가진 실제 <button> 이라 포커스/Enter 가능하나, "선택해야만" 나타나는
//   특성 때문에 SECONDARY 로 둔다(선택 팝오버-only UI 는 알려진 a11y 함정).
//
// 읽기 전용: openExplain 만 호출(mutation 없음). 선택 텍스트는 label 문자열로만 전달(HTML 보간 없음).

// 너무 긴 선택은 라벨로 부적합 — 앞부분만 프리필(정의 조회는 완전일치라 어차피 폴백; 정보폭탄 방지).
const MAX_LABEL = 60;

interface Pos {
  x: number;
  y: number;
  text: string;
}

export default function ExplainSelectionPopover() {
  const [pos, setPos] = useState<Pos | null>(null);

  const hide = useCallback(() => setPos(null), []);

  useEffect(() => {
    // 선택 확정(mouseup) 시점에만 계산 — 드래그 중 깜빡임 방지.
    const onMouseUp = () => {
      const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
      const text = sel?.toString().trim() ?? "";
      // 선택이 없거나 공백뿐이면 팝오버를 숨긴다.
      if (!text || !sel || sel.rangeCount === 0) {
        setPos(null);
        return;
      }
      let rect: DOMRect | null = null;
      try {
        rect = sel.getRangeAt(0).getBoundingClientRect();
      } catch {
        rect = null;
      }
      // jsdom 등에서 rect 가 0 이어도 최소한 표시(테스트 결정성) — 좌표는 방어적으로 0 기본.
      setPos({
        x: rect ? rect.left + rect.width / 2 : 0,
        y: rect ? rect.top : 0,
        text: text.slice(0, MAX_LABEL),
      });
    };
    // 선택이 사라지면(빈 selection) 팝오버 숨김.
    const onSelectionChange = () => {
      const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
      if (!sel || !sel.toString().trim()) setPos(null);
    };
    // Esc 로 즉시 닫기(a11y — dismissible).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!pos) return null;

  return (
    <button
      type="button"
      className="explain-selection-pop"
      // 선택 rect 위쪽에 고정(viewport 기준). 좌표가 음수여도 clamp.
      style={{ left: Math.max(8, pos.x), top: Math.max(8, pos.y - 40) }}
      aria-label={`선택한 “${pos.text}” 설명 보기`}
      onMouseDown={(e) => e.preventDefault()} // 선택 유지(버튼 클릭이 선택을 지우지 않게)
      onClick={() => {
        openExplain({ label: pos.text });
        hide();
      }}
    >
      <span aria-hidden="true">ⓘ</span> 설명
    </button>
  );
}
