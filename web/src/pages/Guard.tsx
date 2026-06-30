import { useCallback, useEffect, useState } from "react";
import { fetchGuardAudit, fetchGuardContent, fetchGuardStatus, type GuardStatus } from "../api/client";
import type { GuardAuditReport, GuardAuditRow, GuardContent, TimeRange } from "../api/types";
import StatCard from "../components/StatCard";
import { SkeletonCards, SkeletonRows } from "../components/Skeleton";
import GuardPolicyPanel from "../components/GuardPolicy";
import MaskingPolicyPanel from "../components/MaskingPolicy";
import GuardOverview from "../components/GuardOverview";
import EventHistogram from "../components/EventHistogram";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import { useCap } from "../capabilities";
import InfoTip from "../components/InfoTip";
import { humanizeError } from "../utils/errors";

const RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "최근 1시간" },
  { value: "6h", label: "최근 6시간" },
  { value: "24h", label: "최근 24시간" },
  { value: "7d", label: "최근 7일" },
];

const DECISIONS = [
  { value: "all", label: "전체 동작" },
  { value: "blocked", label: "차단" },
  { value: "flagged", label: "표시" },
  { value: "allowed", label: "통과" },
];

const TYPES = [
  { value: "all", label: "전체 유형" },
  { value: "pii", label: "PII" },
  { value: "jailbreak", label: "Jailbreak" },
];

const nf = new Intl.NumberFormat("ko-KR");

function decisionBadge(d: string) {
  const map: Record<string, { cls: string; label: string }> = {
    blocked: { cls: "tag-red", label: "차단" },
    flagged: { cls: "tag-amber", label: "표시" },
    allowed: { cls: "tag-green", label: "통과" },
  };
  const m = map[d] ?? { cls: "", label: d };
  return <span className={`tag ${m.cls}`}>{m.label}</span>;
}

