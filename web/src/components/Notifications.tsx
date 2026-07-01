import { useCallback, useEffect, useRef, useState } from "react";
import { ackIncident, fetchIncidents, resolveIncident, snoozeIncident } from "../api/client";
import { useCap } from "../capabilities";
import { useToast } from "../toast";
import { humanizeError } from "../utils/errors";
import { relativeTime } from "../utils/format";
import type { AlarmSeverity, Incident, IncidentState } from "../api/types";

// 인시던트 인박스 (IMP-38) — OnCall/PagerDuty 모델. 기존 알림 드로어를 read-only 리스트에서
// 상태(ack/resolve/snooze)·발생횟수·최초/최근 시각·그룹핑을 가진 **인시던트 라이프사이클**로 격상.
//
// 상단 🔔 에서 토글. 상태 필터 탭(미처리/처리중/해소). ack 은 항상, resolve/snooze 는 manage
// (incident.write cap)에서만 노출 — observe 는 ack-only(백엔드 라우트 미등록이 실제 차단).
//
// IMP-31 비회귀 — 네이티브 <dialog> 비-모달 show()(top-layer·dialog 시맨틱은 얻되 배경 inert·
// 포커스 트랩 없음). Escape→onClose 수동 보강. IMP-29 toast 로 액션 피드백.

// 탭 정의 — 미처리는 triggered+snoozed(아직 손 안 댐), 처리중=acked, 해소=resolved.
type Tab = "open" | "acked" | "resolved";
const TAB_STATES: Record<Tab, IncidentState[]> = {
  open: ["triggered", "snoozed"],
  acked: ["acked"],
  resolved: ["resolved"],
};
const TAB_LABEL: Record<Tab, string> = { open: "미처리", acked: "처리중", resolved: "해소" };

const STATE_LABEL: Record<IncidentState, string> = {
  triggered: "발생",
  acked: "처리중",
  resolved: "해소됨",
  snoozed: "스누즈",
};

// severity 시각 매핑 (IMP-43) — 좌측 컬러바·아이콘. 색은 CSS(.inc-sev-*) 토큰으로,
// 여기선 아이콘·접근성 라벨만. info 는 중성(--text-dim), warning=amber, critical=red.
const SEV_ICON: Record<AlarmSeverity, string> = {
  critical: "▲", // 위험 (Datadog/OnCall 의 사선 경고 모티프)
  warning: "◆",
  info: "●",
};
const SEV_LABEL: Record<AlarmSeverity, string> = {
  critical: "심각",
  warning: "경고",
  info: "정보",
};

const SNOOZE_OPTIONS = [
  { label: "30분", minutes: 30 },
  { label: "1시간", minutes: 60 },
  { label: "3시간", minutes: 180 },
];

function fmtTime(ts?: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ko-KR", { hour12: false });
}

