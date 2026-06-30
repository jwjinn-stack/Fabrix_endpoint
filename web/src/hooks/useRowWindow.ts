import { useEffect, useLayoutEffect, useRef, useState } from "react";

// IMP-30 — 손수 만든 고정행높이 행 windowing 훅(무의존).
// 넓은 데이터 표(Traces·Sessions·Keys)가 수천 행을 통째 DOM 에 그리면 큰 DOM + 매 갱신 재조정으로
// 입력 지연·스크롤 버벅임이 난다. 이 훅은 스크롤 컨테이너에서 "지금 보이는 행"의 인덱스 범위와
// 위/아래 스페이서 높이만 계산한다(데이터는 건드리지 않는 렌더 관심사).
//
// 행수 게이트: total ≤ threshold 면 windowing=false(전량 렌더). windowing 자체에 per-render
// 오버헤드가 있어, 작은 표에선 끄는 게 빠르다.

export interface RowWindow {
  start: number; // 첫 가시 행 인덱스(overscan 포함)
  end: number; // 마지막+1 가시 행 인덱스(overscan 포함)
  topPad: number; // 위 스페이서 height(px)
  bottomPad: number; // 아래 스페이서 height(px)
  windowed: boolean; // 게이트 ON 여부(total > threshold)
}

export interface UseRowWindowOpts {
  rowHeight?: number; // 고정 행 높이(px)
  overscan?: number; // 위아래 여유 행
  threshold?: number; // 이 행 수 초과 시에만 windowing
  /** 테스트 주입용: 측정 대신 강제 값(jsdom 에 실제 레이아웃 없음) */
  viewportOverride?: { scrollTop: number; clientHeight: number };
}

const DEFAULT_ROW_HEIGHT = 36;
const DEFAULT_OVERSCAN = 8;
const DEFAULT_THRESHOLD = 150;
// 측정 전(레이아웃 0)일 때 쓰는 안전한 가시 영역 높이 — 빈칸 대신 넉넉히 그린다.
const FALLBACK_VIEWPORT = 720;

export function useRowWindow(
  scrollRef: React.RefObject<HTMLElement | null>,
  total: number,
  opts: UseRowWindowOpts = {},
): RowWindow {
  const rowHeight = opts.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const overscan = opts.overscan ?? DEFAULT_OVERSCAN;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const override = opts.viewportOverride;

  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(0);
  const rafRef = useRef<number | null>(null);

  const windowed = total > threshold;

  // 컨테이너 측정 + 스크롤 추적. 게이트 OFF 면 측정/리스너를 달지 않는다(오버헤드 0).
  useLayoutEffect(() => {
    if (!windowed || override) return;
    const el = scrollRef.current;
    if (!el) return;

    const measure = () => {
      setClientHeight(el.clientHeight);
      setScrollTop(el.scrollTop);
    };
    measure();

    const onScroll = () => {
      // rAF throttle — 스크롤마다 setState 폭주 방지.
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => setClientHeight(el.clientHeight));
      ro.observe(el);
    }

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scrollRef, windowed, override]);

  // override(테스트) 동기화 — 측정 대신 주입값을 state 로.
  useEffect(() => {
    if (override) {
      setScrollTop(override.scrollTop);
      setClientHeight(override.clientHeight);
    }
  }, [override?.scrollTop, override?.clientHeight, override]);

  if (!windowed) {
    return { start: 0, end: total, topPad: 0, bottomPad: 0, windowed: false };
  }

  const top = override ? override.scrollTop : scrollTop;
  const measuredH = override ? override.clientHeight : clientHeight;
  const viewportH = measuredH > 0 ? measuredH : FALLBACK_VIEWPORT;

  const visibleCount = Math.ceil(viewportH / rowHeight);
  const first = Math.floor(top / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + visibleCount + overscan);

  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: Math.max(0, (total - end) * rowHeight),
    windowed: true,
  };
}
