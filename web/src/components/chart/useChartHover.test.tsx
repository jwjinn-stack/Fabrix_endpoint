import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useChartHover } from "./useChartHover";

// viewBox 폭 1000, padLeft 40, innerW 920(= 1000 - 40 - 40 우측). count=11 → 인덱스 0..10.
const VIEW_W = 1000;
const PAD_LEFT = 40;
const INNER_W = 920;
const COUNT = 11;

// SVG 가 화면에서 width=460px(viewBox 1000의 절반 스케일), left=100 로 렌더된다고 가정.
const RECT = { left: 100, width: 460, top: 0, right: 560, bottom: 100, height: 100, x: 100, y: 0, toJSON: () => {} };

function setup() {
  return renderHook(() => {
    const ref = useRef<SVGSVGElement | null>(null);
    // jsdom 은 레이아웃이 없으므로 ref.current 를 mock element 로 채운다.
    if (!ref.current) {
      ref.current = { getBoundingClientRect: () => RECT as DOMRect } as unknown as SVGSVGElement;
    }
    return useChartHover({ svgRef: ref, count: COUNT, viewW: VIEW_W, padLeft: PAD_LEFT, innerW: INNER_W });
  });
}

// clientX 헬퍼: 데이터 인덱스 i 의 정확한 중심에 해당하는 화면 clientX 를 역산.
function clientXForIndex(i: number): number {
  const px = PAD_LEFT + (INNER_W * i) / (COUNT - 1); // viewBox px
  const frac = px / VIEW_W;
  return RECT.left + frac * RECT.width;
}

describe("useChartHover", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.restoreAllMocks());

  it("indexFromClientX 가 좌/중/우 경계에서 최근접 인덱스를 산출", () => {
    const { result } = setup();
    expect(result.current.indexFromClientX(clientXForIndex(0))).toBe(0);
    expect(result.current.indexFromClientX(clientXForIndex(5))).toBe(5);
    expect(result.current.indexFromClientX(clientXForIndex(10))).toBe(10);
    // 범위 밖은 클램프.
    expect(result.current.indexFromClientX(RECT.left - 999)).toBe(0);
    expect(result.current.indexFromClientX(RECT.left + 99999)).toBe(10);
  });

  it("onMouseMove 가 hoverIndex 를 갱신하고 onMouseLeave 가 null 로 되돌린다", () => {
    const { result } = setup();
    act(() => result.current.onMouseMove({ clientX: clientXForIndex(3) } as React.MouseEvent));
    expect(result.current.hoverIndex).toBe(3);
    expect(result.current.activeIndex).toBe(3);
    act(() => result.current.onMouseLeave());
    expect(result.current.hoverIndex).toBeNull();
  });

  it("moveBy 가 focusIndex 를 [0,count-1] 로 클램프하며 이동", () => {
    const { result } = setup();
    // 시작값은 마지막 포인트(count-1=10).
    act(() => result.current.moveBy(1));
    expect(result.current.focusIndex).toBe(10); // 이미 끝 → 클램프 유지
    act(() => result.current.moveBy(-1));
    expect(result.current.focusIndex).toBe(9);
    act(() => result.current.moveBy(-100));
    expect(result.current.focusIndex).toBe(0); // 하한 클램프
  });
});
