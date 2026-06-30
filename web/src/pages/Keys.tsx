import { useCallback, useEffect, useState } from "react";
import { fetchKeys, fetchOrg, issueKey, revokeKey } from "../api/client";
import type { APIKeyView, IssuedKey, OrgApp } from "../api/types";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import { useTableDensity, DensityToggle } from "../components/DensityToggle";
import SummaryStrip from "../components/SummaryStrip";
import { useCap } from "../capabilities";

const CUSTOM = "__custom__";
const nf = new Intl.NumberFormat("ko-KR");
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return nf.format(n);
}

// 일 토큰 한도(tpd) 사용 게이지 — GCP/Portkey식 인앱 예산 게이지(P4-5).
// used=오늘 누적 토큰(하드캡 기준). 초과 시 백엔드가 429 하드캡.
// 경고 임계(alert, 기본 0.8) 도달 시 amber, ≥100% red.
function QuotaGauge({ used, limit, alert = 0.8 }: { used: number; limit?: number; alert?: number }) {
  if (!limit || limit <= 0) return <span className="muted">무제한</span>;
  const ratio = used / limit;
  const color = ratio >= 1 ? "var(--red)" : ratio >= alert ? "var(--amber)" : "var(--green)";
  return (
    <div className="quota-gauge" title={`오늘 ${nf.format(used)} / ${nf.format(limit)} 토큰 (${Math.round(ratio * 100)}%) · 경고 ${Math.round(alert * 100)}%`}>
      <div className="quota-track">
        {/* 경고 임계 마커 */}
        <span className="quota-alert-mark" style={{ left: `${Math.min(alert, 1) * 100}%` }} />
        <span className="quota-fill" style={{ width: `${Math.min(ratio, 1) * 100}%`, background: color }} />
      </div>
      <span className="quota-pct" style={{ color: ratio >= alert ? color : undefined }}>{Math.round(ratio * 100)}%</span>
    </div>
  );
}

const won = (v: number) => `₩${Math.round(v).toLocaleString("ko-KR")}`;

