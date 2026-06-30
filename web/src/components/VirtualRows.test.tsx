import { describe, it, expect } from "vitest";
import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import VirtualRows from "./VirtualRows";

// IMP-30 — 행 windowing(행수 게이트, 무의존) 단위 테스트.
// jsdom 은 실제 레이아웃이 없어 clientHeight/scrollTop 이 0 이므로, viewportOverride 로 주입한다.

interface Row {
  id: number;
}
const makeRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i }));

// VirtualRows 는 <tbody> 안에서만 유효 → 테스트용 테이블 래퍼.
function Harness({
  count,
  threshold,
  rowHeight = 40,
  overscan = 2,
  viewportOverride,
}: {
  count: number;
  threshold?: number;
  rowHeight?: number;
  overscan?: number;
  viewportOverride?: { scrollTop: number; clientHeight: number };
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref}>
      <table>
        <tbody>
          <VirtualRows
            items={makeRows(count)}
            colSpan={1}
            scrollRef={ref}
            threshold={threshold}
            rowHeight={rowHeight}
            overscan={overscan}
            viewportOverride={viewportOverride}
          >
            {(r) => (
              <tr key={r.id} data-testid="data-row" data-idx={r.id}>
                <td>{r.id}</td>
              </tr>
            )}
          </VirtualRows>
        </tbody>
      </table>
    </div>
  );
}

const renderedIdx = () =>
  screen.getAllByTestId("data-row").map((el) => Number(el.getAttribute("data-idx")));
const spacers = () => document.querySelectorAll(".vrow-spacer");

describe("VirtualRows — 행 windowing(행수 게이트, 무의존) (IMP-30)", () => {
  it("below-threshold: 임계 이하면 전체 행 렌더 + 스페이서 없음(게이트 OFF)", () => {
    render(<Harness count={50} threshold={150} />);
    expect(screen.getAllByTestId("data-row")).toHaveLength(50);
    expect(spacers()).toHaveLength(0);
  });

  it("above-threshold: 임계 초과면 보이는 부분집합만 렌더 + 스페이서 존재", () => {
    render(
      <Harness
        count={1000}
        threshold={150}
        rowHeight={40}
        overscan={2}
        viewportOverride={{ scrollTop: 0, clientHeight: 400 }}
      />,
    );
    const idx = renderedIdx();
    // 전량(1000)보다 훨씬 적게 렌더된다.
    expect(idx.length).toBeLessThan(50);
    expect(idx.length).toBeGreaterThan(0);
    expect(idx[0]).toBe(0);
    // scrollTop=0 이면 위 스페이서는 없고(아래만), 아래 스페이서는 있다.
    const sp = spacers();
    expect(sp.length).toBe(1);
  });

  it("scroll updates window: scrollTop 을 키우면 보이는 행 집합이 아래로 이동", () => {
    const { rerender } = render(
      <Harness count={1000} threshold={150} rowHeight={40} overscan={2} viewportOverride={{ scrollTop: 0, clientHeight: 400 }} />,
    );
    expect(renderedIdx()[0]).toBe(0);

    // scrollTop=4000px / rowHeight 40 → 첫 행 인덱스 ~100
    rerender(
      <Harness count={1000} threshold={150} rowHeight={40} overscan={2} viewportOverride={{ scrollTop: 4000, clientHeight: 400 }} />,
    );
    const idx = renderedIdx();
    expect(idx[0]).toBeGreaterThan(90);
    expect(idx[0]).toBeLessThan(101);
    // 위·아래 양쪽 스페이서 존재(중간을 보고 있으므로).
    expect(spacers().length).toBe(2);
  });

  it("sort/filter on full set: VirtualRows 는 items 를 변형하지 않는다(선택만)", () => {
    // 정렬된 입력을 그대로 넘기면 렌더 순서도 동일(인덱스 단조 증가).
    render(<Harness count={1000} threshold={150} rowHeight={40} overscan={2} viewportOverride={{ scrollTop: 0, clientHeight: 400 }} />);
    const idx = renderedIdx();
    const sorted = [...idx].sort((a, b) => a - b);
    expect(idx).toEqual(sorted);
  });

  it("a11y: 스페이서 행은 aria-hidden, 보이는 행은 정상 <tr>", () => {
    render(<Harness count={1000} threshold={150} rowHeight={40} overscan={2} viewportOverride={{ scrollTop: 4000, clientHeight: 400 }} />);
    spacers().forEach((sp) => {
      expect(sp.getAttribute("aria-hidden")).toBe("true");
      expect(sp.tagName).toBe("TR");
    });
    // 데이터 행은 aria-hidden 이 아니다.
    screen.getAllByTestId("data-row").forEach((r) => {
      expect(r.getAttribute("aria-hidden")).toBeNull();
    });
  });
});
