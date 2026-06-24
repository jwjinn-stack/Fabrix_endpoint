// 스택 점유 바 — 그룹별 점유율을 한 가로 막대에 세그먼트로(OpenAI Usage 스택 바 패턴).
// Top-N + "기타" 통합(상용SW-화면UIUX-리서치 P4-4).
export interface ShareItem {
  key: string;
  name: string;
  value: number;
}

const PALETTE = [
  "var(--primary)",
  "var(--teal)",
  "var(--blue)",
  "var(--amber)",
  "var(--pink)",
  "var(--primary-lite)",
];

export default function StackedShareBar({
  title,
  items,
  maxItems = 6,
  unit = "",
  onSegmentClick,
}: {
  title: string;
  items: ShareItem[];
  maxItems?: number;
  unit?: string;
  onSegmentClick?: (key: string) => void;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return null;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  let segs = sorted;
  if (sorted.length > maxItems) {
    const top = sorted.slice(0, maxItems);
    const restSum = sorted.slice(maxItems).reduce((s, i) => s + i.value, 0);
    segs = [...top, { key: "__other__", name: `기타 (${sorted.length - maxItems})`, value: restSum }];
  }
  return (
    <div className="share-wrap">
      <div className="share-title">{title}</div>
      <div className="share-bar" role="img" aria-label={`${title} 점유율 분포`}>
        {segs.map((s, i) => {
          const w = (s.value / total) * 100;
          const color = s.key === "__other__" ? "var(--border-strong)" : PALETTE[i % PALETTE.length];
          const clickable = !!onSegmentClick && s.key !== "__other__";
          return (
            <span
              key={s.key}
              className={`share-seg ${clickable ? "clickable" : ""}`}
              style={{ width: `${w}%`, background: color }}
              title={`${s.name} · ${Math.round(w)}%`}
              onClick={clickable ? () => onSegmentClick!(s.key) : undefined}
            />
          );
        })}
      </div>
      <div className="share-legend">
        {segs.map((s, i) => {
          const w = (s.value / total) * 100;
          const color = s.key === "__other__" ? "var(--border-strong)" : PALETTE[i % PALETTE.length];
          return (
            <span className="share-key" key={s.key}>
              <span className="share-dot" style={{ background: color }} />
              {s.name} <b>{Math.round(w)}%</b>
              {unit && <span className="share-val"> · {s.value.toLocaleString("ko-KR")}{unit}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
