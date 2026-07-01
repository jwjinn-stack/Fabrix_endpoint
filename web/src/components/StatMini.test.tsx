import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatMini from "./StatMini";

// IMP-44 — KPI stat-mini 통합: 인라인 델타·미니 스파크라인·임계 톤.
describe("StatMini (IMP-44 KPI 통합)", () => {
  it("라벨·값·단위를 렌더한다", () => {
    const { container } = render(<StatMini label="트레이스" value="120" unit="건" sub="표본" />);
    expect(screen.getByText("트레이스")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(container.querySelector(".sm-unit")?.textContent).toBe("건");
    expect(container.querySelector(".sm-sub")?.textContent).toBe("표본");
  });

  it("양의 델타 + good=up → good 배지(▲), aria-label 개선", () => {
    const { container } = render(<StatMini label="QPS" value="12" delta={8} deltaGood="up" />);
    const pill = container.querySelector(".sm-val .delta");
    expect(pill).not.toBeNull();
    expect(pill?.className).toContain("good");
    expect(pill?.textContent).toContain("▲");
    expect(pill?.getAttribute("aria-label")).toContain("개선");
  });

  it("good=down 인데 델타>0 → bad 배지(▲), aria-label 악화", () => {
    const { container } = render(<StatMini label="차단" value="3" delta={20} deltaGood="down" />);
    const pill = container.querySelector(".sm-val .delta");
    expect(pill?.className).toContain("bad");
    expect(pill?.textContent).toContain("▲");
    expect(pill?.getAttribute("aria-label")).toContain("악화");
  });

  it("델타 0 → flat 배지", () => {
    const { container } = render(<StatMini label="QPS" value="12" delta={0} />);
    expect(container.querySelector(".sm-val .delta")?.className).toContain("flat");
  });

  it("델타 미지정 → 배지 생략(우아한 생략)", () => {
    const { container } = render(<StatMini label="QPS" value="12" />);
    expect(container.querySelector(".sm-val .delta")).toBeNull();
  });

  it("spark(길이>=2) → 미니 스파크라인 렌더", () => {
    const { container } = render(<StatMini label="QPS" value="12" spark={[1, 2, 3, 4]} />);
    expect(container.querySelector(".sm-spark .sparkline")).not.toBeNull();
  });

  it("spark 미지정/길이<2 → 스파크라인 생략", () => {
    const { container: c1 } = render(<StatMini label="QPS" value="12" />);
    expect(c1.querySelector(".sm-spark")).toBeNull();
    const { container: c2 } = render(<StatMini label="QPS" value="12" spark={[5]} />);
    expect(c2.querySelector(".sm-spark")).toBeNull();
  });

  it("tone=red → tone-red 클래스(임계 색)", () => {
    const { container } = render(<StatMini label="차단" value="3" tone="red" />);
    expect(container.querySelector(".stat-mini")?.className).toContain("tone-red");
  });

  it("tone 미지정 → tone-* 클래스 없음", () => {
    const { container } = render(<StatMini label="QPS" value="12" />);
    expect(container.querySelector(".stat-mini")?.className).not.toContain("tone-");
  });
});
