import { useCallback, useEffect, useState } from "react";
import { fetchGPU, fetchGPUTimeseries } from "../api/client";
import type { GPUDevice, GPUReport, GPUTimeseries } from "../api/types";
import StatCard from "../components/StatCard";
import { SkeletonCards } from "../components/Skeleton";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import Sparkline from "../components/Sparkline";
import GpuLedGrid from "../components/GpuLedGrid";
import InfoTip from "../components/InfoTip";
import DataFreshness from "../components/DataFreshness";
import { humanizeError } from "../utils/errors";

const REFRESH_MS = 15_000;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const nf = new Intl.NumberFormat("ko-KR");

// 온도 임계 3단 컬러(상용SW-화면UIUX-리서치 P4-2): ≥87 위험, ≥80 주의.
function tempColor(t: number): string | undefined {
  if (t >= 87) return "var(--red)";
  if (t >= 80) return "var(--amber)";
  return undefined;
}
function utilCellColor(v: number): string | undefined {
  if (v >= 0.9) return "var(--red)";
  if (v >= 0.6) return "var(--amber)";
  return undefined;
}

function effTone(v: number): "green" | "amber" | "red" {
  if (v >= 0.7) return "green";
  if (v >= 0.4) return "amber";
  return "red";
}
function barColor(v: number): string {
  if (v >= 0.85) return "var(--red)";
  if (v >= 0.6) return "var(--amber)";
  return "var(--primary)";
}

