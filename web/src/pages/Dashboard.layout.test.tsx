import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import Dashboard from "./Dashboard";
import type { DashboardOverview, Timeseries } from "../api/types";
import { loadLayout } from "../dashboardLayout";

// IMP-40 — 커스텀 대시보드: 편집모드 show/hide + reorder(up/down) + localStorage 영속을 RTL 로 검증.

const OVERVIEW: DashboardOverview = {
  range: "24h",
  generated_at: "2026-06-30T00:00:00Z",
  traffic: { qps: 12.3, running: 4, waiting: 1, success_rate: 0.995 },
  quality: { ttft_p50_ms: 90, ttft_p95_ms: 130, itl_avg_ms: 22, cache_hit_rate: 0.6 },
  guardrail: { blocked: 2, pii: 1, jailbreak: 0, flagged: 3 },
  gpu: { usage_perc: 0.7, kv_cache_perc: 0.5, mig_efficiency: 0.8 },
  latency: { ttft_p50_ms: 90, ttft_p95_ms: 130, ttft_p99_ms: 180, tpot_p50_ms: 10, tpot_p95_ms: 20, tpot_p99_ms: 30, e2e_p50_ms: 200, e2e_p95_ms: 400, e2e_p99_ms: 600 },
  scheduler: { running: 4, waiting: 1, queue_p95_ms: 50, kv_cache_perc: 0.5 },
  tokens: { prompt_tokens: 1000, cached_tokens: 200, completion_tokens: 500 },
  dept_usage: [{ dept_id: "d1", name: "리테일", percent: 0.5 }],
  app_usage: [{ app_id: "app-a", percent: 0.4 }],
  top_endpoints: [],
  top_keys: [],
  alarms: [{ severity: "warning", message: "대기 큐 증가" }],
};
const SERIES: Timeseries = {
  range: "24h",
  points: [
    { ts: "t0", qps: 10, ttft_p95_ms: 120, tpot_p95_ms: 20, e2e_p95_ms: 350, running: 3, waiting: 0, blocked: 1 },
    { ts: "t1", qps: 11, ttft_p95_ms: 125, tpot_p95_ms: 21, e2e_p95_ms: 360, running: 4, waiting: 1, blocked: 2 },
    { ts: "t2", qps: 12, ttft_p95_ms: 128, tpot_p95_ms: 22, e2e_p95_ms: 370, running: 4, waiting: 1, blocked: 2 },
    { ts: "t3", qps: 13, ttft_p95_ms: 130, tpot_p95_ms: 23, e2e_p95_ms: 380, running: 5, waiting: 2, blocked: 3 },
  ],
};

const fetchOverview = vi.fn();
const fetchTimeseries = vi.fn();
vi.mock("../api/client", () => ({
  fetchOverview: (...a: unknown[]) => fetchOverview(...a),
  fetchTimeseries: (...a: unknown[]) => fetchTimeseries(...a),
}));

// 본문에 렌더된 위젯 id(편집 패널의 .vb-row[data-widget] 는 제외).
const widgetIds = () =>
  Array.from(document.querySelectorAll("[data-widget]"))
    .filter((el) => !el.closest(".view-builder"))
    .map((el) => el.getAttribute("data-widget"));

describe("Dashboard 커스텀 레이아웃 (IMP-40)", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchOverview.mockReset().mockResolvedValue(OVERVIEW);
    fetchTimeseries.mockReset().mockResolvedValue(SERIES);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const renderDash = async () => {
    await act(async () => {
      render(<Dashboard />);
    });
    // 데이터 로드 완료까지 대기
    await waitFor(() => expect(screen.getByText("실시간 트래픽")).toBeInTheDocument());
  };

  it("기본 레이아웃: GPU 는 숨김, 나머지 위젯 렌더", async () => {
    await renderDash();
    // 본문에 트래픽/품질/가드레일 KPI 카드가 보인다(GPU 는 기본 숨김).
    const main = widgetIds();
    expect(main).toContain("traffic");
    expect(main).toContain("quality");
    expect(main).toContain("guardrail");
    expect(main).not.toContain("gpu");
    expect(main).toContain("timeseries");
    expect(main).toContain("alarms");
  });

  it("show/hide: 편집모드에서 가드레일을 숨기면 본문에서 사라진다", async () => {
    await renderDash();
    fireEvent.click(screen.getByRole("button", { name: "뷰 편집" }));
    const toggle = screen.getByLabelText("가드레일 표시") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await act(async () => {
      fireEvent.click(toggle);
    });
    // 본문 렌더 목록에서 guardrail 제거 + localStorage 반영
    await waitFor(() => expect(widgetIds()).not.toContain("guardrail"));
    expect(loadLayout().hidden).toContain("guardrail");
  });

  it("reorder: '아래로' 클릭 시 순서가 바뀌고 저장된다", async () => {
    await renderDash();
    fireEvent.click(screen.getByRole("button", { name: "뷰 편집" }));
    // 편집 패널의 첫 행은 traffic, 둘째는 quality.
    const before = loadLayout().order;
    expect(before[0]).toBe("traffic");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "실시간 트래픽 아래로" }));
    });
    await waitFor(() => {
      const after = loadLayout().order;
      expect(after[0]).toBe("quality");
      expect(after[1]).toBe("traffic");
    });
  });

  it("경계: 맨 위 위젯의 '위로' 버튼은 비활성", async () => {
    await renderDash();
    fireEvent.click(screen.getByRole("button", { name: "뷰 편집" }));
    const up = screen.getByRole("button", { name: "실시간 트래픽 위로" }) as HTMLButtonElement;
    expect(up.disabled).toBe(true);
  });

  it("영속: 저장된 레이아웃이 재마운트 후 복원된다", async () => {
    // 사전 저장: alarms 를 맨 앞으로, gpu 표시.
    localStorage.setItem(
      "fabrix.dashboard.layout",
      JSON.stringify({ order: ["alarms", "traffic", "quality", "guardrail", "gpu", "distribution", "timeseries"], hidden: [] }),
    );
    await renderDash();
    const ids = widgetIds();
    expect(ids[0]).toBe("alarms");
    expect(ids).toContain("gpu"); // hidden 비었으니 GPU 도 표시
  });

  it("잘못된 저장값 방어: 깨진 JSON 이어도 크래시 없이 기본 위젯 렌더", async () => {
    localStorage.setItem("fabrix.dashboard.layout", "{broken");
    await renderDash();
    const main = widgetIds();
    expect(main).toContain("traffic");
    expect(main).not.toContain("gpu"); // 기본 폴백(hidden=gpu)
  });

  it("편집 패널은 모든 위젯(숨김 포함)을 행으로 보여준다", async () => {
    await renderDash();
    fireEvent.click(screen.getByRole("button", { name: "뷰 편집" }));
    const panel = screen.getByLabelText("대시보드 위젯 편집");
    // GPU 는 숨김이지만 편집 패널 행에는 존재(체크 해제 상태).
    const gpuToggle = within(panel).getByLabelText("GPU / MIG 표시") as HTMLInputElement;
    expect(gpuToggle.checked).toBe(false);
  });
});
