// 풀-피델리티 GPU 하드웨어 필드(IMP-76 track A) 테스트.
// (1) 순수 디코더/라벨 맵(clocksEventReasons 비트마스크·XID enum) — 경계·fallback.
// (2) mock 계약: fetchGPU device.hw 존재·결정성, ontology GpuDevice props.hw + throttle 요약.
// 프로젝트 ethos(백엔드 0개): installMockFetch 로 실제 라우터 경로를 통과시킨다.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { installMockFetch, decodeClocksEventReasons, xidLabel } from "./mock";
import { fetchGPU, fetchOntologyObjects, fetchOntologyObject } from "./client";
import type { GpuHardware } from "./types";

beforeAll(() => {
  installMockFetch();
});

// ── (1) 순수 디코더: clocksEventReasons 비트마스크 → reason 리스트 ──
describe("decodeClocksEventReasons — 비트마스크 디코드", () => {
  it("0 이면 빈 배열(제약 없음)", () => {
    expect(decodeClocksEventReasons(0)).toEqual([]);
  });
  it("음수·비정상 입력은 빈 배열(방어)", () => {
    expect(decodeClocksEventReasons(-1)).toEqual([]);
  });
  it("thermal 비트(0x8)가 서면 열 사유가 포함된다", () => {
    const r = decodeClocksEventReasons(0x8);
    expect(r.some((s) => s.includes("열"))).toBe(true);
  });
  it("여러 비트를 동시에 디코드한다(thermal+power)", () => {
    const r = decodeClocksEventReasons(0x8 | 0x4);
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.some((s) => s.includes("열"))).toBe(true);
    expect(r.some((s) => s.includes("전력"))).toBe(true);
  });
});

// ── (1) XID enum → 라벨 맵 ──
describe("xidLabel — XID enum 매핑", () => {
  it("0 은 정상 라벨", () => {
    expect(xidLabel(0)).toContain("정상");
  });
  it("대표 코드는 사람이 읽는 라벨(48=DBE)", () => {
    expect(xidLabel(48)).toMatch(/DBE|ECC/);
  });
  it("미등록/음수 코드는 fallback 라벨(throw 없음)", () => {
    expect(xidLabel(9999)).toContain("9999");
    expect(xidLabel(-1)).toContain("-1");
  });
});

// hw 구조 최소검증 헬퍼(테스트 공용).
function assertHwShape(hw: GpuHardware | undefined) {
  expect(hw).toBeTruthy();
  const h = hw!;
  expect(typeof h.sm_clock_mhz).toBe("number");
  expect(typeof h.mem_clock_mhz).toBe("number");
  expect(typeof h.xid_recent).toBe("number");
  expect(typeof h.clocks_event_reasons).toBe("number");
  // NVLink L0–L5(6링크) + 오류 3종.
  expect(h.nvlink.throughput_kibs).toHaveLength(6);
  expect(typeof h.nvlink.total_kibs).toBe("number");
  expect(typeof h.nvlink.crc_errors).toBe("number");
  expect(typeof h.nvlink.replay_errors).toBe("number");
  expect(typeof h.nvlink.recovery_errors).toBe("number");
  // PCIe tx/rx/replay.
  expect(typeof h.pcie.tx_bytes).toBe("number");
  expect(typeof h.pcie.rx_bytes).toBe("number");
  expect(typeof h.pcie.replay_counter).toBe("number");
  // ECC SBE/DBE vol·agg.
  expect(typeof h.ecc.sbe_volatile).toBe("number");
  expect(typeof h.ecc.dbe_volatile).toBe("number");
  expect(typeof h.ecc.sbe_aggregate).toBe("number");
  expect(typeof h.ecc.dbe_aggregate).toBe("number");
  // per-process(대표).
  expect(Array.isArray(h.processes)).toBe(true);
  expect(h.processes.length).toBeGreaterThanOrEqual(1);
  expect(typeof h.processes[0].pid).toBe("number");
  expect(typeof h.processes[0].name).toBe("string");
  expect(typeof h.processes[0].mem_used_mb).toBe("number");
}

// ── (2) fetchGPU: 모든 device 에 풀 하드웨어 필드 ──
describe("GET /gpu — device.hw 풀 필드(normal)", () => {
  it("모든 device 에 hw 하드웨어 상세가 present", async () => {
    const rep = await fetchGPU();
    expect(rep.devices.length).toBeGreaterThan(0);
    for (const d of rep.devices) assertHwShape(d.hw);
  });

  it("결정적(retry) — 같은 15s 버킷에서 두 번 호출 시 동일 hw", async () => {
    // 클록 고정: 두 호출이 실제 벽시계로 15s 버킷 경계를 넘으면 다른 seed → flaky. 경계 레이스 방지.
    // Date 만 가짜로(mock 라우터의 setTimeout 지연은 실제 타이머로 유지해야 await 가 풀린다).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-02T00:00:00.000Z"));
    try {
      const a = await fetchGPU();
      const b = await fetchGPU();
      // uuid 로 매칭해 hw 동일성 확인(같은 시각 버킷 → 같은 seed).
      const byUuidB = new Map(b.devices.map((d) => [d.uuid, d.hw]));
      for (const d of a.devices) {
        expect(byUuidB.get(d.uuid)).toEqual(d.hw);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("최소 하나의 device 는 throttle/XID 시나리오가 파생될 수 있는 형태(값 범위 유효)", async () => {
    const rep = await fetchGPU();
    for (const d of rep.devices) {
      const h = d.hw!;
      expect(h.xid_recent).toBeGreaterThanOrEqual(0);
      expect(h.clocks_event_reasons).toBeGreaterThanOrEqual(0);
      expect(h.sm_clock_mhz).toBeGreaterThan(0);
      // decode 가 던지지 않고 유효 리스트를 낸다.
      expect(Array.isArray(decodeClocksEventReasons(h.clocks_event_reasons))).toBe(true);
    }
  });
});

// ── (2) 온톨로지 GpuDevice 객체에 하드웨어 부착 ──
describe("ontology GpuDevice — props.hw + throttle 요약(IMP-76)", () => {
  it("GpuDevice 객체 props 에 중첩 hw 와 throttle/xid 요약 키가 있다", async () => {
    const list = await fetchOntologyObjects("GpuDevice");
    expect(list.objects.length).toBeGreaterThan(0);
    for (const o of list.objects) {
      assertHwShape(o.props.hw as GpuHardware);
      // ObjectView Properties/badge 가 바로 읽는 요약 키.
      expect(typeof o.props.throttle).toBe("string");
      expect(typeof o.props.xid_recent).toBe("number");
    }
  });

  it("단일 객체 조회에서도 hw 가 유지된다(결정성)", async () => {
    // 클록 고정: 두 재조회가 15s 버킷 경계를 넘으면 hw seed 가 달라진다. 경계 레이스 방지.
    // Date 만 가짜로(mock 라우터의 setTimeout 지연은 실제 타이머로 유지해야 await 가 풀린다).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-02T00:00:00.000Z"));
    try {
      const list = await fetchOntologyObjects("GpuDevice");
      const id = list.objects[0].id;
      const one = await fetchOntologyObject(id);
      assertHwShape(one.props.hw as GpuHardware);
      // 같은 객체 재조회 시 동일 hw.
      const again = await fetchOntologyObject(id);
      expect(again.props.hw).toEqual(one.props.hw);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throttle 요약은 reason 문자열 또는 '제약 없음'", async () => {
    const list = await fetchOntologyObjects("GpuDevice");
    for (const o of list.objects) {
      const t = o.props.throttle as string;
      expect(t.length).toBeGreaterThan(0);
    }
  });
});
