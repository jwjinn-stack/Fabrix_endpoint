import type { Score } from "../api/types";

// IMP-18: 평가 점수(Langfuse Scores) 표시 공용 컴포넌트.
// scoreColor()/scoreCue() 는 Eval.tsx 의 로직을 공용화한 것(중복 제거, 신규 lib 없음).
// 점수 comment 는 사람/LLM 텍스트 — React JSX 의 기본 escape 로만 렌더(no dangerouslySetInnerHTML).

// 1~5 점수 → 색. (>=4 green, >=2 amber, else red)
export function scoreColor(s: number): string {
  return s >= 4 ? "var(--green)" : s >= 2 ? "var(--amber)" : "var(--red)";
}
// 1~5 점수 → 평문 신뢰도 큐(O-12 패턴).
export function scoreCue(s: number): string {
  return s >= 4.5 ? "매우 일치" : s >= 3.5 ? "대체로 일치" : s >= 2.5 ? "부분 일치" : "근거 부족";
}

// numeric → "이름 4/5", boolean → "이름 ✓/✗", categorical → "이름: 라벨".
function scoreLabel(sc: Score): string {
  if (sc.data_type === "numeric") return `${sc.name} ${sc.value}/5`;
  if (sc.data_type === "boolean") return `${sc.name} ${sc.value >= 1 ? "✓" : "✗"}`;
  return `${sc.name}: ${sc.string_value ?? "—"}`;
}
function badgeColor(sc: Score): string {
  if (sc.data_type === "numeric") return scoreColor(sc.value);
  if (sc.data_type === "boolean") return sc.value >= 1 ? "var(--green)" : "var(--red)";
  return "var(--text-dim)";
}

// compact 배지 컬럼용 — list 행에 점수 몇 개를 작게 표시. 없으면 null.
export function ScoreBadges({ scores, max = 2 }: { scores?: Score[]; max?: number }) {
  if (!scores || scores.length === 0) return null;
  const shown = scores.slice(0, max);
  const extra = scores.length - shown.length;
  return (
    <span className="score-badges" style={{ display: "inline-flex", gap: "var(--sp-1)", flexWrap: "wrap" }}>
      {shown.map((sc, i) => (
        <span
          key={`${sc.name}-${i}`}
          title={sc.comment ? `${scoreLabel(sc)} · ${sc.comment}` : scoreLabel(sc)}
          style={{
            fontSize: "var(--fs-xs)", color: badgeColor(sc), border: `1px solid ${badgeColor(sc)}`,
            borderRadius: "var(--radius-sm)", padding: "0 6px", whiteSpace: "nowrap", lineHeight: 1.6,
          }}
        >
          {scoreLabel(sc)}
        </span>
      ))}
      {extra > 0 && <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-dim)" }}>+{extra}</span>}
    </span>
  );
}

// detail 패널용 — 점수 목록(이름·값·신뢰도 큐·근거·출처). 비면 안내 문구.
const SOURCE_LABEL: Record<Score["source"], string> = { "human": "사람", "llm-judge": "LLM 심판", "api": "API" };
export function ScorePanel({ scores }: { scores?: Score[] }) {
  if (!scores || scores.length === 0) {
    return <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: "var(--sp-1) 0" }}>부착된 평가 점수가 없습니다.</p>;
  }
  return (
    <ul className="score-panel" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
      {scores.map((sc, i) => (
        <li key={`${sc.name}-${i}`} style={{ borderLeft: `3px solid ${badgeColor(sc)}`, paddingLeft: "var(--sp-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <b style={{ color: badgeColor(sc) }}>{scoreLabel(sc)}</b>
            {sc.data_type === "numeric" && (
              <span style={{ fontSize: "var(--fs-xs)", color: badgeColor(sc), border: `1px solid ${badgeColor(sc)}`, borderRadius: "var(--radius-sm)", padding: "0 6px" }}>{scoreCue(sc.value)}</span>
            )}
            <span className="tag" title="점수 출처">{SOURCE_LABEL[sc.source]}</span>
          </div>
          {sc.comment && <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-dim)", marginTop: 2 }}>{sc.comment}</div>}
        </li>
      ))}
    </ul>
  );
}
