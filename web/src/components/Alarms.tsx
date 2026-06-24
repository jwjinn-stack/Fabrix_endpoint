import type { Alarm, AlarmSeverity } from "../api/types";

// 심각도별 접두 기호 — 색만으로 구분하지 않도록(색맹 접근성).
const MARK: Record<AlarmSeverity, string> = {
  critical: "●",
  warning: "▲",
  info: "ℹ",
};

// 4-1 하단 알람 라인.
export default function Alarms({ alarms }: { alarms: Alarm[] }) {
  if (alarms.length === 0) return null;
  return (
    <div className="alarms" role="status" aria-label="운영 알람" aria-live="polite">
      {alarms.map((a, i) => (
        <div className={`alarm ${a.severity}`} key={i}>
          <span className="badge" aria-hidden="true" />
          <span>
            <span aria-hidden="true">{MARK[a.severity]} </span>
            {a.message}
          </span>
        </div>
      ))}
    </div>
  );
}