export default function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = useCap();
  const toast = useToast();
  const canWrite = can("incident.write"); // resolve/snooze 노출(=manage). ack 은 항상.

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<Tab>("open");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetchIncidents(undefined, signal);
      setIncidents(res.incidents ?? []);
      setCounts(res.counts ?? {});
    } catch {
      /* ignore — 폴링형 보조 패널, 다음 열기에서 재시도 */
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

  // 비-모달 <dialog> 열기/닫기 동기화 + 열 때 포커스 진입(IMP-31 비회귀).
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.show();
      dlg.focus();
    }
  }, [open]);

  // 비-모달은 cancel/Escape 자동 발생 안 함 → 수동 Escape→onClose.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 액션 래퍼 — 낙관적이지 않게(서버 응답 후 reload), toast 피드백(IMP-29).
  const runAction = useCallback(
    async (id: string, label: string, fn: () => Promise<Incident>) => {
      setBusyId(id);
      try {
        await fn();
        toast.success(label);
        await load();
      } catch (e) {
        toast.error(humanizeError(e instanceof Error ? e.message : String(e)));
      } finally {
        setBusyId(null);
      }
    },
    [toast, load],
  );

  if (!open) return null;

  const visible = incidents.filter((i) => TAB_STATES[tab].includes(i.state));
  const openCount = (counts.triggered ?? 0) + (counts.snoozed ?? 0);
  const tabBadge: Record<Tab, number> = {
    open: openCount,
    acked: counts.acked ?? 0,
    resolved: counts.resolved ?? 0,
  };

  return (
    <dialog ref={ref} className="drawer" aria-label="인시던트 인박스" tabIndex={-1}>
      <div className="drawer-head">
        <h3>인시던트 인박스 {openCount > 0 && <span className="drawer-count">{openCount}</span>}</h3>
        <button type="button" className="icon-dark" aria-label="닫기" onClick={onClose}>✕</button>
      </div>

      {/* 상태 필터 탭 */}
      <div className="inc-tabs seg-toggle" role="tablist" aria-label="인시던트 상태 필터">
        {(Object.keys(TAB_STATES) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "on" : ""}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
            {tabBadge[t] > 0 && <span className="tab-count"> {tabBadge[t]}</span>}
          </button>
        ))}
      </div>

      <div className="drawer-body">
        {loading && incidents.length === 0 && <div className="empty">불러오는 중…</div>}
        {!loading && visible.length === 0 && <div className="empty">해당 상태의 인시던트가 없습니다.</div>}
        {visible.map((inc) => (
          <div
            key={inc.id}
            className={`note inc note-${inc.severity} inc-sev-${inc.severity}${
              inc.state === "triggered" ? " inc-unhandled" : ""
            }`}
          >
            {/* severity 좌측 컬러바 (IMP-43) — 색은 .inc-sev-* 토큰 */}
            <span className="inc-bar" aria-hidden="true" />
            {/* 미처리(triggered) 미읽음 도트 + severity 아이콘 */}
            <span className="inc-glyph" title={`${SEV_LABEL[inc.severity]} 인시던트`}>
              <span className="sr-only">{SEV_LABEL[inc.severity]}</span>
              <span className="inc-icon" aria-hidden="true">{SEV_ICON[inc.severity]}</span>
            </span>
            <div className="note-body">
              <div className="note-msg">{inc.title}</div>
              <div className="note-foot">
                <span className={`badge inc-state inc-${inc.state}`}>{STATE_LABEL[inc.state]}</span>
                {inc.count > 1 && <span className="inc-count" title="발생 횟수">×{inc.count}</span>}
                {/* 상대시각 — 최근 발생 기준, 절대시각은 title 로 보존 */}
                <span className="inc-rel" title={`최근 ${fmtTime(inc.last_seen)}`}>
                  {relativeTime(inc.last_seen)}
                </span>
                {inc.state === "snoozed" && inc.silenced_until && (
                  <span className="inc-rel" title={`~${fmtTime(inc.silenced_until)} 까지`}>
                    {relativeTime(inc.silenced_until)}까지
                  </span>
                )}
              </div>
              <div className="inc-times">
                <span title={fmtTime(inc.first_seen)}>최초 {relativeTime(inc.first_seen)}</span>
                {inc.count > 1 && <span title={fmtTime(inc.last_seen)}>최근 {relativeTime(inc.last_seen)}</span>}
              </div>
              {/* 액션 — ack 은 처리 전(triggered/snoozed)에, resolve/snooze 는 write cap 일 때.
                  IMP-43: 기본 흐릿, 행 호버/포커스(focus-within)·미처리 행에서 드러남(.inc-actions). */}
              <div className="inc-actions">
                {(inc.state === "triggered" || inc.state === "snoozed") && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={busyId === inc.id}
                    onClick={() => runAction(inc.id, "인시던트를 처리중으로 표시했습니다.", () => ackIncident(inc.id))}
                  >
                    처리중
                  </button>
                )}
                {canWrite && inc.state !== "resolved" && (
                  <>
                    {SNOOZE_OPTIONS.map((o) => (
                      <button
                        key={o.minutes}
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busyId === inc.id}
                        onClick={() => runAction(inc.id, `${o.label} 스누즈했습니다.`, () => snoozeIncident(inc.id, o.minutes))}
                      >
                        {o.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn-danger-ghost btn-sm"
                      disabled={busyId === inc.id}
                      onClick={() => runAction(inc.id, "인시던트를 해소했습니다.", () => resolveIncident(inc.id))}
                    >
                      해소
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </dialog>
  );
}
