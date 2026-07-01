// 풀-피델리티 GPU 하드웨어 섹션 (IMP-76 track A) — 단일 출처.
// Gpu.tsx SlidePanel + ObjectView 양쪽에서 재사용. DCGM 확정 필드셋(GpuHardware)을
// 하드웨어 근본원인 그룹으로 렌더: Clocks / Interconnect(PCIe·NVLink) / Errors(ECC·XID) / Throttle.
//   - 값마다 단위 병기(bytes↔MiB·MHz·W·count) — UNITS matter.
//   - 최근 XID·throttle reason 은 Badge(WCAG 1.4.1: 색+텍스트 병기). 라이트+스틸블루·네온 금지.
//   - 최근 XID 는 "코드 1개"(DCGM 230 gauge) — 가짜 다중 타임라인 아님. 라벨은 xidLabel().
import type { ReactNode } from "react";
import type { GpuHardware } from "../api/types";
import { decodeClocksEventReasons, xidLabel } from "../api/gpuHardware";
import Badge from "./Badge";

const nf = new Intl.NumberFormat("ko-KR");

// 누적 bytes → 사람이 읽는 단위(B/KiB/MiB/GiB/TiB). 단위를 명시적으로 병기(값 vs 단위 혼동 방지).
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(2)} ${units[i]}`;
}
// KiB/s throughput → 자동 스케일(KiB/s→MiB/s→GiB/s). NVLink/PCIe 대역폭 표시.
function formatRateKiBs(kibs: number): string {
  if (!Number.isFinite(kibs) || kibs < 0) return "—";
  if (kibs >= 1024 * 1024) return `${(kibs / (1024 * 1024)).toFixed(2)} GiB/s`;
  if (kibs >= 1024) return `${(kibs / 1024).toFixed(1)} MiB/s`;
  return `${nf.format(Math.round(kibs))} KiB/s`;
}

// 하드웨어 그룹 한 줄(라벨 · 값+단위). 강조(경보)면 색.
function HwRow({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="hw-row">
      <span className="hw-row-label">{label}</span>
      <span className="hw-row-value" style={warn ? { color: "var(--red)", fontWeight: 600 } : undefined}>{value}</span>
    </div>
  );
}

export default function GpuHardwareSection({ hw }: { hw: GpuHardware }) {
  const throttleReasons = decodeClocksEventReasons(hw.clocks_event_reasons);
  const throttled = throttleReasons.length > 0;
  const xid = hw.xid_recent;
  const eccBad = hw.ecc.dbe_volatile > 0 || hw.ecc.dbe_aggregate > 0;
  const nvlinkErr = hw.nvlink.crc_errors + hw.nvlink.replay_errors + hw.nvlink.recovery_errors;

  return (
    <section className="gpu-hw" aria-label="GPU 하드웨어">
      <h4 className="ov-h">GPU 하드웨어 <span className="hw-src" title="DCGM 필드셋(mock) — 실 수집은 IMP-79">DCGM</span></h4>

      {/* Throttle — clocksEventReasons(112) 디코드. 색+텍스트 병기. */}
      <div className="hw-group">
        <div className="hw-group-h">Throttle · 클럭 제약 사유</div>
        {throttled ? (
          <div className="hw-badges">
            {throttleReasons.map((rzn) => (
              <Badge key={rzn} tone="amber" dot>{rzn}</Badge>
            ))}
          </div>
        ) : (
          <div className="hw-badges"><Badge tone="green" dot>제약 없음</Badge></div>
        )}
      </div>

      {/* Errors — ECC(SBE/DBE vol·agg) + 최근 XID(코드 1개). */}
      <div className="hw-group">
        <div className="hw-group-h">Errors · ECC·XID</div>
        <div className="hw-badges">
          {xid > 0 ? (
            <Badge tone="red" dot title="DCGM_FI_DEV_XID_ERRORS(230) — 가장 최근 XID 코드 1개">
              최근 XID {xid} · {xidLabel(xid)}
            </Badge>
          ) : (
            <Badge tone="green" dot title="최근 XID 없음">최근 XID 없음</Badge>
          )}
        </div>
        <HwRow label="ECC SBE (volatile)" value={`${nf.format(hw.ecc.sbe_volatile)} count`} />
        <HwRow label="ECC DBE (volatile)" value={`${nf.format(hw.ecc.dbe_volatile)} count`} warn={hw.ecc.dbe_volatile > 0} />
        <HwRow label="ECC SBE (aggregate)" value={`${nf.format(hw.ecc.sbe_aggregate)} count`} />
        <HwRow label="ECC DBE (aggregate)" value={`${nf.format(hw.ecc.dbe_aggregate)} count`} warn={eccBad} />
      </div>

      {/* Interconnect — PCIe(bytes/replay) + NVLink(throughput/errors). 단위 명시. */}
      <div className="hw-group">
        <div className="hw-group-h">Interconnect · PCIe·NVLink</div>
        <HwRow label="PCIe TX (누적)" value={formatBytes(hw.pcie.tx_bytes)} />
        <HwRow label="PCIe RX (누적)" value={formatBytes(hw.pcie.rx_bytes)} />
        <HwRow label="PCIe Replay" value={`${nf.format(hw.pcie.replay_counter)} count`} warn={hw.pcie.replay_counter > 10} />
        <HwRow label="NVLink 합계 대역" value={formatRateKiBs(hw.nvlink.total_kibs)} />
        <HwRow label="NVLink 오류 (CRC·replay·recovery)" value={`${nf.format(nvlinkErr)} count`} warn={nvlinkErr > 20} />
        {/* 링크별 throughput 미니 표(L0–L5) — KiB/s 단위. */}
        <div className="hw-links" role="group" aria-label="NVLink 링크별 대역">
          {hw.nvlink.throughput_kibs.map((t, i) => (
            <span className="hw-link" key={i} title={`L${i} throughput`}>
              <span className="hw-link-k">L{i}</span>
              <span className="hw-link-v">{formatRateKiBs(t)}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Clocks — SM/Mem clock(MHz). throttle 시 강조. */}
      <div className="hw-group">
        <div className="hw-group-h">Clocks</div>
        <HwRow label="SM Clock" value={`${nf.format(hw.sm_clock_mhz)} MHz`} warn={throttled} />
        <HwRow label="Mem Clock" value={`${nf.format(hw.mem_clock_mhz)} MHz`} />
      </div>

      {/* per-process — DCGM accounting(205). time-sharing/MIG 제약으로 대표 프로세스만. */}
      {hw.processes.length > 0 && (
        <div className="hw-group">
          <div className="hw-group-h">프로세스 · per-process VRAM <span className="hw-src" title="DCGM accounting(205) — time-sharing/MIG 귀속 제약">대표</span></div>
          {hw.processes.map((p) => (
            <HwRow key={p.pid} label={`${p.name} · PID ${p.pid}`} value={`${nf.format(p.mem_used_mb)} MiB`} />
          ))}
        </div>
      )}
    </section>
  );
}
