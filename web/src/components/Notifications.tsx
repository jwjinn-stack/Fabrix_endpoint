import { useCallback, useEffect, useState } from "react";
import { fetchGuardAudit, fetchOverview } from "../api/client";

interface Note {
  kind: "alarm" | "guard";
  severity: "info" | "warning" | "critical";
  message: string;
  ts?: string;
}

// 알림 드로어 (#19) — 대시보드 알람 + 최근 가드레일 차단을 비동기로 모아 표시.
// 상단 🔔 에서 토글. Backend.AI Notifications 패턴.
export default function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [ov, guard] = await Promise.all([
        fetchOverview("24h", signal),
        fetchGuardAudit("1h", { decision: "blocked" }, signal),
      ]);
      const out: Note[] = [];
      for (const a of ov.alarms ?? []) out.push({ kind: "alarm", severity: a.severity, message: a.message });
      for (const r of (guard.rows ?? []).slice(0, 8)) {
        const types = (r.guard_types ?? []).map((t) => (t === "pii" ? "PII" : t === "jailbreak" ? "Jailbreak" : t)).join(", ");
        out.push({ kind: "guard", severity: "critical", message: `${r.app_id} 차단 (${types})`, ts: r.ts });
      }
      setNotes(out);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [open, load]);

  if (!open) return null;
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-label="알림" aria-modal="true">
        <div className="drawer-head">
          <h3>알림 {notes.length > 0 && <span className="drawer-count">{notes.length}</span>}</h3>
          <button type="button" className="icon-dark" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          {loading && notes.length === 0 && <div className="empty">불러오는 중…</div>}
          {!loading && notes.length === 0 && <div className="empty">새 알림이 없습니다.</div>}
          {notes.map((n, i) => (
            <div key={i} className={`note note-${n.severity}`}>
              <span className={`note-dot ${n.kind === "guard" ? "guard" : ""}`} aria-hidden="true" />
              <div className="note-body">
                <div className="note-msg">{n.message}</div>
                <div className="note-foot">
                  <span className={`note-reason ${n.kind}`}>{n.kind === "guard" ? "가드레일 차단" : "시스템 알람"}</span>
                  {n.ts && <span className="note-ts">{new Date(n.ts).toLocaleString("ko-KR", { hour12: false })}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
