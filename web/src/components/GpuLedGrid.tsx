import type { GPUDevice } from "../api/types";

// 노드 LED 그리드 — 수십~수백 GPU를 상태 점 매트릭스로 한 화면 압축.
// all-smi/nvidia Cluster Overview 패턴(상용SW-화면UIUX-리서치 P4-2).
// 임계: 온도 ≥87 또는 사용률 ≥90% = 위험(red), ≥80 또는 ≥60% = 주의(amber), 그 외 정상.
export type GpuStatus = "ok" | "warn" | "crit";

export function gpuStatus(d: GPUDevice): GpuStatus {
  if (d.temp_c >= 87 || d.util_perc >= 0.9) return "crit";
  if (d.temp_c >= 80 || d.util_perc >= 0.6) return "warn";
  return "ok";
}

const STATUS_COLOR: Record<GpuStatus, string> = {
  ok: "var(--green)",
  warn: "var(--amber)",
  crit: "var(--red)",
};

export default function GpuLedGrid({
  devices,
  onSelect,
}: {
  devices: GPUDevice[];
  onSelect?: (d: GPUDevice) => void;
}) {
  if (devices.length === 0) return null;
  // 호스트별 그룹.
  const byHost = new Map<string, GPUDevice[]>();
  for (const d of devices) {
    const arr = byHost.get(d.hostname) ?? [];
    arr.push(d);
    byHost.set(d.hostname, arr);
  }
  const counts = devices.reduce(
    (acc, d) => {
      acc[gpuStatus(d)]++;
      return acc;
    },
    { ok: 0, warn: 0, crit: 0 } as Record<GpuStatus, number>,
  );

  return (
    <div className="card">
      <div className="card-head">
        <h3>노드 · GPU 상태 그리드</h3>
        <span className="info" title="온도≥87°C 또는 사용률≥90% = 위험, ≥80°C 또는 ≥60% = 주의. 셀 클릭 시 상세.">ⓘ</span>
        <span className="spacer" />
        <span className="led-legend">
          <span className="led-key"><span className="led-dot" style={{ background: STATUS_COLOR.ok }} /> 정상 {counts.ok}</span>
          <span className="led-key"><span className="led-dot" style={{ background: STATUS_COLOR.warn }} /> 주의 {counts.warn}</span>
          <span className="led-key"><span className="led-dot" style={{ background: STATUS_COLOR.crit }} /> 위험 {counts.crit}</span>
        </span>
      </div>
      <div className="led-hosts">
        {[...byHost.entries()].map(([host, gpus]) => (
          <div className="led-host" key={host}>
            <div className="led-host-name" title={host}>{host}</div>
            <div className="led-cells">
              {gpus.map((d) => {
                const st = gpuStatus(d);
                return (
                  <button
                    type="button"
                    key={d.uuid}
                    className={`led-cell ${st}`}
                    style={{ background: STATUS_COLOR[st] }}
                    title={`GPU ${d.gpu} · ${d.model.replace("NVIDIA ", "")}\n사용률 ${Math.round(d.util_perc * 100)}% · ${d.temp_c}°C · ${d.power_w}W`}
                    onClick={() => onSelect?.(d)}
                    aria-label={`GPU ${d.gpu}, 사용률 ${Math.round(d.util_perc * 100)}%, 온도 ${d.temp_c}도, 상태 ${st}`}
                  >
                    {d.gpu}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
