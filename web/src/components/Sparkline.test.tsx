import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Sparkline from "./Sparkline";

// IMP-54 — 스파크라인 임계 라인(warn/crit 수평 파선) 하위호환.
describe("Sparkline (IMP-54 임계 라인)", () => {
  it("길이<2 → 렌더 안 함", () => {
    const { container } = render(<Sparkline values={[1]} />);
    expect(container.querySelector(".sparkline")).toBeNull();
  });

  it("임계값 미지정 → 임계 라인 없음(하위호환)", () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} />);
    expect(container.querySelector(".sparkline")).not.toBeNull();
    expect(container.querySelector(".spark-threshold")).toBeNull();
  });

  it("warnValue+critValue 지정 → 임계 파선 2개 렌더", () => {
    const { container } = render(<Sparkline values={[1, 2, 3, 4]} warnValue={2.5} critValue={3.5} />);
    expect(container.querySelector(".spark-threshold-warn")).not.toBeNull();
    expect(container.querySelector(".spark-threshold-crit")).not.toBeNull();
    expect(container.querySelectorAll(".spark-threshold").length).toBe(2);
  });

  it("warnValue 만 지정 → warn 라인만", () => {
    const { container } = render(<Sparkline values={[1, 2, 3, 4]} warnValue={2.5} />);
    expect(container.querySelector(".spark-threshold-warn")).not.toBeNull();
    expect(container.querySelector(".spark-threshold-crit")).toBeNull();
  });

  it("임계선은 색 토큰(--amber/--red) 사용 — 하드코딩 색 금지", () => {
    const { container } = render(<Sparkline values={[1, 2, 3, 4]} warnValue={2} critValue={3} />);
    expect(container.querySelector(".spark-threshold-warn")?.getAttribute("stroke")).toBe("var(--amber)");
    expect(container.querySelector(".spark-threshold-crit")?.getAttribute("stroke")).toBe("var(--red)");
  });

  it("범위 밖 임계값은 clamp(가장자리)되어 항상 보임", () => {
    // 값 범위 1..4, critValue=100(범위 위) → y 는 pad(상단)로 clamp.
    const { container } = render(<Sparkline values={[1, 2, 3, 4]} critValue={100} height={30} />);
    const line = container.querySelector(".spark-threshold-crit");
    const y = Number(line?.getAttribute("y1"));
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(30);
  });
});
