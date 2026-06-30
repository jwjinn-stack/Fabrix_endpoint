import { useCallback, useEffect, useState } from "react";
import { classifyGuard, fetchGuardPolicy, setGuardPolicy } from "../api/client";
import type { GuardPolicy as Policy, GuardVerdict, PolicyRule } from "../api/types";
import InfoTip from "./InfoTip";

const AXES: { key: keyof Policy; label: string; desc: string }[] = [
  { key: "pii", label: "PII 탐지", desc: "주민번호·계좌·여권·이메일 등 개인식별정보 (SR ModernBERT + 한국어 정규식)" },
  { key: "jailbreak", label: "Jailbreak / 프롬프트 가드", desc: "탈옥·시스템 프롬프트 우회 시도 (SR prompt-guard)" },
  { key: "secrets", label: "Secrets / 크리덴셜", desc: "API 키·토큰·private key 유출 (AWS·Bearer·fbx_ 등)" },
];

// 3-state 모드(LiteLLM 패턴) — 기존 {enabled, action} 위에 매핑(백엔드 변경 없음).
// off=비활성 / monitor=관찰만(flag) / enforce=차단(block). 폐쇄망 도입 시 monitor→enforce 단계 전환.
type Mode = "off" | "monitor" | "enforce";
const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "off", label: "끔", hint: "검사 안 함" },
  { value: "monitor", label: "관찰", hint: "탐지·증적만, 통과시킴(flag)" },
  { value: "enforce", label: "차단", hint: "탐지 시 요청 차단(block)" },
];
function ruleMode(r: PolicyRule): Mode {
  if (!r.enabled) return "off";
  return r.action === "block" ? "enforce" : "monitor";
}
function modePatch(m: Mode): Partial<PolicyRule> {
  if (m === "off") return { enabled: false };
  if (m === "monitor") return { enabled: true, action: "flag" };
  return { enabled: true, action: "block" };
}

// 가드레일 정책 카탈로그 + 토글 (#12) — Portkey/Kong/NeMo 패턴. PII 외 다축을 토글/동작 지정 + 라이브 테스트.
export default function GuardPolicyPanel() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testText, setTestText] = useState("내 주민번호는 901201-1234567 입니다");
  const [verdict, setVerdict] = useState<GuardVerdict | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setPolicy(await fetchGuardPolicy(signal));
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

  const update = (key: keyof Policy, patch: Partial<PolicyRule>) => {
    if (!policy) return;
    setPolicy({ ...policy, [key]: { ...policy[key], ...patch } });
    setDirty(true);
    setNotice(null);
  };

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    setErr(null);
    try {
      const p = await setGuardPolicy(policy);
      setPolicy(p);
      setDirty(false);
      setNotice("정책이 저장되었습니다. 이후 모든 요청에 즉시 적용됩니다.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!testText.trim()) return;
    setTesting(true);
    try {
      setVerdict(await classifyGuard(testText));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  if (err && !policy) return <div className="state error" role="alert">정책을 불러오지 못했습니다. ({err})</div>;
  if (!policy) return <div className="state" role="status">정책을 불러오는 중…</div>;

  return (
    <>
      {err && <div className="state error" role="alert">{err}</div>}
      {notice && <div className="state" role="status">{notice}</div>}

      <div className="card">
        <div className="card-head">
          <h3>정책 카탈로그</h3>
          <InfoTip>각 축을 켜고 끄거나 차단/표시(flag) 동작을 지정합니다. 즉시 적용.</InfoTip>
          <span className="spacer" />
          <button type="button" className="btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? "저장 중…" : "정책 저장"}
          </button>
        </div>
        <div className="policy-list">
          {AXES.map((ax) => {
            const rule = policy[ax.key];
            const mode = ruleMode(rule);
            return (
              <div key={ax.key} className={`policy-row ${mode === "off" ? "off" : "on"}`}>
                <div className="policy-info">
                  <span className="policy-name">{ax.label}</span>
                  <div className="policy-desc">{ax.desc}</div>
                </div>
                <div className="policy-modes" role="group" aria-label={`${ax.label} 모드`}>
                  {MODES.map((m) => (
                    <button
                      type="button"
                      key={m.value}
                      className={`mode-seg ${mode === m.value ? `active ${m.value}` : ""}`}
                      title={m.hint}
                      aria-pressed={mode === m.value}
                      onClick={() => update(ax.key, modePatch(m.value))}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="policy-hint">
          <b>관찰(monitor)</b>은 탐지·증적만 남기고 통과시키고, <b>차단(enforce)</b>은 탐지 시 요청을 막습니다. 폐쇄망 도입 시 <b>관찰로 먼저 운영 → 오탐 확인 후 차단 전환</b>을 권장합니다.
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>정책 테스트</h3>
          <InfoTip>현재 정책으로 텍스트를 즉시 분류합니다(프록시/증적 없음).</InfoTip>
        </div>
        <div className="policy-test">
          <textarea value={testText} onChange={(e) => setTestText(e.target.value)} rows={2} placeholder="테스트할 프롬프트를 입력하세요" />
          <button type="button" className="btn-primary" onClick={runTest} disabled={testing || !testText.trim()}>
            {testing ? "분류 중…" : "테스트"}
          </button>
        </div>
        {verdict && (
          <div className="policy-verdict">
            <span className={`tag ${verdict.decision === "blocked" ? "tag-red" : verdict.decision === "flagged" ? "tag-amber" : "tag-green"}`}>
              {verdict.decision === "blocked" ? "차단" : verdict.decision === "flagged" ? "표시" : "통과"}
            </span>
            {verdict.guard_types?.map((t) => (
              <span key={t} className={`tag ${t === "jailbreak" ? "tag-red" : "tag-pink"}`}>
                {t === "pii" ? "PII" : t === "jailbreak" ? "Jailbreak" : t === "secrets" ? "Secrets" : t}
              </span>
            ))}
            {verdict.pii_entities?.length ? <span className="muted">{verdict.pii_entities.map((e) => e.type).join(", ")}</span> : null}
            {verdict.category ? <span className="muted">intent: {verdict.category}</span> : null}
          </div>
        )}
      </div>
    </>
  );
}
