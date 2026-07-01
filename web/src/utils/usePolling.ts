import { useCallback, useEffect, useRef, useState } from "react";
import { humanizeError } from "./errors";

// usePolling(IMP-51) — 실시간 인프라 화면 3종(토폴로지·노드·네트워크)의 폴링 관례를 통일한다.
// - REFRESH_MS 간격 폴링(intervalMs 주입, Gpu.tsx 관례)
// - 일시정지/재개(paused) — 온콜 조사 중 프리즈. 재개 시 즉시 1회 로드.
// - 에러 시 마지막 성공 데이터 유지(data 를 비우지 않음) + isStale 플래그(스테일 배지용)
// - AbortController 로 in-flight 취소(IMP-16 정합), humanizeError 로 사용자向 메시지(IMP-26)
// reduce-motion 은 CSS(@media prefers-reduced-motion)가 이미 가드하므로 훅은 데이터만 다룬다.
export interface PollingState<T> {
  data: T | null;
  error: string | null;
  loading: boolean; // 최초 로드 중(아직 data 없음)
  lastLoaded: number | null;
  paused: boolean;
  isStale: boolean; // error 이면서 직전 성공 data 를 보유 → 마지막 데이터 표시 중
  reload: () => void;
  setPaused: (p: boolean) => void;
}

export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: { intervalMs: number; deps?: unknown[]; enabled?: boolean },
): PollingState<T> {
  const { intervalMs } = opts;
  const deps = opts.deps ?? [];
  // enabled=false 면 폴링(interval)만 끈다(초기·deps 로드·reload·정지/재개 로직은 유지).
  // 드로어 '열릴 때만'(IMP-77 ObjectView) · intervalMs=0 정적 사용(KineticStrip)을 규약 안에서 처리.
  const enabled = opts.enabled ?? true;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  // 최신 fetcher 를 ref 로 잡아, deps 변화가 아니면 interval 을 재설치하지 않는다.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // 성공 데이터 보유 여부(에러 시 stale 판정용). setData 와 동기 갱신.
  const hasDataRef = useRef(false);

  const runningRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    runningRef.current?.abort();
    const ctrl = new AbortController();
    runningRef.current = ctrl;
    try {
      const r = await fetcherRef.current(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setData(r);
      hasDataRef.current = true;
      setLastLoaded(Date.now());
      setError(null);
    } catch (e) {
      const err = e as Error;
      if (err?.name === "AbortError" || ctrl.signal.aborted) return;
      // 에러가 나도 data 는 그대로 둔다(마지막 성공 데이터 유지) — isStale 로 표시.
      setError(humanizeError(err?.message ?? "요청 실패"));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  // 최초 마운트 + deps 변화 시 즉시 로드(재요청 컨텍스트 갱신).
  useEffect(() => {
    setLoading(true);
    load();
    return () => runningRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  // 폴링 interval — paused 이거나 enabled=false 면 걸지 않는다. 재개(false 로 전환) 시 즉시 1회 따라잡기 로드.
  const wasPaused = useRef(paused);
  useEffect(() => {
    if (paused || !enabled) {
      wasPaused.current = paused;
      return;
    }
    if (wasPaused.current) {
      wasPaused.current = false;
      load(); // 정지 중 놓친 갱신 따라잡기
    }
    const id = setInterval(() => load(), intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, intervalMs, paused, enabled, ...deps]);

  const isStale = error != null && hasDataRef.current;

  return { data, error, loading, lastLoaded, paused, isStale, reload: load, setPaused };
}
