import { useCallback, useEffect, useRef, useState } from "react";
import { createEndpoint, deleteEndpoint, fetchEndpointLogs, fetchEndpoints, fetchHarborModels, fetchKeys, fetchOrg, issueKey, previewEndpoint } from "../api/client";
import type { EndpointLogs } from "../api/client";
import type { Endpoint, EndpointPreview, EndpointSpec, HarborModel, IssuedKey, OrgApp } from "../api/types";
import type { NavFn } from "../router";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import Badge from "../components/Badge";
import ConfirmDialog from "../components/ConfirmDialog";
import { useTableDensity, DensityToggle } from "../components/DensityToggle";
import SummaryStrip from "../components/SummaryStrip";
import DimensionBreakdown from "../components/DimensionBreakdown";
import type { MetricsBreakdownRow } from "../api/types";
import { useCap } from "../capabilities";
import InfoTip from "../components/InfoTip";

const CUSTOM = "__custom__";

const PATTERNS = [
  { value: "agg", label: "Aggregated (단일 워커)" },
  { value: "agg_router", label: "Aggregated + KV Router" },
  { value: "disagg", label: "Disaggregated (Prefill↔Decode·NIXL)" },
];

// 목적별 프리셋(Fireworks/Replicate 패턴) — 클릭 시 위저드 값 일괄 설정. 인지부하 최소화.
const PRESETS = [
  { key: "fast", icon: "⚡", title: "빠른 응답", desc: "낮은 지연 우선 · KV 라우터", set: { pattern: "agg_router", replicas: 2, gpu: 1, max_model_len: 8192 } },
  { key: "throughput", icon: "📈", title: "높은 처리량", desc: "대량 동시요청 · 라우터+멀티 replica", set: { pattern: "agg_router", replicas: 3, gpu: 2, max_model_len: 16384 } },
  { key: "minimal", icon: "🔹", title: "최소 구성", desc: "단일 워커 · 검증/개발용", set: { pattern: "agg", replicas: 1, gpu: 1, max_model_len: 4096 } },
] as const;

const empty: EndpointSpec = {
  name: "",
  model: "",
  served_name: "",
  pattern: "agg",
  replicas: 1,
  gpu: 1,
  max_model_len: 16384,
  app_id: "",
  dept_id: "",
  harbor_ref: "",
  access: "cluster",
  auto_shutdown: "off",
  speculative: false,
};

// 유휴 자동 종료 옵션 (Together AI Auto-shutdown 매핑) — 유휴 N 후 0 으로 스케일다운.
const AUTO_SHUTDOWN = [
  { value: "off", label: "사용 안 함 (상시 가동)" },
  { value: "15m", label: "15분" }, { value: "30m", label: "30분" },
  { value: "1h", label: "1시간" }, { value: "3h", label: "3시간" },
  { value: "6h", label: "6시간" }, { value: "12h", label: "12시간" }, { value: "24h", label: "24시간" },
];
// 자가호스팅 GPU 단가(추정) — H100 시간당 원. 비용 요약 산출용.
const GPU_KRW_PER_HOUR = 4500;

