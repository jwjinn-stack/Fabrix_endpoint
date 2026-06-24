import { useCallback, useEffect, useState } from "react";
import { fetchGuardAudit, fetchGuardStatus, type GuardStatus } from "../api/client";
import type { GuardAuditReport, GuardAuditRow, TimeRange } from "../api/types";
import StatCard from "../components/StatCard";
import GuardPolicyPanel from "../components/GuardPolicy";
import GuardOverview from "../components/GuardOverview";
import EventHistogram from "../components/EventHistogram";
import SlidePanel, { DetailRow } from "../components/SlidePanel";

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

// 가드레일 증적 뷰 (문서 4-3) — Semantic Router 판정 → ClickHouse guard_audit.
// 요약 카드 + 필터 + 증적 테이블 + 상세 모달(trace_id·정책버전·PII 유형).
export default function Guard() {
  const [range, setRange] = useState<TimeRange>("24h");
  const [decision, setDecision] = useState("all");
  const [type, setType] = useState("all");
  const [tab, setTab] = useState<"overview" | "audit" | "policy">("overview");
  const [report, setReport] = useState<GuardAuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<GuardAuditRow | null>(null);
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
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
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
        <span className="crumb">가드레일 / {tab === "audit" ? "증적" : tab === "policy" ? "정책" : "개요"}</span>
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
        <button type="button" role="tab" aria-selected={tab === "policy"} className={`modality-tab ${tab === "policy" ? "active" : ""}`} onClick={() => setTab("policy")}>정책</button>
      </div>

      {tab === "overview" && <GuardOverview />}
      {tab === "policy" && <GuardPolicyPanel />}

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
            <span className="info" title="원문·PII 는 저장하지 않습니다. user_ref 는 비식별 해시입니다(SSOT 2-2).">ⓘ</span>
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
          )}
        </div>
      )}

      {tab === "audit" && !error && loading && !report && (
        <div className="state" role="status">증적을 조회하는 중입니다…</div>
      )}

      <SlidePanel
        open={!!detail}
        title="증적 상세"
        subtitle={detail ? fmtTime(detail.ts) : undefined}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
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
            <p className="slide-note">원문 프롬프트와 PII 값은 보존하지 않습니다(비식별·마스킹). 불변 원본은 WORM 보존.</p>
          </>
        )}
      </SlidePanel>
    </>
  );
}
