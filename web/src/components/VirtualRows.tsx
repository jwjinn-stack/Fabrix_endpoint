import { useRowWindow } from "../hooks/useRowWindow";

// IMP-30 — <tbody> 안에서 쓰는 행 windowing 래퍼(무의존, 행수 게이트).
//
// 게이트 OFF(items.length ≤ threshold): 전체 행을 그대로 렌더 → 기존 동작·오버헤드 0.
// 게이트 ON(items.length > threshold): 위 스페이서 <tr> + 보이는 행 + 아래 스페이서 <tr> 만 렌더.
// 스페이서는 aria-hidden + 단일 <td colSpan> 의 height 로 표현해 <table>/<tbody> 시맨틱·셀 정렬을
// 깨지 않는다. 정렬·필터·내보내기(Export)는 부모가 전체 items 로 계속 처리한다 — 여긴 렌더만.

export interface VirtualRowsProps<T> {
  items: T[]; // 전체 결과 배열(정렬·필터 끝난 뒤)
  rowHeight?: number; // 고정 행 높이(px)
  overscan?: number;
  threshold?: number; // 게이트
  colSpan: number; // 스페이서 <td colSpan>
  scrollRef: React.RefObject<HTMLElement | null>; // 세로 스크롤 컨테이너
  children: (item: T, index: number) => React.ReactNode; // 행 렌더(기존 <tr>)
  /** 테스트 주입용: 측정 대신 강제 값(jsdom 에 실제 레이아웃 없음) */
  viewportOverride?: { scrollTop: number; clientHeight: number };
}

export default function VirtualRows<T>({
  items,
  rowHeight,
  overscan,
  threshold,
  colSpan,
  scrollRef,
  children,
  viewportOverride,
}: VirtualRowsProps<T>) {
  const win = useRowWindow(scrollRef, items.length, { rowHeight, overscan, threshold, viewportOverride });

  if (!win.windowed) {
    return <>{items.map((item, i) => children(item, i))}</>;
  }

  const visible = items.slice(win.start, win.end);
  return (
    <>
      {win.topPad > 0 && (
        <tr aria-hidden="true" className="vrow-spacer">
          <td colSpan={colSpan} style={{ height: win.topPad, padding: 0, border: "none" }} />
        </tr>
      )}
      {visible.map((item, i) => children(item, win.start + i))}
      {win.bottomPad > 0 && (
        <tr aria-hidden="true" className="vrow-spacer">
          <td colSpan={colSpan} style={{ height: win.bottomPad, padding: 0, border: "none" }} />
        </tr>
      )}
    </>
  );
}
