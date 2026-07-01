// 메트릭 단위별 표시 서식 — 카탈로그 unit 기준 단일 util.
// 이전엔 페이지/컴포넌트마다 fmt 가 흩어져 있었다(IMP-7). 공용으로 모은다.

const nf = new Intl.NumberFormat("ko-KR");

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return nf.format(Math.round(n));
}

// formatMetric — 카탈로그 unit(ms | ratio | req/s | tokens | count)에 맞춘 값 서식.
export function formatMetric(unit: string, v: number): string {
  if (unit === "ms") return `${nf.format(Math.round(v))}ms`;
  if (unit === "ratio") return `${Math.round(v * 100)}%`;
  if (unit === "req/s") return v.toFixed(2);
  return compact(v);
}

// relativeTime — ISO 타임스탬프를 "방금 전 / N분 전 / N시간 전 / N일 전" 상대 표기로 (IMP-43).
// 인시던트 인박스 등 "언제 발생했나"를 한눈에 트리아지하는 표면용. 절대시각은 호출부에서 title 로 보존.
// 미래 시각(예: snooze ~까지)은 "N분 후" 로 대칭 처리.
export function relativeTime(ts?: string, now: number = Date.now()): string {
  if (!ts) return "—";
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = now - t; // 과거면 양수
  const fut = diff < 0;
  const s = Math.floor(Math.abs(diff) / 1000);
  const suffix = fut ? "후" : "전";
  if (s < 45) return "방금 전";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 ${suffix}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 ${suffix}`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 ${suffix}`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}개월 ${suffix}`;
  return `${Math.floor(mo / 12)}년 ${suffix}`;
}
