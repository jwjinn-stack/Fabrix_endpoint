import type { ReactNode } from "react";

// 공통 상태/심각도 배지 — 전 화면 일관(상용SW-화면UIUX-리서치 P4-0).
// 라이트+오렌지 톤: 위험/주의만 강조색, 정상은 무채색.
export type BadgeTone = "neutral" | "green" | "amber" | "red" | "pink" | "teal" | "blue";

const TONES: Record<BadgeTone, { fg: string; bg: string; bd: string }> = {
  neutral: { fg: "var(--text-dim)", bg: "var(--surface-2)", bd: "var(--border)" },
  green: { fg: "var(--green)", bg: "var(--green-weak)", bd: "var(--green)" },
  amber: { fg: "var(--amber)", bg: "var(--amber-weak)", bd: "var(--amber-border)" },
  red: { fg: "var(--red)", bg: "var(--red-weak)", bd: "var(--red-border)" },
  pink: { fg: "var(--pink)", bg: "var(--pink-weak)", bd: "var(--pink)" },
  teal: { fg: "var(--teal)", bg: "var(--teal-weak)", bd: "var(--teal)" },
  blue: { fg: "var(--blue)", bg: "#e8effe", bd: "var(--blue)" },
};

export default function Badge({
  tone = "neutral",
  children,
  dot = false,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  dot?: boolean;
  title?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className="badge"
      title={title}
      style={{ color: t.fg, background: t.bg, borderColor: t.bd }}
    >
      {dot && <span className="badge-dot" style={{ background: t.fg }} aria-hidden="true" />}
      {children}
    </span>
  );
}

// 흔한 매핑 헬퍼 — 상태 문자열 → tone.
export function statusTone(status: string): BadgeTone {
  const s = status.toLowerCase();
  if (["ready", "active", "running", "healthy", "ok", "allowed", "enabled"].includes(s)) return "green";
  if (["pending", "processing", "waiting", "flagged", "degraded"].includes(s)) return "amber";
  if (["failed", "error", "unreachable", "blocked", "disabled", "revoked"].includes(s)) return "red";
  return "neutral";
}
