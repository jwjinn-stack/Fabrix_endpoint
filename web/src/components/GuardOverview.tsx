import { useCallback, useEffect, useState } from "react";
import { fetchGuardAudit, fetchGuardPolicy, fetchGuardStatus, type GuardStatus } from "../api/client";
import type { GuardAuditRow, GuardPolicy } from "../api/types";

const nf = new Intl.NumberFormat("ko-KR");

// 가드레일이 "무엇을·왜" 하는지 설명하는 개요 — Semantic Router(Intent-Aware + Security) 슬라이드를
// 제품 구현으로. 파이프라인 + 능력별 설명 + 동작 방식 + 최근 차단 사례.
const CAPS = [
  { key: "pii", title: "PII 탐지", icon: "◑", desc: "주민번호·계좌·여권·카드·이메일 등 개인식별정보가 모델에 도달하기 전에 탐지합니다. SR ModernBERT 분류 + 한국어 정규식(탐지율 100% PoC)으로 보강.", color: "var(--pink)" },
  { key: "jailbreak", title: "Jailbreak / 프롬프트 가드", icon: "⚠", desc: "모델 안전장치를 우회하거나 유해 행동을 유도하는 시도(탈옥·시스템 프롬프트 추출)를 prompt-guard로 식별합니다.", color: "var(--red)" },
  { key: "secrets", title: "Secrets / 크리덴셜", icon: "🔑", desc: "AWS 키·Bearer 토큰·private key·발급 API 키(fbx_) 등 비밀정보가 프롬프트에 섞여 유출되는 것을 차단합니다.", color: "var(--amber)" },
  { key: "intent", title: "Intent 라우팅(설계)", icon: "◆", desc: "질의 의도를 분류해 민감·사내 데이터는 내부 모델로, 일반 지식 질의는 외부 API로 보내는 라우팅 신호를 제공합니다.", color: "var(--teal)" },
] as const;

const STEPS = [
  ["모든 추론이 FABRIX 프록시 통과", "client→Dynamo 직결이 아니라 우리 레이어를 반드시 경유 — 단일 차단 지점."],
  ["Semantic Router 판정", "PII·Jailbreak·Secrets·Intent 를 분류(SR classify + 한국어 정규식)."],
  ["정책 평가", "정책 카탈로그(축별 켜기/끄기·차단/표시)에 따라 통과·표시·차단 결정."],
  ["불변 증적 적재", "판정을 ClickHouse(조회 미러) + MinIO Object Lock(WORM 불변 원본)으로 보존. 원문·PII 미저장."],
  ["결과 노출", "차단 시 사용자에 정책 메시지, 응답 헤더·증적·대시보드에 결과 반영."],
] as const;

