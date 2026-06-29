import { useCallback, useEffect, useState } from "react";
import { fetchMaskingPolicy, setMaskingPolicy } from "../api/client";
import type { CaptureMode, MaskAction, MaskingPolicy, MaskRule } from "../api/types";

// 캡처 모드 3단(none/masked/full) — Langfuse 트레이스에 프롬프트/응답을 어떻게 보존할지.
const CAPTURE: { value: CaptureMode; label: string; hint: string }[] = [
  { value: "none", label: "저장 안 함", hint: "본문을 트레이스에 남기지 않음" },
  { value: "masked", label: "마스킹", hint: "아래 PII 규칙 적용 후 저장" },
  { value: "full", label: "원문", hint: "원문 그대로 저장(민감 — 보존·접근통제 필요)" },
];

const ACTIONS: { value: MaskAction; label: string }[] = [
  { value: "keep", label: "보관" },
  { value: "mask", label: "마스킹" },
  { value: "hash", label: "해시" },
  { value: "remove", label: "제거" },
];

// 추가 가능한 PII 유형 후보(고객사 요구에 맞춰 행 추가).
const TYPE_OPTIONS: { type: string; label: string }[] = [
  { type: "rrn", label: "주민등록번호" },
  { type: "account", label: "계좌번호" },
  { type: "card", label: "카드번호" },
  { type: "phone", label: "전화번호" },
  { type: "email", label: "이메일" },
  { type: "name", label: "이름" },
  { type: "address", label: "주소" },
  { type: "passport", label: "여권번호" },
  { type: "custom", label: "사용자 정의" },
];

// 마스킹 정책 — 게이트웨이 글루가 Langfuse ingestion 전에 적용하는 캡처/마스킹 규칙.
// FABRIX 는 편집·저장·표시만 담당(PG 영속). 글루가 GET /masking/policy 폴링해 실제 적용.
export default function MaskingPolicyPanel() {
  const [policy, setPolicy] = useState<MaskingPolicy | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setPolicy(await fetchMaskingPolicy(signal));
      setErr(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const patch = (p: Partial<MaskingPolicy>) => {
    if (!policy) return;
    setPolicy({ ...policy, ...p });
    setDirty(true);
    setNotice(null);
  };
  const setRule = (i: number, r: Partial<MaskRule>) => {
    if (!policy) return;
    const rules = policy.rules.map((x, idx) => (idx === i ? { ...x, ...r } : x));
    patch({ rules });
  };
  const addRule = () => policy && patch({ rules: [...policy.rules, { type: "custom", label: "사용자 정의", action: "mask" }] });
  const removeRule = (i: number) => policy && patch({ rules: policy.rules.filter((_, idx) => idx !== i) });

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    setErr(null);
    try {
      const p = await setMaskingPolicy(policy);
      setPolicy(p);
      setDirty(false);
      setNotice("마스킹 정책이 저장되었습니다. 게이트웨이 글루가 폴링으로 반영합니다.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (err && !policy) return <div className="state error" role="alert">마스킹 정책을 불러오지 못했습니다. ({err})</div>;
  if (!policy) return <div className="state" role="status">마스킹 정책을 불러오는 중…</div>;

  const captureRow = (label: string, desc: string, value: CaptureMode, onPick: (m: CaptureMode) => void) => (
    <div className={`policy-row ${value === "none" ? "off" : "on"}`}>
      <div className="policy-info">
        <span className="policy-name">{label}</span>
        <div className="policy-desc">{desc}</div>
      </div>
      <div className="policy-modes" role="group" aria-label={`${label} 모드`}>
        {CAPTURE.map((c) => (
          <button
            type="button"
            key={c.value}
            className={`mode-seg ${value === c.value ? "active" : ""}`}
            title={c.hint}
            aria-pressed={value === c.value}
            onClick={() => onPick(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {err && <div className="state error" role="alert">{err}</div>}
      {notice && <div className="state" role="status">{notice}</div>}

      <div className="card">
        <div className="card-head">
          <h3>캡처 정책 (Langfuse 트레이스 보존)</h3>
          <span className="info" title="프롬프트·응답을 트레이스에 어떻게 보존할지. 게이트웨이 글루가 ingestion 전 적용.">ⓘ</span>
          <span className="spacer" />
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 12 }}>
            <input type="checkbox" checked={policy.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
            마스킹 적용
          </label>
          <button type="button" className="btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? "저장 중…" : "정책 저장"}
          </button>
        </div>
        <div className="policy-list">
          {captureRow("프롬프트 (입력)", "고객이 보낸 프롬프트의 보존 방식", policy.capture_input, (m) => patch({ capture_input: m }))}
          {captureRow("응답 (출력)", "모델 응답의 보존 방식", policy.capture_output, (m) => patch({ capture_output: m }))}
          {captureRow("차단된 요청", "가드레일이 차단한 요청(감사 목적상 원문 보존이 필요할 수 있음)", policy.blocked_capture, (m) => patch({ blocked_capture: m }))}
        </div>
        <div className="policy-hint">
          <b>마스킹</b> 모드일 때만 아래 PII 규칙이 적용됩니다. <b>원문</b>은 디버깅에 강하지만 보존기간·접근통제가 필요하고, <b>저장 안 함</b>은 본문 없이 토큰·지연·판정만 남습니다.
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>PII 유형별 규칙</h3>
          <span className="info" title="마스킹 모드에서 탐지된 PII 유형을 어떻게 처리할지. 고객사 요구에 맞춰 추가/조정.">ⓘ</span>
          <span className="spacer" />
          <button type="button" className="btn-ghost btn-sm" onClick={addRule}>+ 규칙 추가</button>
        </div>
        <table className="usage-table">
          <thead>
            <tr><th>유형</th><th>표시명</th><th>처리</th><th></th></tr>
          </thead>
          <tbody>
            {policy.rules.map((r, i) => (
              <tr key={i}>
                <td>
                  <select className="range-select" value={TYPE_OPTIONS.some((t) => t.type === r.type) ? r.type : "custom"} onChange={(e) => {
                    const t = TYPE_OPTIONS.find((x) => x.type === e.target.value);
                    setRule(i, { type: e.target.value, label: t && t.type !== "custom" ? t.label : r.label });
                  }}>
                    {TYPE_OPTIONS.map((t) => <option key={t.type} value={t.type}>{t.type}</option>)}
                  </select>
                </td>
                <td><input className="search-input" value={r.label} onChange={(e) => setRule(i, { label: e.target.value })} /></td>
                <td>
                  <select className="range-select" value={r.action} onChange={(e) => setRule(i, { action: e.target.value as MaskAction })}>
                    {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </td>
                <td className="num"><button type="button" className="btn-ghost btn-sm" onClick={() => removeRule(i)}>삭제</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="policy-hint">
          처리: <b>보관</b>(그대로) · <b>마스킹</b>(부분 가림) · <b>해시</b>(비식별 대체) · <b>제거</b>([REDACTED]). 실제 적용은 게이트웨이 글루가 수행합니다.
        </div>
      </div>
    </>
  );
}
