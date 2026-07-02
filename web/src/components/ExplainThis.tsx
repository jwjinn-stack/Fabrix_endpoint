import { type ReactNode, useCallback, useRef, useState } from "react";
import { openExplain, type AssistPrefill } from "./assistBus";

// IMP-104 — explain-this-selection(콕 집어 물어보기, 키보드 우선).
//
// data-explain-key 어포던스의 재사용 래퍼/훅. 배지·메트릭 라벨·위젯 영역을 감싸면 그 요소가:
//   · focusable(tabindex=0) 이 되고 role=button + aria-label 을 갖는다(키보드 도달 — APG).
//   · hover/focus 시 작은 ⓘ 어포던스를 노출한다(자동 발화 아님 — WCAG 2.2 3.2.6 Consistent Help).
//   · Enter/Space/context-menu 키·우클릭·롱프레스로 전역 AssistPanel(IMP-103)을 프리필로 연다
//     (텍스트 선택 불필요 — PRIMARY 키보드 경로).
//   · 읽기 전용: openExplain 은 "설명 요청"만 나른다 — 어떤 mutation 도 없다.
//
// 선택 팝오버(ExplainSelectionPopover)는 마우스 편의 SECONDARY 층 — 이 키보드 경로가 항상 우선/존재한다.

const LONG_PRESS_MS = 500;

// useExplain — 어포던스를 붙일 요소에 spread 할 props + ⓘ 노출 상태를 돌려주는 훅.
// 커스텀 마크업(예: 배지 span)에 직접 배선하고 싶을 때 사용.
export function useExplain({ explainKey, label, widgetId }: AssistPrefill) {
  const [hot, setHot] = useState(false); // hover/focus — ⓘ 노출 트리거(자동 발화 아님)
  const pressTimer = useRef<number | null>(null);

  const fire = useCallback(() => {
    // 선언된 프리필만 전달(환각 금지) — label 은 표시 텍스트로만 쓰이고 정의에 보간되지 않는다.
    openExplain({ explainKey, label, widgetId });
  }, [explainKey, label, widgetId]);

  const clearPress = useCallback(() => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const handlers = {
    tabIndex: 0,
    role: "button" as const,
    "aria-label": `${label ?? explainKey ?? "이 항목"} 설명 보기`,
    "data-explain-key": explainKey ?? "",
    onMouseEnter: () => setHot(true),
    onMouseLeave: () => setHot(false),
    onFocus: () => setHot(true),
    onBlur: () => setHot(false),
    onKeyDown: (e: React.KeyboardEvent) => {
      // Enter/Space(활성화) + ContextMenu 키(⇧F10 등) → 프리필 오픈.
      if (e.key === "Enter" || e.key === " " || e.key === "ContextMenu") {
        e.preventDefault();
        fire();
      }
    },
    onClick: () => fire(),
    onContextMenu: (e: React.MouseEvent) => {
      // 우클릭 → 기본 컨텍스트 메뉴 대신 설명 오픈(마우스 편의 — 키보드 경로와 동등).
      e.preventDefault();
      fire();
    },
    // 롱프레스(터치 편의) — 500ms 유지 시 오픈, 이동/떼기/취소로 무효화.
    onTouchStart: () => {
      clearPress();
      pressTimer.current = window.setTimeout(() => {
        fire();
      }, LONG_PRESS_MS);
    },
    onTouchEnd: clearPress,
    onTouchMove: clearPress,
    onTouchCancel: clearPress,
  };

  return { handlers, hot };
}

// <ExplainThis> — children 을 감싸 위 어포던스를 부착하는 선언적 래퍼.
// as 로 태그를 지정(기본 span). 인라인이면 span, 블록이면 div 등.
export default function ExplainThis({
  explainKey,
  label,
  widgetId,
  className,
  children,
}: AssistPrefill & { className?: string; children: ReactNode }) {
  const { handlers, hot } = useExplain({ explainKey, label, widgetId });
  return (
    <span className={`explain-this${hot ? " hot" : ""}${className ? ` ${className}` : ""}`} {...handlers}>
      {children}
      {/* ⓘ 어포던스 — hover/focus 시 노출(자동 발화 아님). aria-hidden: 라벨은 컨테이너 aria-label 이 담당. */}
      <span className="explain-this-aff" aria-hidden="true">
        ⓘ
      </span>
    </span>
  );
}
