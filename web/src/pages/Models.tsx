import { useCallback, useEffect, useState } from "react";
import { fetchHarborModels, fetchHarborStatus, fetchModelMetrics } from "../api/client";
import type { HarborModel, HarborStatus, ModelMetric } from "../api/types";
import type { Page } from "../components/Layout";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import Badge from "../components/Badge";
import { useCap } from "../capabilities";

// 서빙 중 모델 메트릭을 Harbor 레포 이름에 매칭(정규화 후 부분일치).
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function matchMetric(harborName: string, metrics: ModelMetric[]): ModelMetric | undefined {
  const h = norm(harborName);
  return metrics.find((m) => {
    const id = norm(m.model);
    return h.includes(id) || id.includes(h);
  });
}

// 모델 = Harbor 레지스트리에 보관된 모델(임포트→배포 대상). Nutanix Enterprise AI "Models" 패턴.
// NGC/HuggingFace/Upload 로 임포트 → Dynamo 가 Harbor 에서 pull 해 서빙.
const SOURCES = [
  { value: "ngc", title: "NVIDIA NGC Catalog", btn: "NGC 카탈로그에서 임포트", desc: "NVIDIA 검증 모델을 NGC 카탈로그에서 직접 가져옵니다.", ph: "예: nvcr.io/nim/meta/llama-3.1-8b" },
  { value: "hf", title: "Hugging Face Model Hub", btn: "Hugging Face에서 임포트", desc: "HuggingFace 모델을 Harbor 로 가져옵니다(다운로드→패키징→push).", ph: "예: Qwen/Qwen3-0.6B" },
  { value: "upload", title: "직접 업로드", btn: "수동 업로드", desc: "호환 포맷 모델을 파일/버킷에서 직접 업로드(개발: CLI push).", ph: "예: ./qwen3-0.6b" },
] as const;

