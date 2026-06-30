import type { GuardAuditRow } from "../api/types";
import InfoTip from "./InfoTip";

// 시간대별 위반 히스토그램 — 증적을 시간 버킷으로 스택(차단/표시/통과).
// Splunk 타임라인 히스토그램 패턴(상용SW-화면UIUX-리서치 P4-9).
const BUCKETS = 32;
const H = 84;

export default function EventHistogram({ rows }: { rows: GuardAuditRow[] }) {
  if (rows.length === 0) return null;
  const times = rows.map((r) => new Date(r.ts).getTime()).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;
  // 버킷별 동작 카운트.
  const buckets = Array.from({ length: BUCKETS }, () => ({ blocked: 0, flagged: 0, allowed: 0 }));
  for (const r of rows) {
    const t = new Date(r.ts).getTime();
    if (Number.isNaN(t)) continue;
    const i = Math.min(BUCKETS - 1, Math.floor(((t - min) / span) * BUCKETS));
    if (r.decision === "blocked") buckets[i].blocked++;
    else if (r.decision === "flagged") buckets[i].flagged++;
    else buckets[i].allowed++;
  }
  const maxCount = Math.max(...buckets.map((b) => b.blocked + b.flagged + b.allowed), 1);
  const fmt = (t: number) => new Date(t).toLocaleString("ko-KR", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="card">
      <div className="card-head">
        <h3>시간대별 증적 분포</h3>
        <InfoTip>기간 내 가드레일 판정을 시간 버킷으로 집계(차단/표시/통과 스택).</InfoTip>
        <span className="spacer" />
        <span className="histo-legend">
          <span><span className="histo-dot" style={{ background: "var(--red)" }} />차단</span>
          <span><span className="histo-dot" style={{ background: "var(--amber)" }} />표시</span>
          <span><span className="histo-dot" style={{ background: "var(--border-strong)" }} />통과</span>
        </span>
      </div>
      <div className="histo" style={{ height: H }}>
        {buckets.map((b, i) => {
          const total = b.blocked + b.flagged + b.allowed;
          const hPct = (total / maxCount) * 100;
          return (
            <div className="histo-col" key={i} title={`${b.blocked} 차단 · ${b.flagged} 표시 · ${b.allowed} 통과`}>
              <div className="histo-stack" style={{ height: `${hPct}%` }}>
                {b.blocked > 0 && <span style={{ flex: b.blocked, background: "var(--red)" }} />}
                {b.flagged > 0 && <span style={{ flex: b.flagged, background: "var(--amber)" }} />}
                {b.allowed > 0 && <span style={{ flex: b.allowed, background: "var(--border-strong)" }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="histo-axis">
        <span>{fmt(min)}</span>
        <span>{fmt(max)}</span>
      </div>
    </div>
  );
}
