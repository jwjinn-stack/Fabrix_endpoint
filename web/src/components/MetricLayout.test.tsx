import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SummaryStrip, MetricCategoryCard, CategoryGrid } from "./MetricLayout";
import type { SummaryKPI } from "./MetricLayout";

// IMP-80 — 3층 위계 프리미티브 단위 테스트(순수 컴포넌트). 요약 스트립·카테고리 카드.

describe("MetricLayout — SummaryStrip (Tier 1)", () => {
  const items: SummaryKPI[] = [
    { label: "사용률", valueText: "42%", status: "ok", gauge: { value: 0.42, warn: 0.6, crit: 0.9, max: 1 } },
    { label: "온도", valueText: "88°C", status: "crit", gauge: { value: 88, warn: 80, crit: 87, max: 100 } },
  ];

  it("각 KPI 라벨·값 텍스트를 렌더한다", () => {
    render(<SummaryStrip items={items} />);
    expect(screen.getByText("사용률")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("온도")).toBeInTheDocument();
    expect(screen.getByText("88°C")).toBeInTheDocument();
  });

  it("게이지(role=img, aria-label 에 상태 텍스트 병기)를 렌더한다", () => {
    render(<SummaryStrip items={items} />);
    const gauges = screen.getAllByRole("img");
    expect(gauges.length).toBe(2);
    // 색-only 금지: 게이지 aria-label 에 상태 텍스트(위험)가 들어간다(WCAG 1.4.1).
    expect(gauges.some((g) => /위험/.test(g.getAttribute("aria-label") ?? ""))).toBe(true);
  });

  it("임계(crit) KPI 는 상태 텍스트(위험)를 값 옆에 병기한다(색-only 아님)", () => {
    render(<SummaryStrip items={items} />);
    const group = screen.getByRole("group", { name: "핵심 지표 요약" });
    expect(within(group).getByText(/위험/)).toBeInTheDocument();
  });

  it("빈 items 면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<SummaryStrip items={[]} />);
    expect(container.querySelector(".metric-summary")).toBeNull();
  });
});

describe("MetricLayout — MetricCategoryCard (Tier 2)", () => {
  it("기본 펼침: children(신호 행) 이 보인다", () => {
    render(
      <MetricCategoryCard title="사용량 (Utilization)" status="ok">
        <div>CPU 42%</div>
      </MetricCategoryCard>,
    );
    expect(screen.getByText("사용량 (Utilization)")).toBeInTheDocument();
    expect(screen.getByText("CPU 42%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /사용량/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("헤더 클릭 → 접힘(aria-expanded=false, children 숨김)", () => {
    render(
      <MetricCategoryCard title="포화 (Saturation)" status="warn">
        <div>Load 12.3</div>
      </MetricCategoryCard>,
    );
    const head = screen.getByRole("button", { name: /포화/ });
    expect(head).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Load 12.3")).not.toBeInTheDocument();
  });

  it("defaultOpen=false 면 처음부터 접혀 있다", () => {
    render(
      <MetricCategoryCard title="식별 (Identity)" defaultOpen={false}>
        <div>UUID GPU-xxxx</div>
      </MetricCategoryCard>,
    );
    expect(screen.getByRole("button", { name: /식별/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("UUID GPU-xxxx")).not.toBeInTheDocument();
  });

  it("spark prop 이 있으면 mini 스파크라인(svg)을 헤더에 렌더한다", () => {
    const { container } = render(
      <MetricCategoryCard title="트래픽" status="ok" spark={{ values: [1, 2, 3, 2, 4], status: "ok" }}>
        <div>row</div>
      </MetricCategoryCard>,
    );
    const spark = container.querySelector(".metric-cat-spark svg.sparkline");
    expect(spark).not.toBeNull();
  });

  it("spark 가 없으면 스파크라인을 렌더하지 않는다", () => {
    const { container } = render(
      <MetricCategoryCard title="식별" defaultOpen>
        <div>row</div>
      </MetricCategoryCard>,
    );
    expect(container.querySelector(".metric-cat-spark")).toBeNull();
  });

  it("상태 색+텍스트 병기: status=crit 이면 헤더 배지에 '위험' 텍스트", () => {
    render(
      <MetricCategoryCard title="에러" status="crit">
        <div>Net 에러 25/s</div>
      </MetricCategoryCard>,
    );
    // 색(tag-red 클래스)만이 아니라 '위험' 텍스트가 함께 있어야 한다(WCAG 1.4.1).
    const badge = screen.getByText("위험");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/tag-red/);
  });

  it("reduce-motion 경로: caret 은 항상 정적 DOM 으로 렌더(애니는 CSS 가드)", () => {
    // JS 는 reduce-motion 을 분기하지 않는다 — DOM(caret)은 항상 존재, 전이 정지는 @media CSS 책임.
    const { container } = render(
      <MetricCategoryCard title="사용량" status="ok">
        <div>row</div>
      </MetricCategoryCard>,
    );
    expect(container.querySelector(".metric-cat-caret")).not.toBeNull();
  });
});

describe("MetricLayout — CategoryGrid", () => {
  it("자식 카드들을 그리드 래퍼(.metric-cat-grid)로 감싼다", () => {
    const { container } = render(
      <CategoryGrid>
        <MetricCategoryCard title="A"><div>a</div></MetricCategoryCard>
        <MetricCategoryCard title="B"><div>b</div></MetricCategoryCard>
      </CategoryGrid>,
    );
    const grid = container.querySelector(".metric-cat-grid");
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll(".metric-cat-card").length).toBe(2);
  });
});
