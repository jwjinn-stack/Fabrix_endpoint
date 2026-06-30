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
