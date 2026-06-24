import type { RankRow } from "../api/types";

// Top-N 랭킹 카드 (P4-1, Nutanix): 요청수 기준 상대 막대 + 토큰 보조 수치.
// 엔드포인트(모델)·API 키 랭킹에 공용.

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function RankCard({
  title,
  rows,
  unitLabel = "요청",
  color = "var(--primary)",
  onRowClick,
  emptyHint = "집계된 데이터가 없습니다.",
}: {
  title: string;
  rows: RankRow[];
  unitLabel?: string;
  color?: string;
  onRowClick?: (row: RankRow) => void;
  emptyHint?: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.requests), 0);
  return (
    <div className="card rank-card">
      <div className="card-head">
        <h3>{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="rank-empty">{emptyHint}</p>
      ) : (
        <ol className="rank-list">
          {rows.map((r, i) => {
            const w = max > 0 ? (r.requests / max) * 100 : 0;
            return (
              <li
                key={r.key || i}
                className={onRowClick ? "rank-row clickable" : "rank-row"}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                <span className="rank-no">{i + 1}</span>
                <div className="rank-main">
                  <div className="rank-line">
                    <span className="rank-name" title={r.key}>{r.label || r.key}</span>
                    <span className="rank-val">
                      {r.requests.toLocaleString("ko-KR")} <em>{unitLabel}</em>
                    </span>
                  </div>
                  <div className="rank-bar">
                    <span style={{ width: `${w}%`, background: color }} />
                  </div>
                  <div className="rank-sub">토큰 {fmtTokens(r.tokens)}</div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
