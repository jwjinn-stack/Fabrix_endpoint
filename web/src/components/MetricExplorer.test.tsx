// MetricExplorer(IMP-71) 컴포넌트 테스트 — 트리 렌더·collapse/expand·검색·facet·단위/타입/상태·triad·windowing·결정성.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import MetricExplorer from "./MetricExplorer";
import * as client from "../api/client";
import type { MetricRow, ObjectMetricTree } from "../api/types";

// 결정적 sparkline points 헬퍼.
const spark = (v: number): number[] => [v * 0.9, v * 0.95, v];
function row(key: string, label: string, opts: Partial<MetricRow> = {}): MetricRow {
  return {
    key, label, type: opts.type ?? "gauge", unit: opts.unit ?? "%", value: opts.value ?? 42,
    status: opts.status ?? "none", freshness_sec: opts.freshness_sec ?? 3,
    points: opts.points ?? spark(opts.value ?? 42), facets: opts.facets ?? { gpu: "GPU-A", instance: "h:9400", job: "dcgm-exporter" },
  };
}

const GPU_TREE: ObjectMetricTree = {
  generated_at: "t", object_id: "gpu:h/gpu0", object_type: "GpuDevice", range: "1h",
  source: "metric-explorer (mock)", facet_keys: ["gpu", "instance", "job"],
  categories: [
    { key: "utilization", label: "Utilization", rows: [
      row("DCGM_FI_DEV_GPU_UTIL", "GPU 사용률", { unit: "%", value: 88, status: "warn", facets: { gpu: "GPU-A", instance: "h:9400", job: "dcgm-exporter" } }),
      row("DCGM_FI_PROF_SM_ACTIVE", "SM Active", { unit: "%", value: 60, facets: { gpu: "GPU-B", instance: "h:9400", job: "dcgm-exporter" } }),
    ] },
    { key: "memory", label: "Memory", rows: [
      row("DCGM_FI_DEV_FB_USED", "FB 사용(VRAM)", { unit: "bytes", type: "gauge", value: 5 * 1024 * 1024 * 1024, facets: { gpu: "GPU-A", instance: "h:9400", job: "dcgm-exporter" } }),
    ] },
    { key: "errors", label: "Errors (ECC·XID)", rows: [
      row("DCGM_FI_DEV_ECC_DBE_VOL_TOTAL", "ECC DBE(volatile)", { unit: "count", type: "counter", value: 2, status: "crit", facets: { gpu: "GPU-A", instance: "h:9400", job: "dcgm-exporter" } }),
    ] },
  ],
};

const EMPTY_TREE: ObjectMetricTree = {
  generated_at: "t", object_id: "model:foo", object_type: "Model", range: "1h",
  source: "metric-explorer (mock)", facet_keys: [], categories: [],
};

function mockTree(t: ObjectMetricTree) {
  vi.spyOn(client, "fetchObjectMetricTree").mockResolvedValue(t);
}

afterEach(cleanup);
beforeEach(() => vi.restoreAllMocks());

describe("MetricExplorer — 트리 렌더 · 단위/타입/상태", () => {
  it("카테고리 헤더와 메트릭 행을 단위·타입과 함께 렌더한다", async () => {
    mockTree(GPU_TREE);
    render(<MetricExplorer entityId="gpu:h/gpu0" />);
    await waitFor(() => expect(screen.getByText("Utilization")).toBeInTheDocument());
    // 카테고리 3개.
    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.getByText(/Errors/)).toBeInTheDocument();
    // 메트릭명(원본 키) + 라벨.
    expect(screen.getByText("DCGM_FI_DEV_GPU_UTIL")).toBeInTheDocument();
    expect(screen.getByText("GPU 사용률")).toBeInTheDocument();
    // 타입 뱃지(gauge/counter) — 값은 단위 없이 무의미.
    expect(screen.getAllByText("gauge").length).toBeGreaterThan(0);
    expect(screen.getByText("counter")).toBeInTheDocument();
    // 단위 병기: % / bytes(GiB로 스케일) / count.
    expect(screen.getByText("88.0%")).toBeInTheDocument();
    expect(screen.getByText("5.00 GiB")).toBeInTheDocument();
    expect(screen.getByText(/2 count/)).toBeInTheDocument();
    // 상태 텍스트 병기(색-only 금지) — warn/crit.
    expect(screen.getByText(/주의/)).toBeInTheDocument();
    expect(screen.getByText(/위험/)).toBeInTheDocument();
  });

  it("총 메트릭 수를 표시한다", async () => {
    mockTree(GPU_TREE);
    render(<MetricExplorer entityId="gpu:h/gpu0" />);
    await waitFor(() => expect(screen.getByText(/4개 메트릭/)).toBeInTheDocument());
  });
});

describe("MetricExplorer — collapse/expand", () => {
  it("카테고리 헤더 클릭으로 행을 접었다 편다", async () => {
    mockTree(GPU_TREE);
    render(<MetricExplorer entityId="gpu:h/gpu0" />);
    await waitFor(() => expect(screen.getByText("Memory")).toBeInTheDocument());
    // 처음엔 펼쳐져 FB_USED 보임.
    expect(screen.getByText("DCGM_FI_DEV_FB_USED")).toBeInTheDocument();
    // Memory 카테고리 헤더 클릭 → 접힘.
    fireEvent.click(screen.getByRole("button", { name: /Memory/ }));
    await waitFor(() => expect(screen.queryByText("DCGM_FI_DEV_FB_USED")).not.toBeInTheDocument());
    // 다시 클릭 → 펼침.
    fireEvent.click(screen.getByRole("button", { name: /Memory/ }));
    await waitFor(() => expect(screen.getByText("DCGM_FI_DEV_FB_USED")).toBeInTheDocument());
  });
});

