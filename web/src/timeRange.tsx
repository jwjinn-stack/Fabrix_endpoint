// 전역 시간범위 컨텍스트(G-05) — 시계열 화면(관제·사용량·트레이스·세션)이 같은 기간을
// 공유하도록 lift. 화면을 옮겨도 "최근 7일" 선택이 유지된다(쾌적한 탐색 동선).
// 라이브 윈도우(트래픽)·순간값(GPU) 화면은 이 셀렉터를 렌더하지 않는다 — 시간범위 개념이 없으므로.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TimeRange } from "./api/types";

export const RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "최근 1시간" },
  { value: "6h", label: "최근 6시간" },
  { value: "24h", label: "최근 24시간" },
  { value: "7d", label: "최근 7일" },
];

interface TimeRangeCtx {
  range: TimeRange;
  setRange: (r: TimeRange) => void;
}

const Ctx = createContext<TimeRangeCtx>({ range: "24h", setRange: () => {} });

export function useTimeRange(): TimeRangeCtx {
  return useContext(Ctx);
}

const STORE_KEY = "fabrix.timeRange";

export function TimeRangeProvider({ children }: { children: ReactNode }) {
  // 기본 24h — 열자마자 누적 데이터가 보이도록(idle 1h 는 0만 보임). 선택은 브라우저에 저장.
  const [range, setRange] = useState<TimeRange>(() => {
    try {
      const s = localStorage.getItem(STORE_KEY);
      if (s && RANGES.some((r) => r.value === s)) return s as TimeRange;
    } catch { /* ignore */ }
    return "24h";
  });
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, range); } catch { /* ignore */ }
  }, [range]);
  const value = useMemo(() => ({ range, setRange }), [range]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// 공용 기간 셀렉터 — 화면의 page-head 에 그대로 끼워 쓴다(기존 .range-select 스타일 재사용).
export function RangeSelect() {
  const { range, setRange } = useTimeRange();
  return (
    <select
      className="range-select"
      value={range}
      onChange={(e) => setRange(e.target.value as TimeRange)}
      aria-label="집계 기간 선택"
    >
      {RANGES.map((r) => (
        <option key={r.value} value={r.value}>
          기간: {r.label}
        </option>
      ))}
    </select>
  );
}
