import { useCallback, useState } from "react";

// 테이블 행 밀도 — 압축/보통/여유(40/48/56px 리듬). 사용자 선택을 localStorage 에 영속.
// 대량 행 스캔(엔드포인트·키 등) 시 사용자가 정보 밀도를 직접 조절.
export type Density = "compact" | "regular" | "relaxed";
const LABEL: Record<Density, string> = { compact: "압축", regular: "보통", relaxed: "여유" };
const ORDER: Density[] = ["compact", "regular", "relaxed"];

export function useTableDensity(storeKey: string, initial: Density = "regular") {
  const key = `fabrix.density.${storeKey}`;
  const [density, setDensityState] = useState<Density>(() => {
    try {
      const v = localStorage.getItem(key) as Density | null;
      if (v && ORDER.includes(v)) return v;
    } catch { /* ignore */ }
    return initial;
  });
  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try { localStorage.setItem(key, d); } catch { /* ignore */ }
  }, [key]);
  return { density, setDensity };
}

// 밀도 선택 세그먼트 — page-head 우측에 배치.
export function DensityToggle({ density, onChange }: { density: Density; onChange: (d: Density) => void }) {
  return (
    <div className="density-toggle" role="group" aria-label="행 밀도">
      {ORDER.map((d) => (
        <button
          key={d}
          type="button"
          className={density === d ? "active" : ""}
          aria-pressed={density === d}
          title={`행 밀도: ${LABEL[d]}`}
          onClick={() => onChange(d)}
        >
          {LABEL[d]}
        </button>
      ))}
    </div>
  );
}
