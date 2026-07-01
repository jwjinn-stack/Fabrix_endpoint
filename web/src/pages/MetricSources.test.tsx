// IMP-74 — MetricSources 화면: 소스 카드(대상 객체·상태)·GAP 셀(클릭 가능)·NVML 규칙·empty/error·route/nav.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import MetricSources from "./MetricSources";
import * as client from "../api/client";
import type { MetricSourceCoverage } from "../api/types";
import { ROUTES, PAGE_CAP } from "../router";

// 결정적 fixture — 3단 상태 각 1 + NVML 갭 배지 + 3 GAP 셀.
const FIXTURE: MetricSourceCoverage = {
  generated_at: "t",
  source: "metric-source coverage (mock)",
  sources: [
    {
      id: "node_exporter", label: "node_exporter", role: "호스트 OS 자원", protocol: "prometheus",
      families: ["node_cpu_seconds_total"], targetTypes: ["Node"],
      scrape: { job: "node-exporter", up: 1, scrape_samples_scraped: 400, last_scrape_age_sec: 4 },
      status: "HEALTHY", notes: [],
    },
    {
      id: "dcgm-exporter", label: "DCGM-exporter", role: "GPU 하드웨어", protocol: "prometheus",
      families: ["DCGM_FI_DEV_GPU_UTIL"], targetTypes: ["GpuDevice"],
      scrape: { job: "dcgm-exporter", up: 1, scrape_samples_scraped: 900, last_scrape_age_sec: 6 },
      status: "HEALTHY",
      notes: [{ label: "per-process = 미지원 (알려진 갭)", detail: "NVML 원천 한계 — 귀속 불가.", issue: "#521", tone: "warn" }],
    },
    {
      id: "process-exporter", label: "process-exporter", role: "프로세스 자원", protocol: "prometheus",
      families: ["node_netstat_Tcp_RetransSegs"], targetTypes: ["Node", "Endpoint"],
      scrape: { job: "process-exporter", up: 1, scrape_samples_scraped: 0, last_scrape_age_sec: 9 },
      status: "CONFIGURED_NO_DATA", notes: [],
    },
    {
      id: "blackbox-exporter", label: "blackbox-exporter", role: "엔드포인트 probe", protocol: "prometheus",
      families: ["probe_success"], targetTypes: ["Endpoint"],
      scrape: { job: "blackbox-exporter", up: 0, scrape_samples_scraped: 0, last_scrape_age_sec: 0 },
      status: "NOT_CONFIGURED", notes: [],
    },
  ],
  coverage: [
    { signal: "CPU·메모리·디스크 (USE)", objectType: "Node", covered: true, sourceId: "node_exporter" },
    { signal: "per-process GPU memory", objectType: "GpuDevice", covered: false, reason: "DCGM/NVML 원천 한계 — 귀속 불가.", recommended: "dcgm-exporter", issue: "#521", drilldown: "gpu" },
    { signal: "container memory pressure", objectType: "Model", objectLabel: "Model pod", covered: false, reason: "cAdvisor 필요.", recommended: "cadvisor", drilldown: "investigate" },
    { signal: "TCP retransmit", objectType: "Endpoint", covered: false, reason: "node/process-exporter 또는 blackbox 필요.", recommended: "blackbox-exporter", drilldown: "nodes" },
  ],
};

function mockCoverage(c: MetricSourceCoverage | Error) {
  if (c instanceof Error) return vi.spyOn(client, "fetchMetricSourceCoverage").mockRejectedValue(c);
  return vi.spyOn(client, "fetchMetricSourceCoverage").mockResolvedValue(c);
}

afterEach(cleanup);
beforeEach(() => {
  vi.restoreAllMocks();
  // scrollIntoView 는 jsdom 미구현 — 스텁.
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = vi.fn();
});