function typeBadges(types: string[]) {
  if (!types || types.length === 0) return <span className="muted">—</span>;
  return (
    <>
      {types.map((t) => (
        <span key={t} className={`tag ${t === "jailbreak" ? "tag-red" : "tag-pink"}`}>
          {t === "pii" ? "PII" : t === "jailbreak" ? "Jailbreak" : t}
        </span>
      ))}
    </>
  );
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("ko-KR", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// M-06 신뢰도 평문 큐 — 0~1 수치를 평문 등급으로(높음/보통/낮음).
function confidenceTier(c: number): string {
  if (c >= 0.8) return "높음";
  if (c >= 0.5) return "보통";
  return "낮음";
}

// PII 하위유형 코드를 한국어 평문으로. 미정의 코드는 원문 그대로.
const PII_LABELS: Record<string, string> = {
  rrn: "주민등록번호", ssn: "주민등록번호", phone: "전화번호", email: "이메일",
  card: "카드번호", credit_card: "카드번호", account: "계좌번호", name: "이름",
  address: "주소", passport: "여권번호", driver_license: "운전면허번호",
};
function piiLabel(code: string): string {
  return PII_LABELS[code] ?? code;
}

// 가드레일 증적 뷰 (문서 4-3) — Semantic Router 판정 → ClickHouse guard_audit.
// 요약 카드 + 필터 + 증적 테이블 + 상세 모달(trace_id·정책버전·PII 유형).
export default function Guard() {
  const canPolicy = useCap().can("guard.write"); // 정책 변경(PUT) 권한 — observe 에선 정책 탭 숨김
  const [range, setRange] = useState<TimeRange>("24h");
  const [decision, setDecision] = useState("all");
  const [type, setType] = useState("all");
  const [tab, setTab] = useState<"overview" | "audit" | "policy" | "masking">("overview");
  const [report, setReport] = useState<GuardAuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<GuardAuditRow | null>(null);
  // 차단 프롬프트 원문 (Langfuse) — 민감 데이터라 명시적 조회.
  const [content, setContent] = useState<GuardContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentErr, setContentErr] = useState<string | null>(null);
  const loadContent = useCallback((traceId: string) => {
    setContentLoading(true); setContent(null); setContentErr(null);
    fetchGuardContent(traceId)
      .then(setContent)
      .catch((e) => setContentErr(humanizeError((e as Error).message)))
      .finally(() => setContentLoading(false));
  }, []);
  const [status, setStatus] = useState<GuardStatus | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchGuardStatus(ctrl.signal).then(setStatus).catch(() => {});
    return () => ctrl.abort();
  }, [report]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await fetchGuardAudit(range, { decision, type }, signal);
        setReport(r);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
      } finally {
        setLoading(false);
      }
    },
    [range, decision, type],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const s = report?.summary;
  const rows = report?.rows ?? [];
  const unavailable = report?.source === "unavailable";

  return (
    <>
      <div className="page-head">
        <h1>가드레일</h1>
        <span className="crumb">가드레일 / {tab === "audit" ? "증적" : tab === "policy" ? "정책" : tab === "masking" ? "마스킹" : "개요"}</span>
        <div className="spacer" />
        {tab === "audit" && (
          <>
            <select className="range-select" value={decision} onChange={(e) => setDecision(e.target.value)} aria-label="동작 필터">
              {DECISIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <select className="range-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="유형 필터">
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <select className="range-select" value={range} onChange={(e) => setRange(e.target.value as TimeRange)} aria-label="기간 필터">
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>기간: {r.label}</option>
              ))}
            </select>
            <button type="button" className="refresh-btn" onClick={() => load()} aria-label="증적 새로고침">
              <span className="spin" aria-hidden="true">⟳</span>
              새로고침
            </button>
          </>
        )}
      </div>

      <div className="modality-tabs" role="tablist" aria-label="가드레일 보기">
        <button type="button" role="tab" aria-selected={tab === "overview"} className={`modality-tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>개요</button>
        <button type="button" role="tab" aria-selected={tab === "audit"} className={`modality-tab ${tab === "audit" ? "active" : ""}`} onClick={() => setTab("audit")}>증적</button>
        {canPolicy && (
          <button type="button" role="tab" aria-selected={tab === "policy"} className={`modality-tab ${tab === "policy" ? "active" : ""}`} onClick={() => setTab("policy")}>정책</button>
        )}
        {canPolicy && (
          <button type="button" role="tab" aria-selected={tab === "masking"} className={`modality-tab ${tab === "masking" ? "active" : ""}`} onClick={() => setTab("masking")}>마스킹</button>
        )}
      </div>

      {tab === "overview" && <GuardOverview />}
      {tab === "policy" && canPolicy && <GuardPolicyPanel />}
      {tab === "masking" && canPolicy && <MaskingPolicyPanel />}

      {tab === "audit" && error && (
        <div className="state error" role="alert">증적을 불러오지 못했습니다. ({error})</div>
      )}

      {tab === "audit" && unavailable && (
        <div className="state" role="status">
          증적 저장소(ClickHouse)가 연결되지 않았습니다. 가드레일 판정은 동작하지만 증적 적재가 비활성 상태입니다.
        </div>
      )}

      {tab === "audit" && s && (
        <div className="cards-5">
          <StatCard title="검사" info="기간 내 가드레일 검사 총 건수" metrics={[{ label: "총 검사", value: nf.format(s.checked) }]} />
          <StatCard title="차단" info="PII/Jailbreak 로 차단된 건수" metrics={[{ label: "blocked", value: nf.format(s.blocked), tone: "red" }]} />
          <StatCard title="PII" info="개인식별정보 탐지 건수" metrics={[{ label: "PII", value: nf.format(s.pii), tone: "pink" }]} />
          <StatCard title="Jailbreak" info="탈옥 시도 탐지 건수" metrics={[{ label: "jailbreak", value: nf.format(s.jailbreak), tone: "red" }]} />
          <StatCard title="표시" info="통과했으나 표시(flagged)된 건수" metrics={[{ label: "flagged", value: nf.format(s.flagged), tone: "amber" }]} />
        </div>
      )}

      {tab === "audit" && rows.length > 0 && <EventHistogram rows={rows} />}

      {tab === "audit" && report && (
        <div className="card">
          <div className="card-head">
            <h3>증적 목록</h3>
            <InfoTip>원문·PII 는 저장하지 않습니다. user_ref 는 비식별 해시입니다(SSOT 2-2).</InfoTip>
            {status?.worm_enabled && (
              <span className="tag tag-green" title={`MinIO Object Lock 버킷 ${status.worm_bucket} — 변경·삭제 불가`}>
                🔒 WORM 보존 {nf.format(status.worm_count)}건
              </span>
            )}
            <span className="spacer" />
            <span className="updated">{nf.format(rows.length)}건 표시</span>
          </div>
          {rows.length === 0 ? (
            <div className="empty">선택한 조건의 증적이 없습니다. 플레이그라운드에서 PII/Jailbreak 요청을 보내면 여기에 기록됩니다.</div>
          ) : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="데이터 표 — 좌우 스크롤 가능">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>앱</th>
                  <th>모델</th>
                  <th>유형</th>
                  <th className="num">JB 신뢰도</th>
                  <th className="num">status</th>
                  <th className="num">지연</th>
                  <th>동작</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.event_id}>
                    <td>{fmtTime(r.ts)}</td>
                    <td>{r.app_id}</td>
                    <td>{r.model}</td>
                    <td>{typeBadges(r.guard_types)}</td>
                    <td className="num">{r.jb_confidence > 0 ? `${Math.round(r.jb_confidence * 100)}%` : "—"}</td>
                    <td className="num"><span className={r.http_status >= 400 ? "tag tag-red" : "tag tag-green"}>{r.http_status || "—"}</span></td>
                    <td className="num">{r.latency_ms > 0 ? `${r.latency_ms}ms` : "—"}</td>
                    <td>{decisionBadge(r.decision)}</td>
                    <td>
                      <button type="button" className="link" onClick={() => setDetail(r)}>상세 →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {tab === "audit" && !error && loading && !report && (
        <>
          <SkeletonCards count={4} />
          <div className="card" style={{ marginTop: "var(--sp-4)" }}>
            <SkeletonRows rows={8} cols={6} />
          </div>
        </>
      )}

      <SlidePanel
        open={!!detail}
        title="증적 상세"
        subtitle={detail ? fmtTime(detail.ts) : undefined}
        onClose={() => { setDetail(null); setContent(null); setContentErr(null); }}
      >
        {detail && (
          <>
            {/* M-06 신뢰도/PII 평문 큐 — 수치만이 아니라 사람이 읽을 판정 요약 */}
            <div className="guard-verdict" style={{ background: "var(--surface, #fff)", border: "1px solid var(--border)", borderRadius: 10, padding: "var(--sp-3, 12px)", marginBottom: "var(--sp-3, 12px)", display: "grid", gap: 6, fontSize: 13 }}>
              {detail.guard_types?.includes("jailbreak") && (
                <div>
                  <b>Jailbreak 신뢰도:</b>{" "}
                  {detail.jb_confidence > 0
                    ? `${(detail.jb_confidence * 100).toFixed(1)}% (${confidenceTier(detail.jb_confidence)})`
                    : "수치 없음"}
                </div>
              )}
              {detail.guard_types?.includes("pii") && (
                <div>
                  <b>PII 탐지:</b>{" "}
                  {detail.pii_subtypes?.length
                    ? detail.pii_subtypes.map(piiLabel).join(", ")
                    : "유형 미상"}
                </div>
              )}
              {/* 규칙 → 이유 → 통과 조건 (가드레일 핵심: 왜 막혔고 무엇을 바꾸면 통과되는지) */}
              <div>
                <b>발동 규칙:</b>{" "}
                {detail.guard_types?.length
                  ? detail.guard_types.map((t) => (t === "pii" ? "PII 정책" : t === "jailbreak" ? "Jailbreak 차단 정책" : t === "secrets" ? "시크릿 차단 정책" : `${t} 정책`)).join(", ")
                  : "해당 없음"}
                {detail.policy_version ? ` · 정책 ${detail.policy_version}` : ""}
              </div>
              <div style={{ color: "var(--text-dim)" }}>
                {detail.decision === "blocked"
                  ? "이 요청은 가드레일에서 차단되었습니다."
                  : detail.decision === "flagged"
                    ? "통과했으나 표시(flagged)된 요청입니다."
                    : "정상 통과한 요청입니다."}
              </div>
              {detail.decision !== "allowed" && (
                <div style={{ color: "var(--text-dim)" }}>
                  <b style={{ color: "var(--text)" }}>통과 조건:</b>{" "}
                  {detail.guard_types?.includes("pii")
                    ? "해당 PII 유형을 마스킹으로 처리하거나 예외 등록하면 통과됩니다."
                    : detail.guard_types?.includes("jailbreak")
                      ? "정책을 ‘표시(flag)’로 낮추거나 해당 패턴을 예외 등록하면 통과됩니다."
                      : "정책에서 해당 패턴을 예외 처리하면 통과됩니다."}
                  {canPolicy ? " 아래 ‘정책 조정’에서 변경할 수 있습니다." : ""}
                </div>
              )}
            </div>

            <DetailRow label="동작">{decisionBadge(detail.decision)}</DetailRow>
            <DetailRow label="유형">{typeBadges(detail.guard_types)}</DetailRow>
            <DetailRow label="PII 유형">{detail.pii_subtypes?.length ? detail.pii_subtypes.join(", ") : "—"}</DetailRow>
            <DetailRow label="Jailbreak 신뢰도">{detail.jb_confidence > 0 ? `${(detail.jb_confidence * 100).toFixed(1)}%` : "—"}</DetailRow>
            <DetailRow label="모델">{detail.model}</DetailRow>
            <DetailRow label="앱 / 부서">{`${detail.app_id} / ${detail.dept_id}`}</DetailRow>
            <DetailRow label="API 키"><code>{detail.api_key_id}</code></DetailRow>
            <DetailRow label="사용자(비식별)"><code>{detail.user_ref}</code></DetailRow>
            <DetailRow label="trace_id"><code>{detail.trace_id}</code></DetailRow>
            <DetailRow label="HTTP status">{detail.http_status ? <span className={detail.http_status >= 400 ? "tag tag-red" : "tag tag-green"}>{detail.http_status}</span> : "—"}</DetailRow>
            <DetailRow label="판정 지연">{detail.latency_ms > 0 ? `${detail.latency_ms}ms` : "—"}</DetailRow>
            <DetailRow label="정책 버전">{detail.policy_version}</DetailRow>
            <DetailRow label="event_id"><code>{detail.event_id}</code></DetailRow>
            <p className="slide-note">FABRIX 증적(ClickHouse)은 원문·PII 를 비식별·마스킹 보존합니다. 불변 원본은 WORM 보존.</p>

            {/* M-05 복구/후속 액션 — manage 프로파일(guard.write) 한정. 증적 자체는 읽기 전용 유지, "다음 행동"만 제시 */}
            {canPolicy && (
              <div className="guard-actions" style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2, 8px)", marginTop: "var(--sp-3, 12px)" }}>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => { setDetail(null); setContent(null); setContentErr(null); setTab("policy"); }}
                >
                  이 패턴 정책에서 보기 →
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => { setDetail(null); setContent(null); setContentErr(null); setTab(detail.guard_types?.includes("pii") ? "masking" : "policy"); }}
                >
                  예외 추가 / 정책 조정 →
                </button>
              </div>
            )}

            {/* 차단 프롬프트 원문 — Langfuse GUARDRAIL observation 에서 조회 */}
            {detail.decision !== "allowed" && (
              <div className="guard-content">
                <div className="gc-head">
                  <span>차단 프롬프트 원문 <span className="gc-src">Langfuse</span></span>
                  {!content && !contentLoading && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => loadContent(detail.trace_id)}>원문 불러오기 →</button>
                  )}
                </div>
                {contentLoading && <div className="state" role="status" style={{ margin: 0 }}>Langfuse 에서 조회 중…</div>}
                {contentErr && <div className="state error" role="alert" style={{ margin: 0 }}>조회 실패 ({contentErr})</div>}
                {!content && !contentLoading && !contentErr && (
                  <p className="gc-hint">증적에는 마스킹본만 있습니다. 원문은 Langfuse GUARDRAIL observation 의 input 에서 가져옵니다(마스킹 정책 적용 시 일부 가려질 수 있음).</p>
                )}
                {content && (
                  <>
                    {content.captured ? (
                      <pre className="gc-input">{content.input}</pre>
                    ) : (
                      <div className="gc-uncaptured" role="status">
                        <b>원문 미보존</b> — 이 요청은 Langfuse <code>observation.input</code> 에 입력 원문이 계측되지 않았습니다.
                        Semantic Router 는 판정 메타데이터(유형·사유)만 남기고 원문을 보존하지 않으므로, 원문을 보려면 앱/프록시가 입력을 Langfuse 에 계측해야 합니다.
                      </div>
                    )}
                    {/* 판정 메타데이터는 Semantic Router 헤더/OTel 로 항상 확보됨 */}
                    <div className="gc-meta">
                      <span className={`tag ${content.output.blocked ? "tag-red" : "tag-amber"}`}>{content.output.blocked ? "차단됨" : "표시됨"}</span>
                      <span className="gc-reason">{content.output.reason}</span>
                      <span className="gc-cat">category: <code>{content.output.category}</code></span>
                      {content.masked && <span className="tag tag-amber">일부 마스킹{detail.pii_subtypes?.length ? `: ${detail.pii_subtypes.map(piiLabel).join(", ")}` : ""}</span>}
                    </div>
                    <p className="gc-hint">
                      {content.captured
                        ? <>출처: Langfuse trace <code>{content.trace_id}</code> · source={content.source}. 마스킹 미설정 시 원문 그대로 표시됩니다.</>
                        : <>판정 메타는 Semantic Router 가 항상 기록하지만, 원문 텍스트 보존은 별도 계측이 필요합니다(구현가능성-검증 §2-3).</>}
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </SlidePanel>
    </>
  );
}
