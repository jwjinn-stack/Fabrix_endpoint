import { useCallback, useEffect, useState } from "react";
import { createUser, deleteUser, fetchUsers, updateUser, fetchAlertConfig, setAlertWebhook, fetchAlertRules, createAlertRule, deleteAlertRule, fetchAlertRulePreview } from "../api/client";
import type { User, AlertConfig, AlertRule, AlertMetricMeta, AlertMetric, AlertOp, AlertWindow, AlertRuleState } from "../api/types";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import Badge, { type BadgeTone } from "../components/Badge";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import { SkeletonRows } from "../components/Skeleton";
import ReconfigurePanel from "../components/ReconfigurePanel";
import { useCap } from "../capabilities";
import { BRAND_PRESETS, deriveBrand, useBrand } from "../theme";
import {
  loadModelConfig, saveModelConfig, probeModel, resolveConnState, isMockMode, DYNAMO_PRESET,
  type ModelConnConfig, type ProbeResult,
} from "../api/modelConnection";
import InfoTip from "../components/InfoTip";
import { humanizeError } from "../utils/errors";
import { useToast } from "../toast";
import { useFieldValidation, required } from "../utils/useFieldValidation";
import FieldError from "../components/FieldError";

// 외관 · 브랜드 색상 — 고객사 표준 색상에 맞춰 전체 강조색(--primary 계열)을 전환.
function BrandColorCard() {
  const { brand, setBrand } = useBrand();
  return (
    <div className="card">
      <div className="card-head">
        <h3>외관 · 브랜드 색상</h3>
        <InfoTip>강조색(버튼·링크·차트·선택 상태)을 고객사 표준 색상으로 전환합니다. 이 브라우저에 저장됩니다.</InfoTip>
      </div>
      <p className="policy-hint" style={{ marginTop: 0 }}>
        고객사 표준 색상에 맞춰 전체 UI 강조색이 즉시 바뀝니다. 라이트·다크 모드 공통으로 적용되며 이 브라우저에 저장됩니다.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)", alignItems: "stretch" }}>
        {BRAND_PRESETS.map((p) => {
          const active = brand.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setBrand(p)}
              aria-pressed={active}
              title={p.name}
              style={{
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                border: `1px solid ${active ? "var(--primary)" : "var(--border-strong)"}`,
                boxShadow: active ? "0 0 0 2px var(--primary-weak)" : "none",
                borderRadius: 8, padding: "7px 12px", background: "var(--surface)", font: "inherit", fontSize: "var(--fs-sm)",
              }}
            >
              <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", background: p.primary, border: "1px solid var(--border)", flex: "none" }} />
              <span style={{ color: "var(--text)" }}>{p.name}</span>
              {active && <span aria-hidden="true" style={{ color: "var(--primary)", fontWeight: 700 }}>✓</span>}
            </button>
          );
        })}
        {/* 커스텀 HEX — 임의 색에서 strong/weak/lite 자동 파생 */}
        <label
          title="임의 색상 지정"
          style={{
            display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            border: `1px solid ${brand.id === "custom" ? "var(--primary)" : "var(--border-strong)"}`,
            boxShadow: brand.id === "custom" ? "0 0 0 2px var(--primary-weak)" : "none",
            borderRadius: 8, padding: "7px 12px", background: "var(--surface)", fontSize: "var(--fs-sm)",
          }}
        >
          <input
            type="color"
            value={brand.primary}
            onChange={(e) => setBrand(deriveBrand(e.target.value))}
            aria-label="커스텀 브랜드 색상"
            style={{ width: 22, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer" }}
          />
          <span style={{ color: "var(--text)" }}>커스텀</span>
          {brand.id === "custom" && <code style={{ fontSize: "var(--fs-xs)" }}>{brand.primary}</code>}
        </label>
      </div>
      <div className="policy-hint">미리보기 — 현재 강조색: <button type="button" className="btn-primary btn-sm" style={{ marginLeft: 6 }}>버튼</button> <a href="#" onClick={(e) => e.preventDefault()} style={{ marginLeft: "var(--sp-2)" }}>링크 예시</a></div>
    </div>
  );
}

