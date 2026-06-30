import type { ReactNode, HTMLAttributes } from "react";

// 의미론적 레이아웃 프리미티브 (IMP-19) — 일회성 인라인 style 을 토큰 기반
// 유틸 클래스로 수렴하기 위한 얇은 래퍼. 동작/시각 변화 없음(추가형).

// 가로 정렬 줄: flex + align-items:center + gap var(--sp-2) + wrap.
export function Row({
  className,
  children,
  ...rest
}: { className?: string; children?: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className ? `row ${className}` : "row"} {...rest}>
      {children}
    </div>
  );
}

// 보조 라벨 텍스트: .muted 톤 + 작은 라벨 타이포(var(--fs-xs)/var(--text-dim)).
export function Muted({
  className,
  children,
  ...rest
}: { className?: string; children?: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={className ? `muted u-label-xs ${className}` : "muted u-label-xs"} {...rest}>
      {children}
    </span>
  );
}
