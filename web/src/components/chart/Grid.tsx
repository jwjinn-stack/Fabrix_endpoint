import type { ReactNode } from "react";
import { AxisText } from "./Axis";
import { DEFAULT_GRID_RATIOS, GRID_STROKE } from "./theme";

// 가로 그리드선 + (옵션) 좌/우 y라벨(IMP-25).
// ratios: 0..1 정규화 비율(top→bottom). WCAG 권고로 최대 ~10선.
export function HGrid({
  ratios = DEFAULT_GRID_RATIOS,
  padLeft,
  right,
  top,
  innerH,
  leftLabel,
  rightLabel,
}: {
  ratios?: number[];
  padLeft: number;
  right: number; // 우측 끝 x 좌표(= viewW - PAD.right)
  top: number;
  innerH: number;
  leftLabel?: (ratio: number) => ReactNode; // ratio=0(top)..1(bottom)
  rightLabel?: (ratio: number) => ReactNode;
}) {
  const used = ratios.slice(0, 10);
  return (
    <>
      {used.map((g) => {
        const y = top + innerH * g;
        return (
          <g key={g}>
            <line x1={padLeft} y1={y} x2={right} y2={y} stroke={GRID_STROKE} strokeWidth={1} />
            {leftLabel && (
              <AxisText x={padLeft - 6} y={y + 3} anchor="end">
                {leftLabel(g)}
              </AxisText>
            )}
            {rightLabel && (
              <AxisText x={right + 6} y={y + 3} anchor="start">
                {rightLabel(g)}
              </AxisText>
            )}
          </g>
        );
      })}
    </>
  );
}