describe("MetricExplorer — free-text 검색 필터", () => {
  it("검색어에 맞는 행만 남긴다", async () => {
    mockTree(GPU_TREE);
    render(<MetricExplorer entityId="gpu:h/gpu0" />);
    await waitFor(() => expect(screen.getByText("DCGM_FI_DEV_GPU_UTIL")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("메트릭 검색"), { target: { value: "ECC" } });
    await waitFor(() => {
      expect(screen.getByText("DCGM_FI_DEV_ECC_DBE_VOL_TOTAL")).toBeInTheDocument();
      expect(screen.queryByText("DCGM_FI_DEV_GPU_UTIL")).not.toBeInTheDocument();
    });
  });

  it("매칭 없으면 안내를 보여준다", async () => {
    mockTree(GPU_TREE);
    render(<MetricExplorer entityId="gpu:h/gpu0" />);
    await waitFor(() => expect(screen.getByText("Utilization")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("메트릭 검색"), { target: { value: "zzz-no-match" } });
    await waitFor(() => expect(screen.getByText(/맞는 메트릭이 없습니다/)).toBeInTheDocument());
  });
});

describe("MetricExplorer — facet 필터", () => {
  it("facet 선택 → 값 선택으로 해당 label 행만, 이후 검색 결합", async () => {
    mockTree(GPU_TREE);
    render(<MetricExplorer entityId="gpu:h/gpu0" />);
    await waitFor(() => expect(screen.getByText("DCGM_FI_PROF_SM_ACTIVE")).toBeInTheDocument());
    // facet 종류 = gpu.
    fireEvent.change(screen.getByLabelText("facet 종류"), { target: { value: "gpu" } });
    // 값 = GPU-B (SM_ACTIVE 만 GPU-B).
    await waitFor(() => expect(screen.getByLabelText("gpu 값")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("gpu 값"), { target: { value: "GPU-B" } });
    await waitFor(() => {
      expect(screen.getByText("DCGM_FI_PROF_SM_ACTIVE")).toBeInTheDocument();
      expect(screen.queryByText("DCGM_FI_DEV_GPU_UTIL")).not.toBeInTheDocument();
    });
  });
});

describe("MetricExplorer — triad(loading/empty/error)", () => {
  it("loading: fetch 지연 중 로딩 상태", async () => {
    let resolve!: (t: ObjectMetricTree) => void;
    vi.spyOn(client, "fetchObjectMetricTree").mockReturnValue(new Promise<ObjectMetricTree>((r) => { resolve = r; }));
    render(<MetricExplorer entityId="gpu:h/gpu0" />);
    expect(screen.getByText(/불러오는 중/)).toBeInTheDocument();
    resolve(GPU_TREE);
    await waitFor(() => expect(screen.getByText("Utilization")).toBeInTheDocument());
  });

  it("empty(0 메트릭): 비-엔티티(Model)는 안내 + 힌트", async () => {
    mockTree(EMPTY_TREE);
    render(<MetricExplorer entityId="model:foo" />);
    await waitFor(() => expect(screen.getByText(/수집된 메트릭이 없습니다/)).toBeInTheDocument());
    expect(screen.getByText(/GPU·노드 엔티티에만/)).toBeInTheDocument();
  });

  it("error: fetch 실패 시 에러 + 재시도 버튼", async () => {
    vi.spyOn(client, "fetchObjectMetricTree").mockRejectedValue(new Error("boom"));
    render(<MetricExplorer entityId="gpu:h/gpu0" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /다시 시도/ })).toBeInTheDocument();
  });
});

describe("MetricExplorer — windowing(수백 행)", () => {
  it("threshold 초과 시 VirtualRows 게이트가 켜져 스페이서를 그린다", async () => {
    // 300행 카테고리 — 게이트 threshold(40) 초과. viewportOverride 로 jsdom 레이아웃 주입.
    const many: MetricRow[] = Array.from({ length: 300 }, (_, i) =>
      row(`metric_${i}`, `M${i}`, { value: i }));
    const bigTree: ObjectMetricTree = {
      ...GPU_TREE, categories: [{ key: "utilization", label: "Utilization", rows: many }],
    };
    mockTree(bigTree);
    const { container } = render(
      <MetricExplorer entityId="gpu:h/gpu0" viewportOverride={{ scrollTop: 0, clientHeight: 400 }} />,
    );
    await waitFor(() => expect(screen.getByText("Utilization")).toBeInTheDocument());
    // windowing ON → 아래 스페이서 행이 존재(보이지 않는 300행을 통째로 안 그림).
    expect(container.querySelectorAll(".vrow-spacer").length).toBeGreaterThan(0);
    // 첫 행은 보이고, 마지막 행(M299)은 창 밖이라 미렌더.
    expect(screen.getByText("M0")).toBeInTheDocument();
    expect(screen.queryByText("M299")).not.toBeInTheDocument();
  });
});

describe("MetricExplorer — 결정성", () => {
  it("같은 트리로 두 번 렌더하면 동일 행 집합", async () => {
    mockTree(GPU_TREE);
    const a = render(<MetricExplorer entityId="gpu:h/gpu0" />);
    await waitFor(() => expect(screen.getByText("Utilization")).toBeInTheDocument());
    const firstKeys = within(a.container).getAllByText(/^DCGM_/).map((el) => el.textContent).sort();
    cleanup();
    mockTree(GPU_TREE);
    const b = render(<MetricExplorer entityId="gpu:h/gpu0" />);
    await waitFor(() => expect(screen.getByText("Utilization")).toBeInTheDocument());
    const secondKeys = within(b.container).getAllByText(/^DCGM_/).map((el) => el.textContent).sort();
    expect(firstKeys).toEqual(secondKeys);
  });
});
