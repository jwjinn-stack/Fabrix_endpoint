import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGuardAudit, fetchOverview } from "../api/client";

interface Note {
  kind: "alarm" | "guard";
  severity: "info" | "warning" | "critical";
  message: string;
  ts?: string;
}

// 알림 드로어 (#19) — 대시보드 알람 + 최근 가드레일 차단을 비동기로 모아 표시.
// 상단 🔔 에서 토글. Backend.AI Notifications 패턴.
//
// IMP-31 — 네이티브 <dialog> 기반. 단, 알림 피드는 🔔 로 여는 *보조* 패널이라 페이지 작업을
// 막을 이유가 없다 → 비-모달 show()(top-layer 승격·dialog 시맨틱은 얻되 배경 inert·포커스 트랩 없음).
// 비-모달은 cancel/Escape 가 자동 발생하지 않으므로 Escape→onClose 를 수동 보강, 열 때 패널로 포커스 진입.
export default function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

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

  // 비-모달 <dialog> 열기/닫기 동기화 + 열 때 포커스 진입.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.show(); // 비-모달: 배경 inert/포커스 트랩 없음 — 페이지 상호작용 허용
      dlg.focus();
    }
  }, [open]);

  // 비-모달은 cancel/Escape 자동 발생 안 함 → 수동 Escape→onClose 보강.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <dialog ref={ref} className="drawer" aria-label="알림" tabIndex={-1}>
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
    </dialog>
  );
}
