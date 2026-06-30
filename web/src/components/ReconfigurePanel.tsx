import { useCallback, useEffect, useRef, useState } from "react";
import { fetchConfig, fetchConfigStatus, saveConfig } from "../api/client";
import type { ConfigField, ConfigStatus, ConfigView } from "../api/types";
import InfoTip from "./InfoTip";

// 셀프-reconfigure(A1) — 화면에서 연동 설정을 고치면 ConfigMap patch + rollout restart 로
// 새 설정으로 재기동한다. 저장 후 롤아웃 상태를 폴링해 "재배포 중 → 완료"를 보여주고,
// 완료되면 연동 상태(진단)에서 통신이 맞춰졌는지 확인하도록 안내한다.
//
// 안전장치: 새 파드가 readiness 통과해야 옛 파드가 교체되므로 잘못된 설정이어도 서비스는 유지.
// 비밀(creds)은 여기서 편집하지 않는다(자격증명 화면/외부 Secret).
export default function ReconfigurePanel() {
  const [view, setView] = useState<ConfigView | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback((signal?: AbortSignal) => {
    fetchConfig(signal)
      .then((v) => {
        setView(v);
        setEdits(Object.fromEntries(v.fields.map((f) => [f.key, f.value])));
      })
      .catch((e) => { if (!signal?.aborted) setError((e as Error).message); });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const ac = new AbortController();
    load(ac.signal);
    return () => { mounted.current = false; ac.abort(); };
  }, [load]);

  // 롤아웃 상태 폴링 — ready/failed 까지 1.2s 간격.
  const poll = useCallback(() => {
    if (!mounted.current) return;
    fetchConfigStatus()
      .then((st) => {
        if (!mounted.current) return;
        setStatus(st);
        if (st.phase === "reconfiguring") {
          setTimeout(poll, 1200);
        } else {
          setSaving(false);
          if (st.phase === "ready") setDoneMsg("재기동 완료 — 연동 상태에서 통신을 확인하세요.");
          else if (st.phase === "failed") setError(st.message || "재기동 실패");
          load(); // 새 값 재조회
        }
      })
      .catch((e) => { if (mounted.current) { setSaving(false); setError((e as Error).message); } });
  }, [load]);

  const changed = view ? view.fields.filter((f) => (edits[f.key] ?? "") !== f.value) : [];

  const onSave = () => {
    if (!view || changed.length === 0) return;
    setSaving(true); setError(null); setFieldErrs({}); setDoneMsg(null); setStatus({ phase: "reconfiguring", message: "재기동 시작…" });
    const payload = Object.fromEntries(changed.map((f) => [f.key, edits[f.key] ?? ""]));
    saveConfig(payload)
      .then(() => { if (mounted.current) setTimeout(poll, 800); })
      .catch((e) => {
        if (!mounted.current) return;
        setSaving(false); setStatus(null);
        const fe = (e as Error & { fields?: Record<string, string> }).fields;
        if (fe) setFieldErrs(fe);
        setError((e as Error).message);
      });
  };

  if (error && !view) return <div className="card"><div className="card-head"><h3>연동 설정 · 재구성</h3></div><div className="state error">{error}</div></div>;
  if (!view) return null;

  return (
    <div className="card">
      <div className="card-head">
        <h3>연동 설정 · 재구성</h3>
        <InfoTip>설정 저장 → ConfigMap patch + rollout restart → 새 파드가 새 설정으로 기동. 비밀(creds)은 자격증명 화면에서.</InfoTip>
      </div>

      {!view.editable ? (
        <div className="state" role="status">
          <strong>읽기 전용</strong> — {view.reason}
          <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
            아래 값은 현재 적용된 설정입니다. 변경하려면 매니페스트(ConfigMap/Secret)를 직접 수정하세요(쿠버배포 레퍼런스 참고).
          </div>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13, marginTop: -2 }}>
          연동 대상(URL/네임스페이스)을 고치고 저장하면 <code>{view.namespace}/{view.deployment}</code> 가 새 설정으로 재기동됩니다. 비밀번호·키는 자격증명 화면에서 관리합니다.
        </p>
      )}

      <div className="cfg-form">
        {view.fields.map((f) => (
          <FieldRow
            key={f.key} f={f} value={edits[f.key] ?? ""} editable={view.editable}
            err={fieldErrs[f.key]}
            onChange={(v) => setEdits((e) => ({ ...e, [f.key]: v }))}
          />
        ))}
      </div>

      {status?.phase === "reconfiguring" && (
        <div className="state" role="status" style={{ marginTop: "var(--sp-3)" }}>
          <span className="spin" aria-hidden="true">↻</span> 재배포 중… {status.message}
          {typeof status.ready === "number" && <span className="muted"> ({status.ready}/{status.replicas} 준비)</span>}
        </div>
      )}
      {doneMsg && !saving && (
        <div className="state ok" role="status" style={{ marginTop: "var(--sp-3)" }}>
          ✓ {doneMsg} <a href="/diagnostics" style={{ marginLeft: 6 }}>연동 상태 열기 →</a>
        </div>
      )}
      {error && view && <div className="state error" role="alert" style={{ marginTop: "var(--sp-3)" }}>{error}</div>}

      {view.editable && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginTop: "var(--sp-3)" }}>
          <button type="button" className="btn" onClick={onSave} disabled={saving || changed.length === 0}>
            {saving ? "재배포 중…" : changed.length > 0 ? `저장 · 재구성 (${changed.length})` : "변경 없음"}
          </button>
          {changed.length > 0 && !saving && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setEdits(Object.fromEntries(view.fields.map((f) => [f.key, f.value])))}>되돌리기</button>
          )}
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>저장 시 전체 재기동(무중단, 레플리카 2+ 기준)</span>
        </div>
      )}
    </div>
  );
}

function FieldRow({ f, value, editable, err, onChange }: {
  f: ConfigField; value: string; editable: boolean; err?: string; onChange: (v: string) => void;
}) {
  return (
    <div className="cfg-row">
      <label className="cfg-label">{f.label}<code className="cfg-env">{f.env_key}</code></label>
      <div className="cfg-input">
        {f.kind === "enum" ? (
          <select value={value} disabled={!editable} onChange={(e) => onChange(e.target.value)}>
            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input type="text" value={value} disabled={!editable} spellCheck={false}
            placeholder={f.kind === "url" ? "scheme://host:port" : ""}
            onChange={(e) => onChange(e.target.value)} />
        )}
        {err && <div className="cfg-err">⚠ {err}</div>}
        {!err && f.warnings && f.warnings.map((w) => <div key={w} className="cfg-warn">· {w}</div>)}
      </div>
    </div>
  );
}