export default function Keys() {
  const canWrite = useCap().can("keys.write"); // 키 발급·회수 권한(observe 에선 false)
  const [keys, setKeys] = useState<APIKeyView[]>([]);
  const [apps, setApps] = useState<OrgApp[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [appMode, setAppMode] = useState<"select" | "custom">("select");
  const [form, setForm] = useState({ app_id: "", app_name: "", dept_id: "", key_name: "", model_scope: "*", quota_rpm: "", quota_tpd: "", alert_threshold: "80" });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [detail, setDetail] = useState<APIKeyView | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<APIKeyView | null>(null); // 회수 확인(비가역)
  const { density, setDensity } = useTableDensity("keys");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetchKeys("24h", signal);
      setKeys(r.keys);
      const byID = new Map<string, OrgApp>();
      for (const k of r.keys) {
        if (!byID.has(k.app_id)) {
          byID.set(k.app_id, { app_id: k.app_id, name: k.app_name, dept_id: k.dept_id ?? "", keys: [] });
        }
      }
      try {
        const org = await fetchOrg(signal);
        for (const d of org.depts) {
          for (const app of d.apps) byID.set(app.app_id, app);
        }
        setDepts(org.known_depts ?? []);
      } catch {
        setDepts([...new Set(r.keys.map((k) => k.dept_id).filter(Boolean) as string[])].sort());
      }
      setApps([...byID.values()].sort((a, b) => a.name.localeCompare(b.name)));
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

  const submit = async () => {
    if (appMode === "custom" && !form.app_name.trim()) return;
    if (appMode === "select" && !form.app_id) return;
    setBusy(true);
    try {
      const k = await issueKey({
        app_id: appMode === "select" ? form.app_id : undefined,
        app_name: form.app_name,
        dept_id: form.dept_id,
        key_name: form.key_name,
        model_scope: form.model_scope,
        quota_rpm: form.quota_rpm ? Number(form.quota_rpm) : undefined,
        quota_tpd: form.quota_tpd ? Number(form.quota_tpd) : undefined,
        alert_threshold: form.alert_threshold ? Math.min(Math.max(Number(form.alert_threshold) / 100, 0), 1) : undefined,
      });
      setIssued(k);
      setModal(false);
      setAppMode("select");
      setForm({ app_id: "", app_name: "", dept_id: "", key_name: "", model_scope: "*", quota_rpm: "", quota_tpd: "", alert_threshold: "80" });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!confirmRevoke) return;
    setBusy(true);
    try {
      await revokeKey(confirmRevoke.api_key_id);
      setConfirmRevoke(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openIssueModal = () => {
    const first = apps[0];
    setAppMode(first ? "select" : "custom");
    setForm({
      app_id: first?.app_id ?? "",
      app_name: first?.name ?? "",
      dept_id: first?.dept_id ?? "",
      key_name: "",
      model_scope: "*",
      quota_rpm: "",
      quota_tpd: "",
      alert_threshold: "80",
    });
    setModal(true);
  };

  const onAppChange = (value: string) => {
    if (value === CUSTOM) {
      setAppMode("custom");
      setForm((f) => ({ ...f, app_id: "", app_name: "", dept_id: "" }));
      return;
    }
    const app = apps.find((a) => a.app_id === value);
    setAppMode("select");
    setForm((f) => ({ ...f, app_id: value, app_name: app?.name ?? value, dept_id: app?.dept_id ?? "" }));
  };

  return (
    <>
      <div className="page-head">
        <h1>키 · 앱</h1>
        <span className="crumb">키·앱 / API 키</span>
        <div className="spacer" />
        <span className="updated">{keys.length}개 키</span>
        <DensityToggle density={density} onChange={setDensity} />
        {canWrite && (
          <button type="button" className="btn-primary" onClick={openIssueModal}>
            + 키 발급
          </button>
        )}
      </div>

      {error && <div className="state error" role="alert">{error}</div>}

      {/* 발급 직후 평문 1회 표시 */}
      {issued && (
        <div className="card key-issued">
          <strong>API 키가 발급되었습니다 — 지금 한 번만 표시됩니다.</strong>
          <div className="key-reveal">
            <code>{issued.plaintext}</code>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                navigator.clipboard?.writeText(issued.plaintext);
                setCopied(true);
              }}
            >
              {copied ? "복사됨 ✓" : "복사"}
            </button>
          </div>
          <span className="key-warn">⚠ 이 값은 저장되지 않습니다(해시만 보관). 안전한 곳에 보관하세요.</span>
          <button type="button" className="btn-ghost key-dismiss" onClick={() => { setIssued(null); setCopied(false); }}>
            확인
          </button>
        </div>
      )}

      {!error && loading && keys.length === 0 && <div className="state" role="status">키 목록을 불러오는 중…</div>}

      {keys.length > 0 && (
        <SummaryStrip items={[
          { label: "전체 키", value: keys.length },
          { label: "활성", value: keys.filter((k) => k.enabled).length, tone: "green" },
          { label: "회수됨", value: keys.filter((k) => !k.enabled).length },
          { label: "예산 임계 초과", value: keys.filter((k) => k.quota_tpd && (k.tokens_today ?? 0) / k.quota_tpd >= (k.alert_threshold ?? 0.8)).length, tone: keys.some((k) => k.quota_tpd && (k.tokens_today ?? 0) / k.quota_tpd >= (k.alert_threshold ?? 0.8)) ? "amber" : "default" },
        ]} />
      )}

      <div className="card">
        <div className="card-head"><h3>API 키</h3></div>
        {keys.length === 0 && !loading ? (
          <div className="empty">발급된 키가 없습니다. “+ 키 발급”으로 시작하세요.</div>
        ) : (
          <div className="table-scroll">
          <table className={`usage-table sticky-first density-${density}`}>
            <thead>
              <tr>
                <th>키 이름</th>
                <th>앱</th>
                <th>부서</th>
                <th>키</th>
                <th>쿼터(rpm/tpd)</th>
                <th className="num">요청(24h)</th>
                <th className="num">토큰(24h)</th>
                <th className="num">추정비용(24h)</th>
                <th>일 예산 사용(오늘)</th>
                <th>상태</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.api_key_id} className="clickable" onClick={() => setDetail(k)}>
                  <td>{k.name}</td>
                  <td>{k.app_name}</td>
                  <td>{k.dept_id || <span className="muted">미귀속</span>}</td>
                  <td><code>{k.key_prefix}…</code></td>
                  <td>
                    {k.quota_rpm || k.quota_tpd ? (
                      <span className="mono">{k.quota_rpm ?? "∞"} / {k.quota_tpd ? compact(k.quota_tpd) : "∞"}</span>
                    ) : (
                      <span className="muted">무제한</span>
                    )}
                  </td>
                  <td className="num">{nf.format(k.requests ?? 0)}</td>
                  <td className="num">{compact((k.prompt_tokens ?? 0) + (k.completion_tokens ?? 0))}</td>
                  <td className="num">{(k.est_cost_krw ?? 0) > 0 ? won(k.est_cost_krw) : <span className="muted">—</span>}</td>
                  <td><QuotaGauge used={k.tokens_today ?? 0} limit={k.quota_tpd} alert={k.alert_threshold ?? 0.8} /></td>
                  <td>
                    {k.enabled ? <span className="pill running">활성</span> : <span className="pill warn">회수됨</span>}
                  </td>
                  <td className="num">
                    {k.enabled && (
                      <button type="button" className="btn-danger-ghost" disabled={!canWrite} title={canWrite ? "이 키를 회수(비활성화)합니다" : "읽기 전용 모드"} onClick={(e) => { e.stopPropagation(); setConfirmRevoke(k); }}>
                        회수
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <SlidePanel
        open={!!detail}
        title={detail ? `API 키 · ${detail.name}` : ""}
        subtitle={detail ? `${detail.app_name} (${detail.app_id})` : undefined}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <DetailRow label="키 이름">{detail.name}</DetailRow>
            <DetailRow label="앱">{`${detail.app_name} (${detail.app_id})`}</DetailRow>
            <DetailRow label="부서">{detail.dept_id || "미귀속"}</DetailRow>
            <DetailRow label="키 prefix"><code>{detail.key_prefix}…</code></DetailRow>
            <DetailRow label="API 키 ID"><code>{detail.api_key_id}</code></DetailRow>
            <DetailRow label="모델 범위">{detail.model_scope}</DetailRow>
            <DetailRow label="쿼터 rpm">{detail.quota_rpm ?? "무제한"}</DetailRow>
            <DetailRow label="일 토큰 예산 tpd">{detail.quota_tpd ? `${compact(detail.quota_tpd)} 토큰/일` : "무제한"}</DetailRow>
            <DetailRow label="경고 임계">{detail.alert_threshold != null ? `${Math.round(detail.alert_threshold * 100)}%` : "80% (기본)"}</DetailRow>
            <DetailRow label="예산 리셋">매일 00:00 UTC</DetailRow>
            <DetailRow label="일 예산 사용(오늘)">
              <QuotaGauge used={detail.tokens_today ?? 0} limit={detail.quota_tpd} alert={detail.alert_threshold ?? 0.8} />
            </DetailRow>
            <DetailRow label="오늘 누적 토큰">{compact(detail.tokens_today ?? 0)}</DetailRow>
            <DetailRow label="요청(24h)">{nf.format(detail.requests ?? 0)}</DetailRow>
            <DetailRow label="입력 토큰(24h)">{compact(detail.prompt_tokens ?? 0)}</DetailRow>
            <DetailRow label="출력 토큰(24h)">{compact(detail.completion_tokens ?? 0)}</DetailRow>
            <DetailRow label="추정 비용(24h)">{won(detail.est_cost_krw ?? 0)}</DetailRow>
            <DetailRow label="상태">{detail.enabled ? "활성" : "회수됨"}</DetailRow>
            <DetailRow label="발급일">{new Date(detail.created_at).toLocaleString("ko-KR", { hour12: false })}</DetailRow>
            <p className="slide-note">키 원문은 저장하지 않습니다(sha256 해시 + prefix만). rpm 초과 또는 <b>일 토큰 예산(tpd) 초과</b> 시 프록시가 <b>429</b>로 하드캡합니다(익일 리셋). 비용은 자가호스팅 토큰단가 기준 추정치(정산용 아님).</p>
          </>
        )}
      </SlidePanel>

      {/* 키 발급 모달 (Nutanix Create API Key) */}
      {modal && (
        <Modal open onClose={() => setModal(false)} title="API 키 발급">
            <label className="pg-field">
              <span>앱 귀속 *</span>
              <select className="range-select" value={appMode === "custom" ? CUSTOM : form.app_id} onChange={(e) => onAppChange(e.target.value)}>
                {apps.map((a) => (
                  <option key={a.app_id} value={a.app_id}>
                    {a.name} ({a.app_id}){a.dept_id ? ` · ${a.dept_id}` : " · 미귀속"}
                  </option>
                ))}
                <option value={CUSTOM}>+ 새 앱 만들기</option>
              </select>
            </label>
            {appMode === "custom" && (
              <label className="pg-field">
                <span>새 앱 이름 *</span>
                <input value={form.app_name} onChange={(e) => setForm({ ...form, app_name: e.target.value })} placeholder="예: WM Advisor Chatbot" />
              </label>
            )}
            <label className="pg-field">
              <span>조직/부서</span>
              <input list="dept-options" value={form.dept_id} onChange={(e) => setForm({ ...form, dept_id: e.target.value })} placeholder="미귀속 또는 부서 ID 입력" />
              <datalist id="dept-options">
                {depts.map((d) => <option key={d} value={d} />)}
              </datalist>
            </label>
            <div className="key-affinity">
              <span>이 키는</span>
              <b>{form.dept_id || "미귀속"}</b>
              <span>조직의</span>
              <b>{form.app_name || form.app_id || "앱"}</b>
              <span>앱에 귀속됩니다.</span>
            </div>
            <label className="pg-field">
              <span>키 이름</span>
              <input value={form.key_name} onChange={(e) => setForm({ ...form, key_name: e.target.value })} placeholder="예: wm-prod-key" />
            </label>
            <label className="pg-field">
              <span>모델 범위</span>
              <input value={form.model_scope} onChange={(e) => setForm({ ...form, model_scope: e.target.value })} placeholder="* 또는 gemma-4-31b-it" />
            </label>
            <fieldset className="budget-form">
              <legend>예산 · 쿼터 (Portkey 패턴)</legend>
              <div className="pg-field-row">
                <label className="pg-field">
                  <span>rpm (분당 요청)</span>
                  <input type="number" min={0} value={form.quota_rpm} onChange={(e) => setForm({ ...form, quota_rpm: e.target.value })} placeholder="무제한" />
                </label>
                <label className="pg-field">
                  <span>일 토큰 예산 (tpd)</span>
                  <input type="number" min={0} value={form.quota_tpd} onChange={(e) => setForm({ ...form, quota_tpd: e.target.value })} placeholder="무제한" />
                </label>
              </div>
              <div className="pg-field-row">
                <label className="pg-field">
                  <span>경고 임계 (%)</span>
                  <input type="number" min={0} max={100} value={form.alert_threshold} onChange={(e) => setForm({ ...form, alert_threshold: e.target.value })} placeholder="80" />
                </label>
                <label className="pg-field">
                  <span>리셋 주기</span>
                  <input value="매일 00:00 UTC" disabled title="현재 일 단위 리셋. 주/월 단위는 후속." />
                </label>
              </div>
              {form.quota_tpd && (
                <p className="budget-hint">
                  예산 <b>{compact(Number(form.quota_tpd))} 토큰/일</b> · 추정 ≈ {won(Number(form.quota_tpd) / 1_000_000 * 375)} (혼합 단가) · {form.alert_threshold || 80}% 도달 시 경고, 100% 초과 시 <b>429 하드캡</b>.
                </p>
              )}
            </fieldset>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setModal(false)}>취소</button>
              <button type="button" className="btn-primary" onClick={submit} disabled={busy || (appMode === "select" ? !form.app_id : !form.app_name.trim())}>
                {busy ? "발급 중…" : "발급"}
              </button>
            </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmRevoke}
        title="API 키 회수"
        danger
        busy={busy}
        confirmLabel="회수"
        message={
          <>
            <b>{confirmRevoke?.name}</b> 키를 회수합니다. 이 키를 쓰는 앱의 호출이 즉시 거부되며 <b>되돌릴 수 없습니다</b>(새 키 재발급 필요).
          </>
        }
        onConfirm={revoke}
        onCancel={() => setConfirmRevoke(null)}
      />
    </>
  );
}