// 엔드포인트(모델 배포) — DynamoGraphDeployment CR 목록 + 생성 위저드.
// 안전: 생성은 기본 미리보기(서버 dry-run). 실제 적용은 명시적 확인. 삭제는 FABRIX 생성분만.
export default function Endpoints({ onNavigate }: { onNavigate?: NavFn }) {
  const { can } = useCap(); // 쓰기 권한: 생성·삭제 endpoints.write / 키 발급 keys.write
  const canDeploy = can("endpoints.write");
  const canIssueKey = can("keys.write");
  const [eps, setEps] = useState<Endpoint[]>([]);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);
  const [form, setForm] = useState<EndpointSpec>(empty);
  const [preview, setPreview] = useState<EndpointPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<Endpoint | null>(null);
  const [confirmDel, setConfirmDel] = useState<Endpoint | null>(null); // 삭제 확인 대상(비가역)
  const { density, setDensity } = useTableDensity("endpoints");
  // 선택지 소스: Harbor 모델 · 기존 앱 · 기존 부서.
  const [harborModels, setHarborModels] = useState<HarborModel[]>([]);
  const [orgApps, setOrgApps] = useState<OrgApp[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [advancedModel, setAdvancedModel] = useState(false); // 직접 HF id 입력(고급)
  const [keyModal, setKeyModal] = useState<Endpoint | null>(null);
  const [keyAppMode, setKeyAppMode] = useState<"select" | "custom">("select");
  const [keyForm, setKeyForm] = useState({ app_id: "", app_name: "", dept_id: "", key_name: "", model_scope: "", quota_rpm: "", quota_tpd: "" });
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  // P4-8 실시간 로그 팝업.
  const [logsFor, setLogsFor] = useState<Endpoint | null>(null);
  const [logs, setLogs] = useState<EndpointLogs | null>(null);
  const [logComponent, setLogComponent] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const logTimer = useRef<number | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetchEndpoints(signal);
      setEps(r.endpoints);
      setAvailable(r.available);
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 위저드 선택지: Harbor 모델 + 기존 부서(사용자에서) + 기존 앱(키에서). 한 번 로드.
  const loadChoices = useCallback(async (signal?: AbortSignal) => {
    try {
      const [hm, orgRes, keysRes] = await Promise.all([
        fetchHarborModels(signal).catch(() => ({ models: [], available: false })),
        fetchOrg(signal).catch(() => ({ depts: [], known_depts: [] })),
        fetchKeys("24h", signal).catch(() => ({ keys: [] })),
      ]);
      setHarborModels(hm.models ?? []);
      setDepts(orgRes.known_depts ?? []);
      const appMap = new Map<string, OrgApp>();
      for (const d of orgRes.depts ?? []) {
        for (const app of d.apps) appMap.set(app.app_id, app);
      }
      for (const k of keysRes.keys ?? []) {
        if (k.app_id && !appMap.has(k.app_id)) appMap.set(k.app_id, { app_id: k.app_id, name: k.app_name || k.app_id, dept_id: k.dept_id ?? "", keys: [] });
      }
      setOrgApps([...appMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
    } catch { /* 선택지 로드 실패는 비치명적 */ }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    loadChoices(ctrl.signal);
    return () => ctrl.abort();
  }, [load, loadChoices]);

  // Harbor 모델 선택 → harbor_ref/model/이름 자동 채움.
  const pickHarborModel = (fullRef: string) => {
    const m = harborModels.find((x) => x.full_ref === fullRef);
    if (!m) {
      setForm((f) => ({ ...f, harbor_ref: "", model: "" }));
      setPreview(null);
      return;
    }
    const ref = m.tags && m.tags.length ? `${m.full_ref}:${m.tags[0]}` : `${m.full_ref}:latest`;
    setForm((f) => ({
      ...f,
      harbor_ref: ref,
      model: m.name,
      served_name: f.served_name || m.name,
      name: f.name || `${m.name}-${f.pattern === "disagg" ? "disagg" : "agg"}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    }));
    setPreview(null);
  };

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewEndpoint(form));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await createEndpoint(form, true);
      setNotice(`엔드포인트 생성 적용됨: ${r.result}`);
      setWizard(false);
      setForm(empty);
      setPreview(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmDel) return;
    const { namespace: ns, name } = confirmDel;
    setBusy(true);
    try {
      await deleteEndpoint(ns, name);
      setNotice(`삭제됨: ${name}`);
      setConfirmDel(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 로그 팝업 — 컴포넌트 필터 + 수동/자동 새로고침.
  const loadLogs = useCallback(async (ep: Endpoint, component: string) => {
    setLogBusy(true);
    try {
      const r = await fetchEndpointLogs(ep.namespace, ep.name, component, 200);
      setLogs(r);
    } catch (e) {
      setLogs({ logs: "", components: [], ok: false, error: (e as Error).message });
    } finally {
      setLogBusy(false);
    }
  }, []);

  const openLogs = (ep: Endpoint) => {
    setLogsFor(ep);
    setLogComponent("");
    setLogs(null);
    setAutoRefresh(false);
    loadLogs(ep, "");
  };

  const closeLogs = () => {
    setLogsFor(null);
    setLogs(null);
    setAutoRefresh(false);
  };

  // 자동 새로고침 토글 — 5초 간격.
  useEffect(() => {
    if (logTimer.current) { window.clearInterval(logTimer.current); logTimer.current = null; }
    if (autoRefresh && logsFor) {
      logTimer.current = window.setInterval(() => loadLogs(logsFor, logComponent), 5000);
    }
    return () => { if (logTimer.current) window.clearInterval(logTimer.current); };
  }, [autoRefresh, logsFor, logComponent, loadLogs]);

  const openKeyModal = (endpoint: Endpoint) => {
    const first = orgApps[0];
    const scope = endpoint.model || endpoint.name;
    setKeyAppMode(first ? "select" : "custom");
    setKeyForm({
      app_id: first?.app_id ?? "",
      app_name: first?.name ?? "",
      dept_id: first?.dept_id ?? "",
      key_name: `${scope}-key`,
      model_scope: scope,
      quota_rpm: "",
      quota_tpd: "",
    });
    setIssued(null);
    setKeyModal(endpoint);
  };

  const onKeyAppChange = (value: string) => {
    if (value === CUSTOM) {
      setKeyAppMode("custom");
      setKeyForm((f) => ({ ...f, app_id: "", app_name: "", dept_id: "" }));
      return;
    }
    const app = orgApps.find((a) => a.app_id === value);
    setKeyAppMode("select");
    setKeyForm((f) => ({ ...f, app_id: value, app_name: app?.name ?? value, dept_id: app?.dept_id ?? "" }));
  };

  const issueEndpointKey = async () => {
    if (keyAppMode === "custom" && !keyForm.app_name.trim()) return;
    if (keyAppMode === "select" && !keyForm.app_id) return;
    setBusy(true);
    setError(null);
    try {
      const k = await issueKey({
        app_id: keyAppMode === "select" ? keyForm.app_id : undefined,
        app_name: keyForm.app_name,
        dept_id: keyForm.dept_id,
        key_name: keyForm.key_name,
        model_scope: keyForm.model_scope,
        quota_rpm: keyForm.quota_rpm ? Number(keyForm.quota_rpm) : undefined,
        quota_tpd: keyForm.quota_tpd ? Number(keyForm.quota_tpd) : undefined,
      });
      setIssued(k);
      setNotice(`API 키 발급됨: ${keyForm.app_name || keyForm.app_id} → ${keyForm.model_scope}`);
      loadChoices();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>엔드포인트</h1>
        <span className="crumb">모델 / 엔드포인트 배포</span>
        <div className="spacer" />
        <span className="updated">{eps.length}개</span>
        <DensityToggle density={density} onChange={setDensity} />
        {canDeploy && (
          <button type="button" className="btn-primary" onClick={() => { setWizard(true); setPreview(null); }} disabled={!available}>
            + 엔드포인트 생성
          </button>
        )}
      </div>

      {error && <div className="state error" role="alert">{error}</div>}
      {notice && <div className="state" role="status">{notice}</div>}
      {!available && (
        <div className="state" role="status">
          kubectl 미구성으로 엔드포인트 기능이 비활성입니다. (백엔드 FABRIX_KUBECTL/권한 확인)
        </div>
      )}

      {!error && loading && eps.length === 0 && <div className="state" role="status">엔드포인트를 불러오는 중…</div>}

      {eps.length > 0 && (
        <SummaryStrip items={[
          { label: "전체", value: eps.length },
          { label: "Active", value: eps.filter((e) => e.ready).length, tone: "green" },
          { label: "Pending", value: eps.filter((e) => !e.ready).length, tone: eps.some((e) => !e.ready) ? "amber" : "default" },
          { label: "총 replica", value: eps.reduce((s, e) => s + (e.replicas ?? 0), 0) },
        ]} />
      )}

      {/* L2 엔드포인트 차원 분해 — 엔드포인트별 트래픽/품질(최근 24시간), 행 클릭 → 트레이스. */}
      <DimensionBreakdown
        range="24h"
        title="엔드포인트 차원 분해 (L2 · 최근 24시간)"
        initialDim="endpoint"
        drillableDims={["model"]}
        onDrill={(row: MetricsBreakdownRow, dim: string) =>
          onNavigate?.("traces", { range: "24h", ...(dim === "model" ? { model: row.key } : {}) })
        }
      />

      <div className="card">
        <div className="card-head">
          <h3>배포된 엔드포인트 (DynamoGraphDeployment)</h3>
          <InfoTip>실 클러스터의 모델 배포 CR. FABRIX 생성분만 삭제할 수 있습니다(운영 보호).</InfoTip>
        </div>
        {eps.length === 0 && !loading ? (
          <div className="empty">배포된 엔드포인트가 없습니다. “+ 엔드포인트 생성”으로 모델을 배포하세요.</div>
        ) : (
          <table className={`usage-table density-${density}`}>
            <thead>
              <tr>
                <th>이름</th>
                <th>모델</th>
                <th>네임스페이스</th>
                <th>백엔드</th>
                <th className="num">replica</th>
                <th>상태</th>
                <th>관리</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {eps.map((e) => (
                <tr key={`${e.namespace}/${e.name}`} className="clickable" onClick={() => setDetail(e)}>
                  <td>{e.name}</td>
                  <td>{e.model || e.name}</td>
                  <td>{e.namespace}</td>
                  <td>{e.backend}</td>
                  <td className="num">{e.replicas}</td>
                  <td>{e.ready ? <Badge tone="green" dot>Active</Badge> : <Badge tone="amber" dot>Pending</Badge>}</td>
                  <td>{e.managed ? <Badge tone="pink">FABRIX</Badge> : <Badge tone="neutral">운영</Badge>}</td>
                  <td className="num row-actions">
                    <button type="button" className="btn-ghost btn-sm" onClick={(ev) => { ev.stopPropagation(); openLogs(e); }}>
                      로그
                    </button>
                    {canIssueKey && (
                      <button type="button" className="btn-ghost btn-sm" onClick={(ev) => { ev.stopPropagation(); openKeyModal(e); }}>
                        키 발급
                      </button>
                    )}
                    {e.managed && canDeploy && (
                      <button type="button" className="btn-danger-ghost" onClick={(ev) => { ev.stopPropagation(); setConfirmDel(e); }}>
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SlidePanel
        open={!!detail}
        title={detail ? `엔드포인트 · ${detail.name}` : ""}
        subtitle={detail?.namespace}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <DetailRow label="이름">{detail.name}</DetailRow>
            <DetailRow label="모델">{detail.model || detail.name}</DetailRow>
            <DetailRow label="네임스페이스">{detail.namespace}</DetailRow>
            <DetailRow label="백엔드">{detail.backend}</DetailRow>
            <DetailRow label="replica">{detail.replicas}</DetailRow>
            <DetailRow label="상태">{detail.ready ? <Badge tone="green" dot>Active</Badge> : <Badge tone="amber" dot>Pending</Badge>}</DetailRow>
            <DetailRow label="관리주체">{detail.managed ? <Badge tone="pink">FABRIX 생성</Badge> : <Badge tone="neutral">운영(보호)</Badge>}</DetailRow>
            <DetailRow label="생성">{detail.age ? new Date(detail.age).toLocaleString("ko-KR", { hour12: false }) : "—"}</DetailRow>
            <div className="slide-actions">
              <button type="button" className="btn-primary" onClick={() => openKeyModal(detail)}>이 모델에 API 키 추가</button>
              <button type="button" className="btn-ghost" onClick={() => openLogs(detail)}>실시간 로그 보기</button>
            </div>
            <p className="slide-note">{detail.managed ? "FABRIX 가 생성한 엔드포인트 — 삭제 가능." : "운영 리소스 — FABRIX 에서 삭제 불가(보호)."}</p>
          </>
        )}
      </SlidePanel>

      <ConfirmDialog
        open={!!confirmDel}
        title="엔드포인트 삭제"
        danger
        busy={busy}
        confirmLabel="삭제"
        message={
          <>
            <b>{confirmDel?.name}</b> 엔드포인트를 삭제합니다. 배포된 모델 서빙이 중단되며 <b>되돌릴 수 없습니다</b>.
          </>
        }
        onConfirm={remove}
        onCancel={() => setConfirmDel(null)}
      />

      {wizard && (
        <div className="modal-overlay" onClick={() => setWizard(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>엔드포인트 생성 위저드</h3>
              <button type="button" className="icon" aria-label="닫기" onClick={() => setWizard(false)}>✕</button>
            </div>
            <div className="preset-cards">
              {PRESETS.map((p) => {
                const active = form.pattern === p.set.pattern && form.replicas === p.set.replicas && form.gpu === p.set.gpu && form.max_model_len === p.set.max_model_len;
                return (
                  <button
                    type="button"
                    key={p.key}
                    className={`preset-card ${active ? "active" : ""}`}
                    onClick={() => { setForm({ ...form, ...p.set }); setPreview(null); }}
                  >
                    <span className="preset-icon" aria-hidden="true">{p.icon}</span>
                    <span className="preset-title">{p.title}</span>
                    <span className="preset-desc">{p.desc}</span>
                    <span className="preset-spec">replica {p.set.replicas} · GPU {p.set.gpu}</span>
                  </button>
                );
              })}
            </div>
            <div className="pg-field-row">
              <label className="pg-field"><span>이름 *</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: qwen3-mini-agg" /></label>
              <label className="pg-field"><span>패턴</span>
                <select className="range-select" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })}>
                  {PATTERNS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select></label>
            </div>
            {!advancedModel ? (
              <>
                <div className="pg-field-row">
                  <label className="pg-field">
                    <span>모델 * <small className="muted">(Harbor 레지스트리에서 선택)</small></span>
                    {harborModels.length === 0 ? (
                      <div className="state" role="status" style={{ margin: 0 }}>
                        Harbor에 모델이 없습니다.{" "}
                        {onNavigate && (
                          <button type="button" className="link" onClick={() => { setWizard(false); onNavigate("model-import"); }}>
                            모델 임포트 →
                          </button>
                        )}
                      </div>
                    ) : (
                      <select className="range-select" value={form.harbor_ref ? form.harbor_ref.replace(/:[^/:]+$/, "") : ""} onChange={(e) => pickHarborModel(e.target.value)}>
                        <option value="">— 모델 선택 —</option>
                        {harborModels.map((m) => (
                          <option key={m.full_ref} value={m.full_ref}>
                            {m.name}{m.tags?.length ? ` :${m.tags[0]}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                  <label className="pg-field"><span>노출명 (served name)</span>
                    <input value={form.served_name} onChange={(e) => setForm({ ...form, served_name: e.target.value })} placeholder="예: qwen3-mini" /></label>
                </div>
                {form.harbor_ref && (
                  <p className="modal-note" style={{ margin: "-4px 0 4px" }}>
                    기본 Harbor 레지스트리에서 pull: <code>{form.harbor_ref}</code>
                  </p>
                )}
                <p className="modal-note" style={{ margin: "-2px 0 4px" }}>
                  <button type="button" className="link" onClick={() => setAdvancedModel(true)}>고급: HuggingFace id 직접 입력</button>
                </p>
              </>
            ) : (
              <>
                <div className="pg-field-row">
                  <label className="pg-field"><span>모델 (HF id) *</span>
                    <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value, harbor_ref: "" })} placeholder="예: Qwen/Qwen3-0.6B" /></label>
                  <label className="pg-field"><span>노출명 (served name)</span>
                    <input value={form.served_name} onChange={(e) => setForm({ ...form, served_name: e.target.value })} placeholder="예: qwen3-mini" /></label>
                </div>
                <p className="modal-note" style={{ margin: "-2px 0 4px" }}>
                  HF id 로 직접 다운로드(Harbor 미경유).{" "}
                  <button type="button" className="link" onClick={() => { setAdvancedModel(false); setForm((f) => ({ ...f, model: "" })); }}>Harbor에서 선택으로 돌아가기</button>
                </p>
              </>
            )}
            <label className="pg-field"><span>추론 접근 방식</span>
              <select className="range-select" value={form.access} onChange={(e) => { setForm({ ...form, access: e.target.value }); setPreview(null); }}>
                <option value="cluster">ClusterIP — 인클러스터 전용 ({form.name || "<name>"}-api.{form.namespace || "dynamo-inference"}:8000)</option>
                <option value="nodeport">NodePort — 외부 노드 IP 로 노출(노드포트 자동 할당)</option>
              </select></label>
            <p className="modal-note" style={{ margin: "-4px 0 4px" }}>
              Dynamo 기본 Frontend 서비스는 system 포트만 노출하므로, OpenAI API(8000) 노출용 <code>{form.name || "<name>"}-api</code> 서비스를 함께 생성합니다.
            </p>
            <div className="pg-field-row">
              <label className="pg-field"><span>replica</span>
                <input type="number" min={1} value={form.replicas} onChange={(e) => setForm({ ...form, replicas: +e.target.value })} /></label>
              <label className="pg-field"><span>GPU/MIG 슬라이스</span>
                <input type="number" min={1} value={form.gpu} onChange={(e) => setForm({ ...form, gpu: +e.target.value })} /></label>
              <label className="pg-field"><span>max_model_len</span>
                <input type="number" min={1024} step={1024} value={form.max_model_len} onChange={(e) => setForm({ ...form, max_model_len: +e.target.value })} /></label>
            </div>
            <div className="pg-field-row">
              <label className="pg-field"><span>유휴 자동종료 <small className="muted">(KEDA scale-to-zero)</small></span>
                <select className="range-select" value={form.auto_shutdown} onChange={(e) => setForm({ ...form, auto_shutdown: e.target.value })}>
                  {AUTO_SHUTDOWN.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select></label>
              <label className="pg-field spec-toggle"><span>Speculative decoding <small className="muted">(vLLM Eagle3)</small></span>
                <label className="switch-row">
                  <input type="checkbox" checked={!!form.speculative} onChange={(e) => setForm({ ...form, speculative: e.target.checked })} />
                  <span>{form.speculative ? "사용 — 초안 모델(Eagle3)로 TTFT·throughput 개선" : "사용 안 함"}</span>
                </label></label>
            </div>
            {form.auto_shutdown !== "off" && (
              <p className="modal-note" style={{ margin: "-2px 0 4px", color: "var(--amber)" }}>
                ⓘ 유휴 시 0으로 축소(scale-to-zero)는 Dynamo 단독으로 안 되며, 이 엔드포인트에 <b>KEDA ScaledObject</b>를 함께 배포해야 동작합니다(KAI 스케줄러 클러스터에 KEDA 설치 전제). KEDA 미설치 시 정책만 기록됩니다.
              </p>
            )}

            {/* 상시 비용 요약 (Together AI Summary 매핑) — 모델·하드웨어 선택에 따라 실시간 추정 */}
            <div className="cost-summary" aria-live="polite">
              <div className="cs-head">예상 비용 <small>(자가호스팅 GPU 단가 기준 추정)</small></div>
              {(() => {
                const gpus = (form.gpu || 0) * (form.replicas || 0);
                const perHour = gpus * GPU_KRW_PER_HOUR;
                const perMin = perHour / 60;
                return (
                  <div className="cs-body">
                    <div className="cs-metric"><span>분당</span><b>₩{Math.round(perMin).toLocaleString()}</b></div>
                    <div className="cs-metric"><span>시간당</span><b>₩{perHour.toLocaleString()}</b></div>
                    <div className="cs-metric"><span>월(상시)</span><b>₩{Math.round(perHour * 730).toLocaleString()}</b></div>
                    <div className="cs-note">
                      GPU {form.gpu} × replica {form.replicas} = <b>{gpus} GPU</b>
                      {form.auto_shutdown !== "off" && <> · 유휴 {AUTO_SHUTDOWN.find((a) => a.value === form.auto_shutdown)?.label} 후 0 스케일다운 → 월 비용 절감</>}
                      {form.speculative && <> · speculative on</>}
                    </div>
                  </div>
                );
              })()}
            </div>
            {preview && (
              <div className="ep-preview">
                <div className={`ep-preview-status ${preview.dry_run_ok ? "ok" : "bad"}`} role="status">
                  <span>서버 검증 (kubectl dry-run)</span>
                  <b>{preview.dry_run_ok ? "✓ 통과" : "✗ 실패"}</b>
                  {preview.dry_run_ok && preview.dry_run_result && <em>{preview.dry_run_result}</em>}
                  {!preview.dry_run_ok && <em>{preview.dry_run_error}</em>}
                </div>
                <details className="ep-manifest-toggle">
                  <summary>생성될 매니페스트 보기</summary>
                  <pre className="manifest">{preview.manifest}</pre>
                </details>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setWizard(false)}>취소</button>
              <button type="button" className="btn-ghost" onClick={doPreview} disabled={busy || !form.name || !form.model}>
                {busy ? "검증 중…" : "미리보기 / 검증"}
              </button>
              <button type="button" className="btn-primary" onClick={doCreate} disabled={busy || !preview?.dry_run_ok}>
                생성 적용
              </button>
            </div>
            <div className="modal-note">‘생성 적용’은 실제 클러스터에 모델 배포 CR을 생성합니다(GPU 점유). 먼저 미리보기로 검증하세요.</div>
          </div>
        </div>
      )}

      {keyModal && (
        <div className="modal-overlay" onClick={() => setKeyModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>모델 API 키 추가</h3>
              <button type="button" className="icon" aria-label="닫기" onClick={() => setKeyModal(null)}>✕</button>
            </div>
            <div className="key-affinity">
              <span>배포 모델</span>
              <b>{keyModal.model || keyModal.name}</b>
              <span>에 앱별 키를 추가합니다.</span>
            </div>
            <label className="pg-field">
              <span>앱 *</span>
              <select className="range-select" value={keyAppMode === "custom" ? CUSTOM : keyForm.app_id} onChange={(e) => onKeyAppChange(e.target.value)}>
                {orgApps.map((a) => (
                  <option key={a.app_id} value={a.app_id}>
                    {a.name} ({a.app_id}){a.dept_id ? ` · ${a.dept_id}` : " · 미귀속"}
                  </option>
                ))}
                <option value={CUSTOM}>+ 새 앱 만들기</option>
              </select>
            </label>
            {keyAppMode === "custom" && (
              <label className="pg-field">
                <span>새 앱 이름 *</span>
                <input value={keyForm.app_name} onChange={(e) => setKeyForm({ ...keyForm, app_name: e.target.value })} placeholder="예: demo" />
              </label>
            )}
            <label className="pg-field">
              <span>조직/부서</span>
              <input list="endpoint-dept-options" value={keyForm.dept_id} onChange={(e) => setKeyForm({ ...keyForm, dept_id: e.target.value })} placeholder="미귀속 또는 부서 ID 입력" />
              <datalist id="endpoint-dept-options">
                {depts.map((d) => <option key={d} value={d} />)}
              </datalist>
            </label>
            <label className="pg-field">
              <span>모델 범위</span>
              <input value={keyForm.model_scope} onChange={(e) => setKeyForm({ ...keyForm, model_scope: e.target.value })} />
            </label>
            <label className="pg-field">
              <span>키 이름</span>
              <input value={keyForm.key_name} onChange={(e) => setKeyForm({ ...keyForm, key_name: e.target.value })} />
            </label>
            <div className="pg-field-row">
              <label className="pg-field">
                <span>쿼터 rpm</span>
                <input type="number" min={0} value={keyForm.quota_rpm} onChange={(e) => setKeyForm({ ...keyForm, quota_rpm: e.target.value })} placeholder="무제한" />
              </label>
              <label className="pg-field">
                <span>쿼터 tpd</span>
                <input type="number" min={0} value={keyForm.quota_tpd} onChange={(e) => setKeyForm({ ...keyForm, quota_tpd: e.target.value })} placeholder="무제한" />
              </label>
            </div>
            {issued && (
              <div className="key-reveal">
                <code>{issued.plaintext}</code>
                <button type="button" className="btn-ghost" onClick={() => navigator.clipboard?.writeText(issued.plaintext)}>복사</button>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setKeyModal(null)}>닫기</button>
              <button type="button" className="btn-primary" onClick={issueEndpointKey} disabled={busy || (keyAppMode === "select" ? !keyForm.app_id : !keyForm.app_name.trim())}>
                {busy ? "발급 중…" : "키 발급"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* P4-8 실시간 로그 팝업 (Backend.AI) */}
      {logsFor && (
        <div className="modal-overlay" onClick={closeLogs}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>로그 · {logsFor.name}</h3>
              <button type="button" className="icon" aria-label="닫기" onClick={closeLogs}>✕</button>
            </div>
            <div className="logs-toolbar">
              <label className="logs-comp">
                컴포넌트
                <select className="range-select" value={logComponent} onChange={(e) => { setLogComponent(e.target.value); loadLogs(logsFor, e.target.value); }}>
                  <option value="">전체</option>
                  {(logs?.components ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <span className="spacer" />
              <label className="logs-auto">
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                자동(5s)
              </label>
              <button type="button" className="btn-ghost btn-sm" onClick={() => loadLogs(logsFor, logComponent)} disabled={logBusy}>
                {logBusy ? "불러오는 중…" : "새로고침"}
              </button>
            </div>
            {logs && !logs.ok && <div className="state error" role="alert">로그 조회 실패: {logs.error}</div>}
            <pre className="logs-pane">{logBusy && !logs ? "로그를 불러오는 중…" : (logs?.logs?.trim() || "표시할 로그가 없습니다(파드 미기동 또는 출력 없음).")}</pre>
            <div className="modal-note">최근 200줄 tail · {logsFor.namespace}/{logsFor.name} 파드. 읽기 전용(증적 아님). 운영 ns 도 조회만 허용됩니다.</div>
          </div>
        </div>
      )}
    </>
  );
}
