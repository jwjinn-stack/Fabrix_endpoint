import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatCard from "./StatCard";
import type { Metric } from "./StatCard";

// IMP-27 — KPI 타입 위계: 델타 pill 분리 / 단위 디엠퍼사이즈 / 스파크 풀블리드 배경.
describe("StatCard (IMP-27 KPI 위계)", () => {
  it("값과 단위를 분리 렌더한다(unit span)", () => {
    const metrics: Metric[] = [{ label: "TTFT p95", value: "120", unit: "ms" }];
    const { container } = render(<StatCard title="응답 품질" metrics={metrics} />);
    expect(screen.getByText("120")).toBeInTheDocument();
    const unit = container.querySelector(".metric .num .unit");
    expect(unit?.textContent).toBe("ms");
  });

  it("양의 델타는 good pill(▲), aria-label 보존", () => {
    const metrics: Metric[] = [{ label: "QPS", value: "12.0", delta: 8, deltaGood: "up" }];
    const { container } = render(<StatCard title="트래픽" metrics={metrics} />);
    const pill = container.querySelector(".metric .num .delta");
    expect(pill).not.toBeNull();
    expect(pill?.className).toContain("good");
    expect(pill?.getAttribute("aria-label")).toContain("개선");
    expect(pill?.textContent).toContain("▲");
  });

  it("좋은방향=down 인데 값이 증가하면 bad pill(▲, 악화)", () => {
    // 차단·지연 등 낮을수록 좋은 지표: +20% 증가는 악화 → bad, 화살표는 부호 따라 ▲.
    const metrics: Metric[] = [{ label: "차단", value: "3", delta: 20, deltaGood: "down" }];
    const { container } = render(<StatCard title="가드레일" metrics={metrics} />);
    const pill = container.querySelector(".metric .num .delta");
    expect(pill?.className).toContain("bad");
    expect(pill?.textContent).toContain("▲");
    expect(pill?.getAttribute("aria-label")).toContain("악화");
  });

  it("delta 0 이면 flat pill", () => {
    const metrics: Metric[] = [{ label: "QPS", value: "12.0", delta: 0 }];
    const { container } = render(<StatCard title="트래픽" metrics={metrics} />);
    const pill = container.querySelector(".metric .num .delta");
    expect(pill?.className).toContain("flat");
  });

  it("spark 보유 메트릭은 has-spark + 풀블리드 배경 컨테이너로 렌더", () => {
    const metrics: Metric[] = [{ label: "QPS", value: "12.0", spark: [1, 2, 3, 4] }];
    const { container } = render(<StatCard title="트래픽" metrics={metrics} />);
    const metric = container.querySelector(".metric");
    expect(metric?.className).toContain("has-spark");
    expect(container.querySelector(".metric .metric-spark .sparkline")).not.toBeNull();
    // 본문은 별도 래퍼로 분리(스파크 위에 올라감)
    expect(container.querySelector(".metric .metric-body .num")).not.toBeNull();
  });

  it("spark 미보유면 has-spark 없음", () => {
    const metrics: Metric[] = [{ label: "대기", value: "0" }];
    const { container } = render(<StatCard title="트래픽" metrics={metrics} />);
    const metric = container.querySelector(".metric");
    expect(metric?.className).not.toContain("has-spark");
    expect(container.querySelector(".metric .metric-spark")).toBeNull();
  });
});