// 아웃바운드 알림 채널 — 예산·임계 초과 시 제네릭 Webhook 으로 능동 통지(IMP-15).
// manage 전용(credentials cap). 폐쇄망에서는 반드시 내부 relay URL(외부 SaaS 직결 금지).
export function AlertWebhookCard() {
  const toast = useToast();
  const [cfg, setCfg] = useState<AlertConfig | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setCfg(await fetchAlertConfig(signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setCfg(null);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const save = async (next: string) => {
    setBusy(true);
    try {
      const r = await setAlertWebhook(next);
      toast.success(r.webhook_configured ? "Webhook 채널을 등록했습니다." : "Webhook 채널을 해제했습니다.");
      (r.warnings ?? []).forEach((w) => toast.error(w));
      setUrl("");
      load();
    } catch (e) {
      toast.error(humanizeError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>아웃바운드 알림 · Webhook</h3>
        <InfoTip>키별 예산·임계 초과 시 등록된 Webhook(JSON POST)으로 통지합니다. 비밀·평문 키는 페이로드에 포함되지 않으며(해시 토큰), 키별 “초과 시 통지” 토글이 켜진 키만 발송됩니다.</InfoTip>
      </div>
      <p className="policy-hint" style={{ marginTop: 0 }}>
        상태: {cfg?.webhook_configured ? <Badge tone="green" dot>등록됨</Badge> : <Badge tone="neutral" dot>미등록</Badge>}
        {" "}· 폐쇄망에서는 <b>내부 relay URL</b> 만 사용하세요(외부 SaaS 직결 금지). http/https 만 허용, 내부 메타데이터/루프백 주소는 거부됩니다.
      </p>
      <label className="pg-field">
        <span>Webhook URL</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://relay.internal.example.com/fabrix-alerts" />
      </label>
      <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="btn-primary" disabled={busy || !url.trim()} onClick={() => save(url.trim())}>{busy ? "저장 중…" : "등록"}</button>
        {cfg?.webhook_configured && <button type="button" className="btn-ghost" disabled={busy} onClick={() => save("")}>해제</button>}
      </div>
      {cfg && cfg.audit.length > 0 && (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="발송 이력">
          <table className="usage-table">
            <thead><tr><th>시각</th><th>채널</th><th>이벤트</th><th>토큰(해시)</th><th>결과</th></tr></thead>
            <tbody>
              {cfg.audit.slice(0, 10).map((r, i) => (
                <tr key={i}>
                  <td>{new Date(r.ts).toLocaleString("ko-KR", { hour12: false })}</td>
                  <td>{r.channel}</td>
                  <td>{r.event}</td>
                  <td><code>{r.token}</code></td>
                  <td>{r.ok ? <Badge tone="green" dot>성공</Badge> : <Badge tone="red" dot>실패</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// IMP-82 — 로컬 추론 모델(Dynamo) 연결 설정 카드. BrandColorCard/AlertWebhookCard 의 localStorage 패턴.
//   엔드포인트 URL·모델 식별자·타임아웃 + Dynamo :8000 프리셋 + "연결 테스트"(/health·/v1/models 프로브).
//   canConfig=manage 에서만 편집(observe 는 읽기 전용). 저장값은 config(시크릿 아님) — 본문 로깅 없음.
//   **정직성**: mock 모드면 "실 연결 안 됨"을 명시하고, 저장은 VITE_MOCK=off 실경로에서만 효력이 있음을 알린다.
export function LocalModelCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const mock = isMockMode();
  const [cfg, setCfg] = useState<ModelConnConfig>(() => loadModelConfig());
  const [form, setForm] = useState<ModelConnConfig>(() => loadModelConfig());
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);

  const dirty = form.endpoint !== cfg.endpoint || form.model !== cfg.model || form.timeoutMs !== cfg.timeoutMs;

  const save = () => {
    const next: ModelConnConfig = {
      endpoint: form.endpoint.trim(),
      model: form.model.trim(),
      timeoutMs: form.timeoutMs > 0 ? form.timeoutMs : 8000,
    };
    saveModelConfig(next);
    setCfg(next);
    setForm(next);
    toast.success("로컬 모델 연결 설정을 저장했습니다(이 브라우저).");
  };

  const applyPreset = () => setForm({ ...DYNAMO_PRESET, model: form.model });

  // 연결 테스트 — 입력된 값으로 즉시 프로브(저장과 별개, 인라인 리포트). read-only.
  const test = async () => {
    if (!form.endpoint.trim()) { toast.error("엔드포인트 URL 을 입력하세요."); return; }
    setTesting(true);
    setProbe(null);
    try {
      const r = await probeModel({ endpoint: form.endpoint.trim(), model: form.model.trim(), timeoutMs: form.timeoutMs || 8000 });
      setProbe(r);
    } catch {
      // probeModel 은 throw 하지 않도록 설계됐지만 방어적으로 offline 표기.
      setProbe({ healthOk: false, models: [], resolvedModel: null, modelMatch: false, latencyMs: 0, ttftMs: null, error: "프로브 실패" });
    } finally {
      setTesting(false);
    }
  };

  // 프로브 결과를 상태로 해석(mock=false 강제 — 실제 프로브 결과를 정직히 보여준다).
  const conn = probe ? resolveConnState(probe, { endpoint: form.endpoint.trim(), model: form.model.trim(), timeoutMs: form.timeoutMs || 8000 }, false) : null;

  return (
    <div className="card">
      <div className="card-head">
        <h3>로컬 추론 모델 연결</h3>
        <InfoTip>AI Agent·클러스터 인사이트가 근거로 삼는 로컬 추론 모델(Dynamo, OpenAI-호환)의 엔드포인트·모델·타임아웃을 지정합니다. 상태 확인은 /health(200)와 /v1/models(로드 모델)만 읽는 저비용 read-only 프로브입니다. 이 브라우저에 저장됩니다.</InfoTip>
      </div>
      <p className="policy-hint" style={{ marginTop: 0 }}>
        {mock
          ? <>현재 <b>mock 모드</b>입니다 — 실제 모델에 연결되지 않으며 결과는 결정적 mock 데이터입니다. 아래 설정은 <code>VITE_MOCK=off</code> 실경로에서만 효력이 있습니다(정직 표기 유지).</>
          : <>설정된 엔드포인트의 <code>/health</code>·<code>/v1/models</code>로 연결 상태와 로드 모델을 확인합니다. Dynamo 는 통상 별도 <code>:8000</code> 추론 서비스입니다.</>}
      </p>

      <label className="pg-field">
        <span>엔드포인트 URL</span>
        <input
          value={form.endpoint}
          onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
          placeholder="http://localhost:8000"
          disabled={!canEdit}
        />
      </label>
      <div className="pg-field-row">
        <label className="pg-field">
          <span>모델 식별자</span>
          <input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="예: Qwen/Qwen2.5-7B-Instruct (비우면 첫 로드 모델)"
            disabled={!canEdit}
          />
        </label>
        <label className="pg-field">
          <span>타임아웃(ms)</span>
          <input
            value={String(form.timeoutMs)}
            onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
            inputMode="numeric"
            disabled={!canEdit}
          />
        </label>
      </div>

      {!canEdit && <p className="policy-hint" style={{ marginTop: 0 }}>읽기 전용(observe) 프로파일입니다 — 편집은 manage 프로파일에서만 가능합니다.</p>}

      <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
        {canEdit && <button type="button" className="btn-ghost" onClick={applyPreset}>Dynamo :8000 프리셋</button>}
        {canEdit && <button type="button" className="btn-primary" onClick={save} disabled={!dirty}>저장</button>}
        <button type="button" className="btn-ghost" onClick={test} disabled={testing || !form.endpoint.trim()}>
          {testing ? "테스트 중…" : "연결 테스트"}
        </button>
      </div>

      {/* 연결 테스트 인라인 리포트 — /health·/v1/models 결과. 색 비의존(Badge dot + 텍스트). */}
      {conn && (
        <div className="policy-hint" role="status" style={{ marginBottom: 0 }}>
          <Badge tone={conn.tone} dot>{conn.label}</Badge>{" "}
          <span className="muted">{conn.detail}</span>
          {conn.latencyMs != null && <span className="muted"> · 왕복 {conn.latencyMs}ms</span>}
        </div>
      )}
    </div>
  );
}

// 지표 기반 알림 룰(IMP-36) — latency p95·error rate·guard block rate 임계 알림.
// 발송은 IMP-15 디스패처를 재사용한다(새 아웃바운드 경로 없음). canEdit=manage 에서만 생성/삭제.
const STATE_TONE: Record<AlertRuleState, BadgeTone> = { OK: "green", WARNING: "amber", ALERT: "red", NO_DATA: "neutral", PAUSED: "neutral" };
const OP_LABEL: Record<AlertOp, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };
const WINDOWS: AlertWindow[] = ["5m", "1h", "1d"];

export function AlertRulesCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [metrics, setMetrics] = useState<AlertMetricMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; metric: AlertMetric; op: AlertOp; alert_threshold: string; window: AlertWindow; severity: "info" | "warning" | "critical" }>(
    { name: "", metric: "error_rate", op: "gt", alert_threshold: "0.05", window: "5m", severity: "warning" },
  );
  const [preview, setPreview] = useState<{ value: number; has_data: boolean } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetchAlertRules(signal);
      setRules(r.rules);
      setMetrics(r.metrics);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // live current-value preview — 선택한 metric×window 의 "지금 값"을 보여줘 임계 설정 신뢰를 높인다.
  useEffect(() => {
    const ctrl = new AbortController();
    setPreview(null);
    fetchAlertRulePreview(form.metric, form.window, ctrl.signal)
      .then((p) => setPreview({ value: p.value, has_data: p.has_data }))
      .catch(() => { /* preview 실패는 무시 */ });
    return () => ctrl.abort();
  }, [form.metric, form.window]);

  const submit = async () => {
    const thr = Number(form.alert_threshold);
    if (!form.name.trim() || Number.isNaN(thr)) { toast.error("이름과 임계값을 확인하세요."); return; }
    setBusy(true);
    try {
      await createAlertRule({ name: form.name.trim(), metric: form.metric, op: form.op, alert_threshold: thr, window: form.window, severity: form.severity, enabled: true });
      toast.success(`알림 룰 “${form.name.trim()}”을(를) 추가했습니다.`);
      setShowForm(false);
      setForm({ name: "", metric: "error_rate", op: "gt", alert_threshold: "0.05", window: "5m", severity: "warning" });
      load();
    } catch (e) { toast.error(humanizeError((e as Error).message)); } finally { setBusy(false); }
  };

  const remove = async (rule: AlertRule) => {
    setBusy(true);
    try {
      await deleteAlertRule(rule.id);
      toast.success(`알림 룰 “${rule.name}”을(를) 삭제했습니다.`);
      load();
    } catch (e) { toast.error(humanizeError((e as Error).message)); } finally { setBusy(false); }
  };

  const metricTitle = (m: AlertMetric) => metrics.find((x) => x.key === m)?.title ?? m;
  const previewUnit = metrics.find((x) => x.key === form.metric)?.unit ?? "";

  return (
    <div className="card">
      <div className="card-head">
        <h3>지표 기반 알림 룰</h3>
        <InfoTip>지연(TTFT p95)·에러율·가드 차단율 등 지표가 임계를 넘으면 등록된 Webhook 으로 통지합니다(예산/토큰 임계와 별개). 빈 window 에서는 발화하지 않으며(NO_DATA), 진동 방지를 위해 복구 윈도를 둡니다. 발송 경로는 아웃바운드 Webhook 채널을 공유합니다.</InfoTip>
      </div>
      {loading ? (
        <div className="table-scroll"><SkeletonRows rows={3} cols={5} /></div>
      ) : rules.length === 0 ? (
        <div className="empty">등록된 알림 룰이 없습니다.{canEdit ? " “+ 룰 추가”로 등록하세요." : ""}</div>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="알림 룰 목록">
          <table className="usage-table">
            <thead><tr><th>이름</th><th>지표</th><th>조건</th><th>윈도</th><th>상태</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{metricTitle(r.metric)}</td>
                  <td><code>{OP_LABEL[r.op]} {r.alert_threshold}</code>{r.warn_threshold != null && <span className="muted"> (warn {r.warn_threshold})</span>}</td>
                  <td>{r.window}</td>
                  <td>{r.enabled ? <Badge tone={STATE_TONE[(r.state ?? "OK")]} dot>{r.state ?? "OK"}</Badge> : <Badge tone="neutral" dot>비활성</Badge>}</td>
                  {canEdit && <td className="num"><button type="button" className="btn-danger-ghost" onClick={() => remove(r)} disabled={busy}>삭제</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && !showForm && (
        <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
          <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>+ 룰 추가</button>
        </div>
      )}
      {canEdit && showForm && (
        <div style={{ marginTop: "var(--sp-3)", borderTop: "1px solid var(--border)", paddingTop: "var(--sp-3)" }}>
          <label className="pg-field"><span>룰 이름</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 에러율 급증" /></label>
          <div className="pg-field-row">
            <label className="pg-field"><span>지표</span>
              <select className="range-select" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value as AlertMetric })}>
                {metrics.map((m) => <option key={m.key} value={m.key}>{m.title}</option>)}
              </select></label>
            <label className="pg-field"><span>연산자</span>
              <select className="range-select" value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value as AlertOp })}>
                {(["gt", "gte", "lt", "lte"] as AlertOp[]).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
              </select></label>
            <label className="pg-field"><span>임계값</span>
              <input value={form.alert_threshold} onChange={(e) => setForm({ ...form, alert_threshold: e.target.value })} inputMode="decimal" /></label>
            <label className="pg-field"><span>윈도</span>
              <select className="range-select" value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value as AlertWindow })}>
                {WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select></label>
            <label className="pg-field"><span>심각도</span>
              <select className="range-select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as "info" | "warning" | "critical" })}>
                <option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option>
              </select></label>
          </div>
          <p className="policy-hint" style={{ marginTop: 0 }} data-testid="rule-preview">
            현재 값({metricTitle(form.metric)}, {form.window}): {preview == null ? "측정 중…" : preview.has_data ? <b>{preview.value.toLocaleString("ko-KR", { maximumFractionDigits: 4 })} {previewUnit}</b> : <span className="muted">데이터 없음(NO_DATA)</span>}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>취소</button>
            <button type="button" className="btn-primary" onClick={submit} disabled={busy}>{busy ? "추가 중…" : "룰 추가"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { admin: "관리자(Admin)", user: "일반(User)", super: "슈퍼(Super)" };
const ROLE_TONE: Record<string, BadgeTone> = { admin: "red", super: "pink", user: "green" };
// 권한 등급(높을수록 강함) — 상향 시 확인 다이얼로그를 띄우는 기준.
const ROLE_RANK: Record<string, number> = { user: 0, super: 1, admin: 2 };
const isEscalation = (from: string, to: string) => (ROLE_RANK[to] ?? 0) > (ROLE_RANK[from] ?? 0);

function roleTag(role: string) {
  return <Badge tone={ROLE_TONE[role] ?? "neutral"}>{ROLE_LABEL[role] ?? role}</Badge>;
}

// 역할 × 권한 참조 매트릭스(Langfuse 패턴) — 읽기 전용 참조표.
const PERMS: { label: string; admin: boolean; super: boolean; user: boolean }[] = [
  { label: "대시보드·사용량 조회", admin: true, super: true, user: true },
  { label: "가드레일 증적 조회", admin: true, super: true, user: true },
  { label: "API 키 발급·회수", admin: true, super: true, user: false },
  { label: "가드레일 정책 변경", admin: true, super: true, user: false },
  { label: "엔드포인트 배포·삭제", admin: true, super: true, user: false },
  { label: "사용자·역할 관리", admin: true, super: false, user: false },
];

// 설정/관리 — RBAC/Users·부서 매핑 (문서 2-13). Nutanix Admin·Backend.AI Credentials.
export default function Settings() {
  const canWrite = useCap().can("users.write"); // 사용자 추가·역할 변경·삭제 권한
  const canConfig = useCap().can("credentials"); // 연동 설정 재구성(민감) — manage 전용
  const toast = useToast(); // 전역 토스트(IMP-29) — 성공/오류 일원화
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<string[]>(["admin", "user", "super"]);
  const [error, setError] = useState<string | null>(null); // 초기 로드 실패만 인라인 표시
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "user", dept_id: "" });
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<User | null>(null);
  const [confirmRole, setConfirmRole] = useState<{ user: User; role: string } | null>(null); // 권한 상향 확인
  const [confirmDel, setConfirmDel] = useState<User | null>(null); // 사용자 삭제 확인

  // IMP-22 — 사용자 추가 폼 인라인 검증(이메일·이름 필수, 이메일 형식). 짧은 폼 → 첫 오류필드 포커스.
  const fv = useFieldValidation(form, {
    email: (v) => {
      const s = String(v).trim();
      if (!s) return "이메일을 입력하세요.";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? undefined : "올바른 이메일 형식이 아닙니다.";
    },
    name: required("이름을 입력하세요."),
  });

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetchUsers(signal);
      setUsers(r.users);
      setRoles(r.roles);
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
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

  // 역할 변경 — 권한 상향(user→super/admin 등)이면 확인 다이얼로그, 아니면 즉시 적용.
  const changeRole = (u: User, role: string) => {
    if (role === u.role) return;
    if (isEscalation(u.role, role)) { setConfirmRole({ user: u, role }); return; }
    void applyRole(u, role);
  };

  const applyRole = async (u: User, role: string) => {
    setBusy(true);
    try {
      await updateUser(u.user_id, { role, dept_id: u.dept_id, status: u.status });
      setConfirmRole(null);
      toast.success(`${u.name}님의 역할을 ${ROLE_LABEL[role] ?? role}(으)로 변경했습니다.`);
      load();
    } catch (e) { toast.error(humanizeError((e as Error).message)); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await deleteUser(confirmDel.user_id);
      toast.success(`${confirmDel.name}님을 삭제했습니다.`);
      setConfirmDel(null);
      load();
    } catch (e) { toast.error(humanizeError((e as Error).message)); } finally { setBusy(false); }
  };

  const submit = () => fv.handleSubmit(doSubmit);

  const doSubmit = async () => {
    setBusy(true);
    try {
      await createUser(form);
      setModal(false);
      fv.reset();
      toast.success(`${form.name}님을 추가했습니다.`);
      setForm({ email: "", name: "", role: "user", dept_id: "" });
      load();
    } catch (e) { toast.error(humanizeError((e as Error).message)); } finally { setBusy(false); }
  };

  const openAddUser = () => { fv.reset(); setForm({ email: "", name: "", role: "user", dept_id: "" }); setModal(true); };

  return (
    <>
      <div className="page-head">
        <h1>설정 · 관리</h1>
        <span className="crumb">설정 / RBAC · Users</span>
        <div className="spacer" />
        <span className="updated">{users.length}명</span>
        {canWrite && <button type="button" className="btn-primary" onClick={openAddUser}>+ 사용자 추가</button>}
      </div>

      {error && <div className="state error" role="alert">{error}</div>}
      {canConfig && <ReconfigurePanel />}
      {/* IMP-82 — 로컬 모델 연결 카드. 목록/테스트는 항상 표시, 편집은 manage(credentials)에서만. */}
      <LocalModelCard canEdit={canConfig} />
      {canConfig && <AlertWebhookCard />}
      {/* 지표 기반 알림 룰(IMP-36) — 목록은 읽기전용으로 항상, 편집은 manage(credentials)에서만 */}
      <AlertRulesCard canEdit={canConfig} />

      <div className="card">
        <div className="card-head">
          <h3>사용자 · 역할</h3>
          <InfoTip>역할(Admin/User/Super)과 부서 매핑. 역할은 인라인으로 변경됩니다.</InfoTip>
        </div>
        {loading && users.length === 0 ? (
          <div className="table-scroll"><SkeletonRows rows={6} cols={6} /></div>
        ) : users.length === 0 ? (
          <div className="empty">사용자가 없습니다. “+ 사용자 추가”로 등록하세요.</div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="데이터 표 — 좌우 스크롤 가능">
          <table className="usage-table">
            <thead>
              <tr><th>이름</th><th>이메일</th><th>역할</th><th>부서</th><th>상태</th><th></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="clickable" onClick={() => setDetail(u)}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {canWrite ? (
                      <select className="range-select" value={u.role} onChange={(e) => changeRole(u, e.target.value)}>
                        {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
                      </select>
                    ) : (
                      roleTag(u.role)
                    )}
                  </td>
                  <td>{u.dept_id || <span className="muted">—</span>}</td>
                  <td>{u.status === "active" ? <Badge tone="green" dot>활성</Badge> : <Badge tone="neutral" dot>비활성</Badge>}</td>
                  <td className="num">
                    {canWrite && <button type="button" className="btn-danger-ghost" onClick={(e) => { e.stopPropagation(); setConfirmDel(u); }}>삭제</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>역할 × 권한 참조</h3>
          <InfoTip>역할별 허용 권한(읽기 전용 참조). 실제 강제는 API 레벨 RBAC.</InfoTip>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="데이터 표 — 좌우 스크롤 가능">
        <table className="usage-table rbac-matrix">
          <thead>
            <tr>
              <th>권한</th>
              <th className="num">관리자(Admin)</th>
              <th className="num">슈퍼(Super)</th>
              <th className="num">일반(User)</th>
            </tr>
          </thead>
          <tbody>
            {PERMS.map((p) => (
              <tr key={p.label}>
                <td>{p.label}</td>
                <td className="num">{p.admin ? <span className="perm-yes">✓</span> : <span className="perm-no">✕</span>}</td>
                <td className="num">{p.super ? <span className="perm-yes">✓</span> : <span className="perm-no">✕</span>}</td>
                <td className="num">{p.user ? <span className="perm-yes">✓</span> : <span className="perm-no">✕</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="policy-hint">모든 권한 토글·역할 변경은 감사 이벤트로 캡처됩니다. 상향 권한 부여 차단(자신보다 높은 역할 부여 불가)은 현재 사용자 컨텍스트 연동 후 활성화됩니다.</div>
      </div>

      <BrandColorCard />

      <SlidePanel
        open={!!detail}
        title={detail ? `사용자 · ${detail.name}` : ""}
        subtitle={detail?.email}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <DetailRow label="이름">{detail.name}</DetailRow>
            <DetailRow label="이메일">{detail.email}</DetailRow>
            <DetailRow label="역할">{roleTag(detail.role)}</DetailRow>
            <DetailRow label="부서">{detail.dept_id || "—"}</DetailRow>
            <DetailRow label="상태">{detail.status === "active" ? <Badge tone="green" dot>활성</Badge> : <Badge tone="neutral" dot>비활성</Badge>}</DetailRow>
            <DetailRow label="User ID"><code>{detail.user_id}</code></DetailRow>
            <DetailRow label="등록일">{new Date(detail.created_at).toLocaleString("ko-KR", { hour12: false })}</DetailRow>
            <p className="slide-note">역할: Admin(전체 관리) · Super(읽기+운영) · User(조회). 부서는 귀속/증적 필터에 사용.</p>
          </>
        )}
      </SlidePanel>

      {modal && (
        <Modal open onClose={() => setModal(false)} title="사용자 추가">
            <label className="pg-field"><span>이메일 *</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@maymust.com" {...fv.fieldProps("email")} />
              <FieldError id={fv.errorId("email")} message={fv.showError("email")} /></label>
            <label className="pg-field"><span>이름 *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="홍길동" {...fv.fieldProps("name")} />
              <FieldError id={fv.errorId("name")} message={fv.showError("name")} /></label>
            <div className="pg-field-row">
              <label className="pg-field"><span>역할</span>
                <select className="range-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
                </select></label>
              <label className="pg-field"><span>부서</span>
                <input value={form.dept_id} onChange={(e) => setForm({ ...form, dept_id: e.target.value })} placeholder="예: 리서치본부" /></label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setModal(false)}>취소</button>
              <button type="button" className="btn-primary" onClick={submit} disabled={busy}>{busy ? "추가 중…" : "추가"}</button>
            </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmRole}
        title="권한 상향 확인"
        danger
        busy={busy}
        confirmLabel="권한 부여"
        message={
          <>
            <b>{confirmRole?.user.name}</b>님에게 <b>{confirmRole ? (ROLE_LABEL[confirmRole.role] ?? confirmRole.role) : ""}</b> 권한을 부여합니다. 더 넓은 운영·관리 권한이 적용됩니다. 계속할까요?
          </>
        }
        onConfirm={() => confirmRole && applyRole(confirmRole.user, confirmRole.role)}
        onCancel={() => setConfirmRole(null)}
      />

      <ConfirmDialog
        open={!!confirmDel}
        title="사용자 삭제"
        danger
        busy={busy}
        confirmLabel="삭제"
        message={<><b>{confirmDel?.name}</b>({confirmDel?.email}) 사용자를 삭제합니다. <b>되돌릴 수 없습니다</b>.</>}
        onConfirm={remove}
        onCancel={() => setConfirmDel(null)}
      />
    </>
  );
}
