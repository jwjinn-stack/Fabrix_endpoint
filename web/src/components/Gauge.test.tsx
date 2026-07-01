import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Gauge from "./Gauge";

// IMP-54 — 임계밴드 선형 게이지: 값→상태 색/폭·임계 밴드·눈금·색+텍스트 병기.
describe("Gauge (IMP-54 임계밴드 게이지)", () => {
  const base = { warn: 0.75, crit: 0.9, max: 1, label: "이용률" };

  it("value<warn → fill 색 = var(--primary), aria 상태 정상", () => {
    const { container } = render(<Gauge {...base} value={0.5} valueText="50%" />);
    const fill = container.querySelector(".gauge-fill");
    expect(fill?.getAttribute("fill")).toBe("var(--primary)");
    expect(container.querySelector(".gauge")?.getAttribute("aria-label")).toContain("정상");
  });

  it("warn<=value<crit → fill 색 = var(--amber), aria 주의", () => {
    const { container } = render(<Gauge {...base} value={0.8} valueText="80%" />);
    expect(container.querySelector(".gauge-fill")?.getAttribute("fill")).toBe("var(--amber)");
    expect(container.querySelector(".gauge")?.getAttribute("aria-label")).toContain("주의");
  });

  it("value>=crit → fill 색 = var(--red), aria 위험", () => {
    const { container } = render(<Gauge {...base} value={0.95} valueText="95%" />);
    expect(container.querySelector(".gauge-fill")?.getAttribute("fill")).toBe("var(--red)");
    expect(container.querySelector(".gauge")?.getAttribute("aria-label")).toContain("위험");
  });

  it("채움 폭이 value/max 비례 — 작은 값 < 큰 값의 폭", () => {
    const { container: c1 } = render(<Gauge {...base} value={0.3} valueText="30%" width={100} />);
    const { container: c2 } = render(<Gauge {...base} value={0.6} valueText="60%" width={100} />);
    const w1 = Number(c1.querySelector(".gauge-fill")?.getAttribute("width"));
    const w2 = Number(c2.querySelector(".gauge-fill")?.getAttribute("width"));
    expect(w1).toBeLessThan(w2);
    // value/max=0.3 → width 100 기준 30 근처
    expect(w1).toBeCloseTo(30, 0);
  });

  it("higher-is-worse → warn/crit 눈금 세로선 2개 렌더", () => {
    const { container } = render(<Gauge {...base} value={0.5} valueText="50%" />);
    expect(container.querySelector(".gauge-tick-warn")).not.toBeNull();
    expect(container.querySelector(".gauge-tick-crit")).not.toBeNull();
  });

  it("aria-label 에 라벨·값 병기(색-only 금지 — 텍스트 대체)", () => {
    const { container } = render(<Gauge {...base} value={0.95} valueText="95%" label="Load 1m" />);
    const aria = container.querySelector(".gauge")?.getAttribute("aria-label") ?? "";
    expect(aria).toContain("Load 1m");
    expect(aria).toContain("95%");
  });

  it("max 미지정 → crit*1.15 자동(위험 임계가 트랙 우측 근처)", () => {
    const { container } = render(<Gauge warn={12} crit={16} value={16} valueText="16.0" label="Load" width={100} />);
    // value=crit=16, max=16*1.15=18.4 → fill ~ 16/18.4*100 ≈ 87
    const w = Number(container.querySelector(".gauge-fill")?.getAttribute("width"));
    expect(w).toBeGreaterThan(80);
    expect(w).toBeLessThan(100);
  });
});