describe("MetricSources — 소스 카드(대상 객체 · 3단 상태)", () => {
  it("6→여기선 4개 소스가 대상 객체 타입·상태 배지와 함께 렌더된다", async () => {
    mockCoverage(FIXTURE);
    render(<MetricSources onNavigate={vi.fn()} />);
    // node_exporter 는 소스 카드명 + covered-row sourceLabel 로 2회 등장 가능 — 존재만 확인.
    await waitFor(() => expect(screen.getAllByText("node_exporter").length).toBeGreaterThan(0));
    expect(screen.getByText("DCGM-exporter")).toBeInTheDocument();
    // 대상 객체 타입 pill(온톨로지 ObjectType).
    expect(screen.getAllByText("GpuDevice").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Node").length).toBeGreaterThan(0);
    // 3단 상태 라벨(색-only 아님, 텍스트 병기). '미구성'은 상태 배지 + 요약줄 양쪽에 등장 가능.
    expect(screen.getAllByText(/정상 \(신선\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/구성됨·데이터 없음/)).toBeInTheDocument();
    expect(screen.getAllByText(/미구성/).length).toBeGreaterThan(0);
    // protocol(OTel 정합) 노출.
    expect(screen.getAllByText("prometheus").length).toBeGreaterThan(0);
  });

  it("NVML 은 독립 카드가 아니고, per-process 미지원 갭 배지(이슈 #521)가 DCGM 카드 안에 있다", async () => {
    mockCoverage(FIXTURE);
    render(<MetricSources onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("DCGM-exporter")).toBeInTheDocument());
    // NVML 이라는 독립 소스명(카드 헤더)이 없어야 함.
    expect(screen.queryByText(/^NVML$/)).not.toBeInTheDocument();
    // per-process 미지원 배지 + 이슈 참조 — DCGM 카드 헤더 근처(배지 텍스트)로 스코프.
    const badge = screen.getByText(/per-process = 미지원/);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/이슈 #521/); // 배지 안에 이슈 참조가 들어있다.
  });
});

describe("MetricSources — 커버리지 GAP 셀(클릭 가능)", () => {
  it("3개 GAP 셀이 사유 카피와 함께 렌더된다", async () => {
    mockCoverage(FIXTURE);
    render(<MetricSources onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("per-process GPU memory")).toBeInTheDocument());
    expect(screen.getByText("container memory pressure")).toBeInTheDocument();
    expect(screen.getByText("TCP retransmit")).toBeInTheDocument();
    // GAP 배지(3개) — 셀당 하나.
    expect(screen.getAllByText("GAP")).toHaveLength(3);
    // 사유 카피(cAdvisor 필요 등).
    expect(screen.getByText(/cAdvisor 필요/)).toBeInTheDocument();
  });

  it("GpuDevice GAP 셀 클릭 → gpu 드릴다운으로 onNavigate", async () => {
    const onNavigate = vi.fn();
    mockCoverage(FIXTURE);
    render(<MetricSources onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText("per-process GPU memory")).toBeInTheDocument());
    // 셀은 button(role) — aria-label 로 정확 타겟.
    const cell = screen.getByRole("button", { name: /갭: GpuDevice × per-process GPU memory/ });
    fireEvent.click(cell);
    expect(onNavigate).toHaveBeenCalledWith("gpu");
  });

  it("Endpoint GAP 셀 클릭 → nodes 드릴다운(host 컨텍스트 운반)", async () => {
    const onNavigate = vi.fn();
    mockCoverage(FIXTURE);
    render(<MetricSources onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText("TCP retransmit")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /갭: Endpoint × TCP retransmit/ }));
    expect(onNavigate).toHaveBeenCalledWith("nodes", expect.objectContaining({ host: expect.any(String) }));
  });

  it("Model pod GAP 셀 클릭 → investigate 드릴다운", async () => {
    const onNavigate = vi.fn();
    mockCoverage(FIXTURE);
    render(<MetricSources onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText("container memory pressure")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /갭: Model × container memory pressure/ }));
    expect(onNavigate).toHaveBeenCalledWith("investigate");
  });
});

describe("MetricSources — 커버된 신호(대비군)", () => {
  it("covered 셀이 '커버' 배지와 함께 렌더된다", async () => {
    mockCoverage(FIXTURE);
    render(<MetricSources onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("CPU·메모리·디스크 (USE)")).toBeInTheDocument());
    expect(screen.getByText("커버")).toBeInTheDocument();
  });
});

describe("MetricSources — empty · error", () => {
  it("소스 0건이면 empty 안내", async () => {
    mockCoverage({ ...FIXTURE, sources: [], coverage: [] });
    render(<MetricSources onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/등록된 메트릭 소스가 없습니다/)).toBeInTheDocument());
  });

  it("fetch reject → error 배너(마지막 데이터 없음)", async () => {
    mockCoverage(new Error("boom"));
    render(<MetricSources onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/불러오지 못했습니다/);
  });
});

describe("MetricSources — route / nav 등록", () => {
  it("metric-sources 라우트가 /metric-sources 로 등록 + dashboard cap", () => {
    expect(ROUTES["metric-sources"]).toBe("/metric-sources");
    expect(PAGE_CAP["metric-sources"]).toBe("dashboard");
  });

  it("Diagnostics 와 구분되는 카피 — '메트릭 계열 커버리지'를 명시", async () => {
    mockCoverage(FIXTURE);
    render(<MetricSources onNavigate={vi.fn()} />);
    // 헤더 crumb 이 '커버리지 매트릭스' 인벤토리임을 밝힌다(의존성 프로브 아님).
    await waitFor(() => expect(screen.getByText(/익스포터 커버리지 매트릭스/)).toBeInTheDocument());
  });
});

describe("MetricSources — 접근성", () => {
  it("GAP 셀은 클릭 가능한 button 이고 aria-label 로 이동 대상을 안내한다", async () => {
    mockCoverage(FIXTURE);
    render(<MetricSources onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("per-process GPU memory")).toBeInTheDocument());
    const gapButtons = screen.getAllByRole("button", { name: /^갭:/ });
    expect(gapButtons.length).toBe(3);
    // 각 버튼에 '→ 이동' 의미가 담긴 접근성 이름.
    for (const b of gapButtons) expect(within(b).getByText("GAP")).toBeInTheDocument();
  });
});
