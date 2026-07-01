// GpuHardwareSection(IMP-76) — 그룹 렌더·단위 병기·throttle/XID 뱃지·formatBytes 경계.
// + ObjectView 통합(GpuDevice props.hw → 'GPU 하드웨어' 섹션; hw 없으면 skip).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import GpuHardwareSection, { formatBytes } from "./GpuHardwareSection";
import ObjectView from "./ObjectView";
import { ToastProvider } from "../toast";
import * as client from "../api/client";
import type { GpuHardware, OntologyObject, OntologyObjectList, OntologyLinkList } from "../api/types";

vi.mock("../capabilities", () => ({
  useCap: () => ({ can: () => true, caps: { profile: "manage", readonly: false, capabilities: {}, data_source: "mock", integrations: {} } }),
}));

// throttle(thermal+power) + 최근 XID 48(DBE) + ECC DBE 를 가진 하드웨어 픽스처.
const HW: GpuHardware = {
  sm_clock_mhz: 1450,
  mem_clock_mhz: 2300,
  xid_recent: 48,
  clocks_event_reasons: 0x8 | 0x4, // thermal + power
  nvlink: { throughput_kibs: [1000, 2000, 3000, 4000, 5000, 6000], total_kibs: 21000, crc_errors: 2, replay_errors: 5, recovery_errors: 1 },
  pcie: { tx_bytes: 5 * 1024 * 1024 * 1024, rx_bytes: 3 * 1024 * 1024, replay_counter: 12 },
  ecc: { sbe_volatile: 1, dbe_volatile: 2, sbe_aggregate: 128, dbe_aggregate: 3 },
  processes: [{ pid: 4242, name: "python (vllm)", mem_used_mb: 42000 }],
};
// 정상(throttle 없음, XID 없음) 픽스처.
const HW_CLEAN: GpuHardware = {
  ...HW, xid_recent: 0, clocks_event_reasons: 0,
  ecc: { sbe_volatile: 0, dbe_volatile: 0, sbe_aggregate: 10, dbe_aggregate: 0 },
};

afterEach(cleanup);

describe("formatBytes — 단위 스케일", () => {
  it("바이트 단위 경계를 사람이 읽는 단위로", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.00 KiB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.00 GiB");
  });
  it("음수/비유한은 대시", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });
});

describe("GpuHardwareSection — 그룹·단위·뱃지 렌더", () => {
  it("4개 하드웨어 그룹 헤더를 렌더한다", () => {
    render(<GpuHardwareSection hw={HW} />);
    expect(screen.getByText(/GPU 하드웨어/)).toBeInTheDocument();
    expect(screen.getByText(/Throttle/)).toBeInTheDocument();
    expect(screen.getByText(/Errors/)).toBeInTheDocument();
    expect(screen.getByText(/Interconnect/)).toBeInTheDocument();
    expect(screen.getByText("Clocks")).toBeInTheDocument();
  });

  it("throttle reason 을 뱃지로 디코드해 표시(thermal+power)", () => {
    render(<GpuHardwareSection hw={HW} />);
    expect(screen.getByText(/열/)).toBeInTheDocument();
    expect(screen.getByText(/전력/)).toBeInTheDocument();
  });

  it("최근 XID 를 코드+라벨 뱃지로(DBE)", () => {
    render(<GpuHardwareSection hw={HW} />);
    const xid = screen.getByText(/최근 XID 48/);
    expect(xid).toBeInTheDocument();
    expect(xid.textContent).toMatch(/DBE|ECC/);
  });

  it("정상 하드웨어는 '제약 없음' + '최근 XID 없음'", () => {
    render(<GpuHardwareSection hw={HW_CLEAN} />);
    expect(screen.getByText("제약 없음")).toBeInTheDocument();
    expect(screen.getByText("최근 XID 없음")).toBeInTheDocument();
  });

  it("값에 단위를 병기한다(MHz·count·GiB·MiB)", () => {
    const { container } = render(<GpuHardwareSection hw={HW} />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/MHz/);   // clock
    expect(text).toMatch(/count/); // ECC/replay
    expect(text).toMatch(/GiB/);   // PCIe TX (5 GiB)
    expect(text).toMatch(/MiB/);   // per-process VRAM
  });

  it("NVLink 링크별(L0–L5) throughput 6칩", () => {
    render(<GpuHardwareSection hw={HW} />);
    for (let i = 0; i < 6; i++) expect(screen.getByText(`L${i}`)).toBeInTheDocument();
  });

  it("per-process 프로세스 행을 표시", () => {
    render(<GpuHardwareSection hw={HW} />);
    expect(screen.getByText(/python \(vllm\) · PID 4242/)).toBeInTheDocument();
  });
});

// ── ObjectView 통합: GpuDevice props.hw → 하드웨어 섹션 ──
function stub(objs: Record<string, OntologyObject>) {
  const list: OntologyObjectList = { generated_at: "t", objects: Object.values(objs), source: "ontology (mock)" };
  vi.spyOn(client, "fetchOntologyObjects").mockResolvedValue(list);
  vi.spyOn(client, "fetchOntologyObject").mockImplementation((id: string) =>
    objs[id] ? Promise.resolve(objs[id]) : Promise.reject(new Error("API 404")));
  vi.spyOn(client, "fetchOntologyLinks").mockImplementation((id: string) => {
    if (!objs[id]) return Promise.reject(new Error("API 404"));
    const lr: OntologyLinkList = { generated_at: "t", object_id: id, links: [], source: "ontology (mock)" };
    return Promise.resolve(lr);
  });
}

describe("ObjectView — GPU 하드웨어 섹션 통합", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GpuDevice props.hw 가 있으면 하드웨어 섹션을 렌더한다", async () => {
    stub({
      "gpu:g1": { id: "gpu:g1", type: "GpuDevice", title: "host/gpu0", status: "warn", revision: 1, props: { device: "g1", xid_recent: 48, throttle: "열(HW Thermal Slowdown)", hw: HW } },
    });
    render(<ToastProvider><ObjectView objectId="gpu:g1" onClose={() => {}} /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(/GPU 하드웨어/)).toBeInTheDocument());
    expect(screen.getByText(/최근 XID 48/)).toBeInTheDocument();
  });

  it("hw 없는 GpuDevice 는 하드웨어 섹션을 렌더하지 않는다(env-missing/레거시)", async () => {
    stub({
      "gpu:g2": { id: "gpu:g2", type: "GpuDevice", title: "host/gpu1", status: "ok", revision: 1, props: { device: "g2", gpu_util: 0.4 } },
    });
    render(<ToastProvider><ObjectView objectId="gpu:g2" onClose={() => {}} /></ToastProvider>);
    // 속성 섹션은 뜨지만 하드웨어 섹션은 없어야 한다.
    await waitFor(() => expect(screen.getByText("속성")).toBeInTheDocument());
    expect(screen.queryByText(/GPU 하드웨어/)).not.toBeInTheDocument();
  });

  it("비-GpuDevice 객체는 하드웨어 섹션 없음", async () => {
    stub({
      "model:foo": { id: "model:foo", type: "Model", title: "Foo", status: "ok", revision: 1, props: { replicas: 2 } },
    });
    render(<ToastProvider><ObjectView objectId="model:foo" onClose={() => {}} /></ToastProvider>);
    await waitFor(() => expect(screen.getByText("속성")).toBeInTheDocument());
    expect(screen.queryByText(/GPU 하드웨어/)).not.toBeInTheDocument();
  });
});
