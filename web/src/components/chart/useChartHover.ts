import { useCallback, useState } from "react";
import type { RefObject } from "react";

// 차트 호버/포커스 훅 — 마우스 또는 키보드로 활성 데이터 인덱스를 추적(IMP-25).
// 좌표 변환은 viewBox 가 width=100% 로 늘어나는 SVG 를 가정:
//   clientX → (rect 내 비율) → viewBox px → 데이터 인덱스(최근접 반올림).
export function useChartHover({
  svgRef,
  count,
  viewW,
  padLeft,
  innerW,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  count: number;
  viewW: number; // viewBox 폭(예: 1000)
  padLeft: number;
  innerW: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const clamp = useCallback(
    (i: number) => Math.min(Math.max(i, 0), Math.max(count - 1, 0)),
    [count],
  );

  const indexFromClientX = useCallback(
    (clientX: number): number => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || count <= 1) return clamp(0);
      const frac = (clientX - rect.left) / rect.width; // 0..1 전체 svg 폭
      const px = frac * viewW;
      const i = Math.round(((px - padLeft) / innerW) * (count - 1));
      return clamp(i);
    },
    [svgRef, count, viewW, padLeft, innerW, clamp],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (count <= 0) return;
      setHoverIndex(indexFromClientX(e.clientX));
    },
    [count, indexFromClientX],
  );

  const onMouseLeave = useCallback(() => setHoverIndex(null), []);

  // 키보드 화살표용 — focusIndex 를 delta 만큼 이동(클램프). 시작값은 마지막 포인트.
  const moveBy = useCallback(
    (delta: number) => {
      if (count <= 0) return;
      setFocusIndex((prev) => {
        const base = prev ?? (hoverIndex ?? count - 1);
        return clamp(base + delta);
      });
    },
    [count, hoverIndex, clamp],
  );

  // hover 우선, 없으면 focus.
  const activeIndex = hoverIndex ?? focusIndex;

  return {
    hoverIndex,
    focusIndex,
    activeIndex,
    indexFromClientX,
    onMouseMove,
    onMouseLeave,
    setFocusIndex,
    moveBy,
  };
}
