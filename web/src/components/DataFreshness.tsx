import { useEffect, useState } from "react";

// 데이터 신선도 인디케이터(IMP-21) — 폴링 화면이 '마지막 갱신 N초 전 · 자동 Ns' 를 보여
// 멈춘 화면을 라이브로 오인하지 않게 한다. 주기×3 초과 무갱신이면 색 비의존 stale 배지.
function relative(ageMs: number): string {
  const s = Math.max(0, Math.round(ageMs / 1000));
  if (s < 5) return "방금";
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.floor(m / 60)}시간 전`;
}

export default function DataFreshness({ updatedAt, intervalMs }: { updatedAt: number | null; intervalMs: number }) {
  // 1초 틱으로 상대시간만 다시 그린다(데이터 재요청 아님).
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const age = updatedAt ? Date.now() - updatedAt : 0;
  const stale = updatedAt != null && age > intervalMs * 3;
  const abs = updatedAt ? new Date(updatedAt).toLocaleTimeString("ko-KR", { hour12: false }) : "—";
  const autoSec = Math.round(intervalMs / 1000);

  return (
    <span className="updated" title={updatedAt ? `마지막 갱신 ${abs}` : undefined}>
      마지막 갱신 {updatedAt ? relative(age) : "—"} · 자동 {autoSec}s
      {/* role=status 라이브 영역 — stale 전환을 SR 에 고지. 색 비의존(아이콘+텍스트). */}
      <span role="status" aria-live="polite">
        {stale && <span className="freshness-stale"> · ⚠ 오래됨</span>}
      </span>
    </span>
  );
}