export default function GuardOverview() {
  const [status, setStatus] = useState<GuardStatus | null>(null);
  const [policy, setPolicy] = useState<GuardPolicy | null>(null);
  const [summary, setSummary] = useState<{ checked: number; blocked: number; pii: number; jailbreak: number } | null>(null);
  const [recent, setRecent] = useState<GuardAuditRow[]>([]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [st, pol, audit] = await Promise.all([
        fetchGuardStatus(signal),
        fetchGuardPolicy(signal).catch(() => null),
        fetchGuardAudit("24h", { decision: "blocked" }, signal),
      ]);
      setStatus(st);
      setPolicy(pol);
      setSummary({ checked: audit.summary.checked, blocked: audit.summary.blocked, pii: audit.summary.pii, jailbreak: audit.summary.jailbreak });
      setRecent(audit.rows.slice(0, 6));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const ruleOn = (k: string) => (k === "intent" ? true : policy ? (policy as unknown as Record<string, { enabled: boolean }>)[k]?.enabled : true);
  const reason = (r: GuardAuditRow) => {
    if (r.guard_types?.includes("jailbreak")) return "탈옥(jailbreak) 시도가 감지되어 차단";
    if (r.guard_types?.includes("pii")) return `개인식별정보(${(r.pii_subtypes || []).join(", ") || "PII"}) 포함으로 차단`;
    if (r.guard_types?.includes("secrets")) return "비밀정보(키/토큰) 포함으로 차단";
    return "정책 위반으로 차단";
  };
  const fmt = (ts: string) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? ts : d.toLocaleString("ko-KR", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); };

  return (
    <>
      {/* 상태 배너 */}
      <div className="card guard-status">
        <span className={`status-dot ${status?.enforcing ? "on" : ""}`} aria-hidden="true" />
        <div>
          <b>{status?.enforcing ? "가드레일 강제 중" : "가드레일 비활성"}</b>
          <span className="muted"> · 정책 {status?.policy_version ?? "-"} · 증적 {status?.audit_enabled ? "적재" : "off"}{status?.worm_enabled ? ` · 🔒 WORM 보존 ${nf.format(status.worm_count)}건` : ""}</span>
        </div>
        {summary && <span className="spacer" />}
        {summary && <span className="muted">최근 24시간 검사 {nf.format(summary.checked)} · 차단 {nf.format(summary.blocked)}</span>}
      </div>

      {/* 파이프라인 다이어그램 */}
      <div className="card">
        <div className="card-head"><h3>가드레일 파이프라인</h3><span className="info" title="모든 추론 요청이 거치는 경로">ⓘ</span></div>
        <div className="pipe">
          <div className="pipe-node">사용자 요청</div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-node pipe-fabrix">가드레일 분석<br /><small>PII·JB·Secrets·Intent</small></div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-node pipe-fabrix">정책 평가<br /><small>통과 · 표시 · 차단</small></div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-node">엔진(통과) / 반려(차단)</div>
        </div>
      </div>

      {/* 능력별 설명 카드 */}
      <div className="grid-2 guard-caps">
        {CAPS.map((c) => (
          <div className="card cap-card" key={c.key}>
            <div className="cap-head">
              <span className="cap-icon" style={{ color: c.color }} aria-hidden="true">{c.icon}</span>
              <h3>{c.title}</h3>
              <span className="spacer" />
              {ruleOn(c.key) ? <span className="tag tag-green">활성</span> : <span className="tag">꺼짐</span>}
            </div>
            <p className="cap-desc">{c.desc}</p>
            {summary && (c.key === "pii" || c.key === "jailbreak") && (
              <div className="cap-stat">최근 24시간 탐지 <b>{nf.format(c.key === "pii" ? summary.pii : summary.jailbreak)}</b>건</div>
            )}
          </div>
        ))}
      </div>

      {/* 동작 방식 */}
      <div className="card">
        <div className="card-head"><h3>동작 방식</h3></div>
        <ol className="guard-steps">
          {STEPS.map(([t, d], i) => (
            <li key={i}><b>{t}</b><span className="muted"> — {d}</span></li>
          ))}
        </ol>
      </div>

      {/* 최근 차단 사례 — 무엇을·왜 */}
      <div className="card">
        <div className="card-head"><h3>최근 차단 사례 (무엇을·왜)</h3><span className="spacer" /><span className="updated">최근 24시간</span></div>
        {recent.length === 0 ? (
          <div className="empty">최근 차단된 요청이 없습니다.</div>
        ) : (
          <table className="usage-table">
            <thead><tr><th>시각</th><th>앱</th><th>유형</th><th>사유</th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.event_id}>
                  <td>{fmt(r.ts)}</td>
                  <td>{r.app_id}</td>
                  <td>{(r.guard_types || []).map((t) => <span key={t} className={`tag ${t === "jailbreak" ? "tag-red" : t === "pii" ? "tag-pink" : "tag-amber"}`}>{t === "pii" ? "PII" : t === "jailbreak" ? "Jailbreak" : t === "secrets" ? "Secrets" : t}</span>)}</td>
                  <td>{reason(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