const nf = new Intl.NumberFormat("ko-KR");
function human(bytes: number): string {
  if (!bytes) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

export default function Models({ onNavigate }: { onNavigate: (p: Page, model?: string) => void }) {
  const { can } = useCap();
  const canImport = can("models.write"); // 모델 임포트 권한
  const canDeploy = can("endpoints.write"); // 엔드포인트 생성 권한
  const [models, setModels] = useState<HarborModel[]>([]);
  const [status, setStatus] = useState<HarborStatus | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<HarborModel | null>(null);
  const [metrics, setMetrics] = useState<ModelMetric[]>([]);
  const [q, setQ] = useState("");
  const [proj, setProj] = useState("all"); // 프로젝트 필터
  const [deployFilter, setDeployFilter] = useState("all"); // 배포 상태 필터: all|deployed|undeployed

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [m, s, mm] = await Promise.all([
        fetchHarborModels(signal),
        fetchHarborStatus(signal).catch(() => null),
        fetchModelMetrics(signal).catch(() => null),
      ]);
      setModels(m.models);
      setAvailable(m.available);
      setStatus(s);
      setMetrics(mm?.models ?? []);
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const projects = [...new Set(models.map((m) => m.project))].sort();
  const visibleModels = models.filter((m) => {
    if (q.trim() && !`${m.name} ${m.full_ref} ${m.tags.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (proj !== "all" && m.project !== proj) return false;
    if (deployFilter !== "all") {
      const deployed = !!matchMetric(m.name, metrics)?.deployed;
      if (deployFilter === "deployed" && !deployed) return false;
      if (deployFilter === "undeployed" && deployed) return false;
    }
    return true;
  });

  return (
    <>
      <div className="page-head">
        <h1>모델</h1>
        <span className="crumb">모델 / 레지스트리(Harbor)</span>
        <div className="spacer" />
        {status?.registry && <span className="updated">레지스트리 {status.registry} · {nf.format(status.model_count ?? 0)}개</span>}
        {available && models.length > 0 && (
          <>
            <input className="search-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="모델 검색…" aria-label="모델 검색" />
            {projects.length > 1 && (
              <select className="range-select" value={proj} onChange={(e) => setProj(e.target.value)} aria-label="프로젝트 필터">
                <option value="all">프로젝트: 전체</option>
                {projects.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <select className="range-select" value={deployFilter} onChange={(e) => setDeployFilter(e.target.value)} aria-label="배포 상태 필터">
              <option value="all">상태: 전체</option>
              <option value="deployed">서빙 중</option>
              <option value="undeployed">미배포</option>
            </select>
          </>
        )}
        {canImport && <button type="button" className="btn-primary" onClick={() => onNavigate("model-import")}>+ 모델 임포트</button>}
      </div>

      {error && <div className="state error" role="alert">{error}</div>}
      {!available && !loading && (
        <div className="state" role="status">Harbor 레지스트리가 구성되지 않았습니다. (FABRIX_HARBOR_URL)</div>
      )}
      {!error && loading && models.length === 0 && <div className="state" role="status">모델 레지스트리를 불러오는 중…</div>}

      {/* 모델 있음 → 카드 그리드 */}
      {available && models.length > 0 && (
        <div className="model-grid">
          {visibleModels.length === 0 && <div className="empty">조건에 맞는 모델이 없습니다. 검색·필터를 완화해 보세요.</div>}
          {visibleModels.map((m) => {
            const mt = matchMetric(m.name, metrics);
            return (
            <div className="model-card" key={m.full_ref}>
              <div className="model-card-head">
                <Badge tone="teal">{m.project}</Badge>
                {mt?.deployed ? <Badge tone="green" dot>서빙 중</Badge> : <Badge tone="neutral">미배포</Badge>}
              </div>
              <h3 className="model-name">{m.name}</h3>
              {/* 기능 태그 (표준 메타) */}
              {mt && mt.features.length > 0 && (
                <div className="model-features">
                  {mt.features.map((f) => <span key={f} className="feat-tag">{f}</span>)}
                </div>
              )}
              <div className="model-meta">
                <span>{m.tags.length ? m.tags.join(", ") : "untagged"}</span>
                <span>·</span>
                <span>{human(m.size_bytes)}</span>
                <span>·</span>
                <span>pull {nf.format(m.pulls)}</span>
              </div>
              {/* 분해 단가 (입력/출력/캐시 — 비용 투명성) */}
              {mt && (mt.price_in > 0 || mt.price_out > 0) && (
                <div className="model-price" title="1M 토큰당 원 (자가호스팅 추정 단가)">
                  <span className="mp-seg"><i>입력</i><b>₩{mt.price_in}</b></span>
                  {mt.price_out > 0 && <span className="mp-seg"><i>출력</i><b>₩{mt.price_out}</b></span>}
                  {mt.price_cached > 0 && <span className="mp-seg mp-cached"><i>캐시</i><b>₩{mt.price_cached}</b></span>}
                  <span className="mp-unit">/ 1M tok</span>
                </div>
              )}
              {/* P4-6 운영 메트릭 칩 — 서빙 중인 모델에 한해 카드 전면 표시 */}
              {mt && (
                <div className="model-ops">
                  <span className="ops-chip" title="스트림 생성 속도(=1000/TPOT)"><b>{mt.deployed ? mt.tok_s.toFixed(0) : "—"}</b> tok/s</span>
                  <span className="ops-chip" title="첫 토큰 지연 p95"><b>{mt.deployed && mt.ttft_p95_ms > 0 ? mt.ttft_p95_ms : "—"}</b> ms TTFT</span>
                  <span className="ops-chip" title="컨텍스트 윈도우">{(mt.context_window / 1024).toFixed(0)}K ctx</span>
                  <span className="ops-chip" title="요구 GPU 수">GPU×{mt.gpu}</span>
                  <span className={`ops-chip pattern-${mt.pattern}`} title="서빙 패턴">{mt.pattern}</span>
                </div>
              )}
              <code className="model-id">{m.full_ref}</code>
              <div className="model-actions">
                {canDeploy && <button type="button" className="btn-primary" onClick={() => onNavigate("endpoints", m.name)}>엔드포인트 생성 →</button>}
                <button type="button" className="btn-ghost" onClick={() => setDetail(m)}>상세</button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* 비어있음 → No Models + 임포트 카드(Nutanix식) */}
      {available && !loading && models.length === 0 && (
        <>
          <div className="empty-models">
            <div className="empty-models-icon" aria-hidden="true">◇</div>
            <div className="empty-models-title">사용 가능한 모델이 없습니다</div>
            <div className="empty-models-desc">NVIDIA NGC·Hugging Face 에서 검증된 모델을 가져오거나, 파일/버킷에서 직접 업로드해 시작하세요. 가져온 모델은 Harbor 레지스트리에 저장되어 Dynamo 가 서빙합니다.</div>
          </div>
          {canImport && (
            <div className="import-cards">
              {SOURCES.map((s) => (
                <div className="card import-card" key={s.value}>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                  <button type="button" className="btn-primary" onClick={() => onNavigate("model-import")}>{s.btn}</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <SlidePanel
        open={!!detail}
        title={detail ? `모델 · ${detail.name}` : ""}
        subtitle={detail?.project}
        onClose={() => setDetail(null)}
        footer={detail && canDeploy ? <button type="button" className="btn-primary" onClick={() => { onNavigate("endpoints", detail.name); setDetail(null); }}>엔드포인트 생성 →</button> : undefined}
      >
        {detail && (
          <>
            <DetailRow label="이름">{detail.name}</DetailRow>
            <DetailRow label="프로젝트">{detail.project}</DetailRow>
            <DetailRow label="레퍼런스"><code>{detail.full_ref}</code></DetailRow>
            <DetailRow label="태그">{detail.tags.length ? detail.tags.join(", ") : "untagged"}</DetailRow>
            <DetailRow label="아티팩트">{nf.format(detail.artifacts)}</DetailRow>
            <DetailRow label="크기">{human(detail.size_bytes)}</DetailRow>
            <DetailRow label="Pull 수">{nf.format(detail.pulls)}</DetailRow>
            <DetailRow label="갱신">{detail.updated_at ? new Date(detail.updated_at).toLocaleString("ko-KR", { hour12: false }) : "—"}</DetailRow>
            {(() => {
              const mt = matchMetric(detail.name, metrics);
              if (!mt) return <p className="slide-note">Harbor 레지스트리 모델. 엔드포인트 생성 시 Dynamo 가 이 레퍼런스를 pull 해 서빙합니다. (운영 메트릭은 서빙 시작 후 표시됩니다.)</p>;
              return (
                <>
                  <DetailRow label="서빙 상태">{mt.deployed ? "서빙 중" : "미배포"}</DetailRow>
                  <DetailRow label="서빙 패턴">{mt.pattern} ({mt.serving})</DetailRow>
                  <DetailRow label="컨텍스트">{nf.format(mt.context_window)} 토큰</DetailRow>
                  <DetailRow label="요구 GPU">{mt.gpu}장</DetailRow>
                  <DetailRow label="생성 속도">{mt.deployed ? `${mt.tok_s.toFixed(1)} tok/s` : "—"}</DetailRow>
                  <DetailRow label="TTFT p95">{mt.deployed && mt.ttft_p95_ms > 0 ? `${mt.ttft_p95_ms}ms` : "—"}</DetailRow>
                  <DetailRow label="E2E p95">{mt.deployed && mt.e2e_p95_ms > 0 ? `${mt.e2e_p95_ms}ms` : "—"}</DetailRow>
                  <DetailRow label="요청(24h)">{nf.format(mt.requests)}</DetailRow>
                  <p className="slide-note">운영 메트릭은 dynamo_frontend(model 라벨) 실측 + 카탈로그 메타 조인입니다. tok/s = 1000/TPOT(스트림 속도).</p>
                </>
              );
            })()}
          </>
        )}
      </SlidePanel>
    </>
  );
}
