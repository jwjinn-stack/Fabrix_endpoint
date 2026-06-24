// 부서별/앱별 사용량 분포 막대 리스트 (라이트 테마, Backend.AI 카드).
export interface BarItem {
  key: string;
  name: string;
  percent: number; // 0..1
}

export default function BarList({
  title,
  items,
  color = "var(--primary)",
  onRefresh,
  maxItems,
  onItemClick,
}: {
  title: string;
  items: BarItem[];
  color?: string;
  onRefresh?: () => void;
  /** 상위 N개만 노출, 나머지는 "기타"로 합산(OpenAI/AWS Cost 패턴). */
  maxItems?: number;
  onItemClick?: (item: BarItem) => void;
}) {
  const all = [...items].sort((a, b) => b.percent - a.percent);
  // Top-N + 기타 통합.
  let sorted = all;
  if (maxItems && all.length > maxItems) {
    const top = all.slice(0, maxItems);
    const rest = all.slice(maxItems);
    const restSum = rest.reduce((s, i) => s + i.percent, 0);
    sorted = [...top, { key: "__other__", name: `기타 (${rest.length})`, percent: restSum }];
  }
  const max = Math.max(...sorted.map((i) => i.percent), 0.0001);
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        <span className="spacer" />
        {onRefresh && (
          <button
            type="button"
            className="act"
            onClick={onRefresh}
            title={`${title} 새로고침`}
            aria-label={`${title} 새로고침`}
          >
            <span className="spin" aria-hidden="true">
              ⟳
            </span>
          </button>
        )}
      </div>
      {sorted.length === 0 ? (
        <div className="empty">집계 구간에 기록된 사용량이 없습니다.</div>
      ) : (
        sorted.map((it) => {
          const p = Math.round(it.percent * 100);
          const clickable = !!onItemClick && it.key !== "__other__";
          return (
            <div
              className={`bar-row ${clickable ? "clickable" : ""}`}
              key={it.key}
              onClick={clickable ? () => onItemClick!(it) : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onItemClick!(it);
                      }
                    }
                  : undefined
              }
            >
              <span className="name" title={it.name}>
                {it.name}
              </span>
              <div
                className="bar-track"
                role="meter"
                aria-valuenow={p}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${it.name} ${p}%`}
              >
                <div className="bar-fill" style={{ width: `${(it.percent / max) * 100}%`, background: color }} />
              </div>
              <span className="pct">{p}%</span>
            </div>
          );
        })
      )}
    </div>
  );
}