// GPU/MIG 관제(문서 4-4) + MIG 효율 스코어(3-4). DCGM 실측 per-GPU.
export default function Gpu() {
  const [rep, setRep] = useState<GPUReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [detail, setDetail] = useState<GPUDevice | null>(null);
  // 드릴다운 tier-3: 선택 GPU 의 시계열.
  const [ts, setTs] = useState<GPUTimeseries | null>(null);
  const [tsLoading, setTsLoading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetchGPU(signal);
      setRep(r);
      setLastLoaded(Date.now());
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  // GPU 행/LED 선택 → 시계열 드릴다운 로드.
  const openDetail = useCallback((d: GPUDevice) => {
    setDetail(d);
    setTs(null);
    setTsLoading(true);
    fetchGPUTimeseries(d.uuid)
      .then(setTs)
      .catch(() => setTs(null))
      .finally(() => setTsLoading(false));
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    const id = setInterval(() => load(), REFRESH_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, [load]);

  const s = rep?.summary;
  const devices = rep?.devices ?? [];
  // 평균/최고 온도 — 디바이스 실측에서 산출(요약에 별도 필드 없음). 기준선: ≥80 주의, ≥87 위험.
  const avgTemp = devices.length ? Math.round(devices.reduce((a, d) => a + d.temp_c, 0) / devices.length) : 0;
  const maxTemp = devices.length ? Math.max(...devices.map((d) => d.temp_c)) : 0;
  const tempTone = maxTemp >= 87 ? "red" : maxTemp >= 80 ? "amber" : "green";

  return (
    <>
      <div className="page-head">
        <h1>GPU / MIG</h1>
        <span className="crumb">인프라 / GPU·MIG</span>
        <div className="spacer" />
        <DataFreshness updatedAt={lastLoaded} intervalMs={REFRESH_MS} />
        <button type="button" className="refresh-btn" onClick={() => load()} aria-label="GPU 새로고침">
          <span className="spin" aria-hidden="true">⟳</span>
          새로고침
        </button>
      </div>

      {error && <div className="state error" role="alert">GPU 지표를 불러오지 못했습니다. ({error})</div>}
      {!error && loading && !rep && <SkeletonCards count={6} />}

      {s && (
        <div className="cards-6">
          <StatCard title="총 GPU" info="DCGM 으로 관측된 물리 GPU 수" metrics={[{ label: `${s.hosts}개 호스트`, value: nf.format(s.total_gpus) }]} />
          <StatCard title="평균 사용률" info="DCGM_FI_DEV_GPU_UTIL 평균" metrics={[{ label: "GPU util", value: pct(s.avg_util), bar: s.avg_util, barColor: barColor(s.avg_util) }]} />
          <StatCard title="평균 메모리" info="FB_USED / (USED+FREE) 평균" metrics={[{ label: "VRAM", value: pct(s.avg_mem), bar: s.avg_mem, barColor: barColor(s.avg_mem) }]} />
          <StatCard title="총 전력" info="DCGM_FI_DEV_POWER_USAGE 합" metrics={[{ label: "Watt", value: nf.format(s.total_power_w), unit: "W" }]} />
          <StatCard title="평균 MIG 효율" info="GR_ENGINE_ACTIVE — 슬라이스 실효 가동(3-4)" metrics={[{ label: "효율", value: s.avg_mig_eff.toFixed(2), tone: effTone(s.avg_mig_eff), bar: s.avg_mig_eff, barColor: barColor(s.avg_mig_eff) }]} />
          <StatCard
            title="유휴 할당 갭"
            info="VRAM 50%+ 점유 중인데 util<10% = 모델이 올라갔지만 연산하지 않는 GPU. 자원 낭비 신호(Run:ai idle allocation gap)."
            metrics={[{ label: "GPU 수", value: nf.format(s.idle_alloc_gap), unit: `/ ${s.total_gpus}`, tone: s.idle_alloc_gap > 0 ? "amber" : "green" }]}
          />
          <StatCard
            title="온도"
            info="디바이스 실측 평균/최고. 기준: 80°C 이상 주의, 87°C 이상 위험."
            metrics={[
              { label: "평균", value: avgTemp, unit: "°C" },
              { label: "최고", value: maxTemp, unit: "°C", tone: tempTone },
            ]}
          />
        </div>
      )}

      {rep && <GpuLedGrid devices={devices} onSelect={openDetail} />}

      {rep && (
        <div className="card">
          <div className="card-head">
            <h3>GPU 디바이스 ({rep.source === "live" ? "DCGM 실측" : "mock"})</h3>
            <InfoTip>MIG 효율 = GR_ENGINE_ACTIVE. 낮으면 슬라이스 과할당/유휴(문서 3-4).</InfoTip>
            <span className="spacer" />
            <span className="updated">{devices.length}개 디바이스</span>
          </div>
          {devices.length === 0 ? (
            <div className="empty">관측된 GPU가 없습니다.</div>
          ) : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="데이터 표 — 좌우 스크롤 가능">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>호스트</th>
                  <th>GPU</th>
                  <th>모델</th>
                  <th className="num">사용률</th>
                  <th className="num">메모리</th>
                  <th className="num">온도</th>
                  <th className="num">전력</th>
                  <th className="num">Tensor</th>
                  <th className="num">MIG 효율</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.uuid} className="clickable" onClick={() => openDetail(d)}>
                    <td>{d.hostname}</td>
                    <td className="num">{d.gpu}</td>
                    <td title={d.model}>{d.model.replace("NVIDIA ", "").replace(" Server Edition", "")}</td>
                    <td className="num" style={{ color: utilCellColor(d.util_perc), fontWeight: utilCellColor(d.util_perc) ? 600 : undefined }}>{pct(d.util_perc)}</td>
                    <td className="num">{pct(d.mem_perc)}</td>
                    <td className="num" style={{ color: tempColor(d.temp_c), fontWeight: tempColor(d.temp_c) ? 600 : undefined }}>{d.temp_c}°C</td>
                    <td className="num">{d.power_w}W</td>
                    <td className="num">{pct(d.tensor_active)}</td>
                    <td className="num">
                      <span className={`tag tag-${effTone(d.mig_efficiency) === "green" ? "green" : effTone(d.mig_efficiency) === "amber" ? "amber" : "red"}`}>
                        {d.mig_efficiency.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      <SlidePanel
        open={!!detail}
        title={detail ? `GPU 상세 — ${detail.hostname} / GPU ${detail.gpu}` : ""}
        subtitle="DCGM 실측 · 최근 60분 추세 (드릴다운 tier-3)"
        onClose={() => { setDetail(null); setTs(null); }}
      >
        {detail && (
          <>
            <div className="gpu-dd-series">
              {tsLoading && <p className="rank-empty">시계열을 불러오는 중…</p>}
              {!tsLoading && ts && ts.points.length > 1 && (
                <>
                  <div className="gpu-dd-row">
                    <span className="gpu-dd-label">사용률</span>
                    <Sparkline values={ts.points.map((p) => p.util)} color="var(--primary)" width={260} height={34} />
                    <span className="gpu-dd-cur">{pct(detail.util_perc)}</span>
                  </div>
                  <div className="gpu-dd-row">
                    <span className="gpu-dd-label">VRAM</span>
                    <Sparkline values={ts.points.map((p) => p.mem)} color="var(--teal)" width={260} height={34} />
                    <span className="gpu-dd-cur">{pct(detail.mem_perc)}</span>
                  </div>
                  <div className="gpu-dd-row">
                    <span className="gpu-dd-label">온도</span>
                    <Sparkline values={ts.points.map((p) => p.temp_c)} color="var(--amber)" width={260} height={34} />
                    <span className="gpu-dd-cur">{detail.temp_c}°C</span>
                  </div>
                  <div className="gpu-dd-row">
                    <span className="gpu-dd-label">전력</span>
                    <Sparkline values={ts.points.map((p) => p.power_w)} color="var(--pink)" width={260} height={34} />
                    <span className="gpu-dd-cur">{detail.power_w}W</span>
                  </div>
                </>
              )}
              {!tsLoading && (!ts || ts.points.length <= 1) && (
                <p className="rank-empty">이 GPU의 시계열 데이터가 아직 충분하지 않습니다.</p>
              )}
            </div>

            <DetailRow label="모델">{detail.model}</DetailRow>
            <DetailRow label="UUID"><code>{detail.uuid}</code></DetailRow>
            <DetailRow label="메모리">{pct(detail.mem_perc)} ({nf.format(detail.mem_used_mb)} / {nf.format(detail.mem_total_mb)} MB)</DetailRow>
            <DetailRow label="SM Active">{pct(detail.sm_active)}</DetailRow>
            <DetailRow label="Tensor Active">{pct(detail.tensor_active)}</DetailRow>
            <DetailRow label="GR_ENGINE 효율">{detail.mig_efficiency.toFixed(3)}</DetailRow>

            {/* MIG 슬라이스 — 현재 클러스터는 미파티션(전체 GPU 모드). 사실대로 표시. */}
            <div className="gpu-mig-note">
              {rep?.summary.mig_enabled ? (
                <>이 GPU는 <b>MIG 파티션 활성</b> 상태입니다. 슬라이스별 GPU_I_PROFILE·테넌트 할당은 per-slice 메트릭으로 표시됩니다.</>
              ) : (
                <>이 GPU는 <b>MIG 미파티션(전체 GPU 모드)</b>입니다. RTX PRO 6000 Blackwell은 현재 슬라이스로 분할돼 있지 않아 GPU_I_PROFILE 라벨이 없습니다 — 슬라이스 bargauge 대신 전체 GPU의 GR_ENGINE 실효 가동률({detail.mig_efficiency.toFixed(2)})로 효율을 표시합니다. MIG 활성화 시 슬라이스 단위로 자동 확장됩니다.</>
              )}
            </div>
          </>
        )}
      </SlidePanel>
    </>
  );
}
