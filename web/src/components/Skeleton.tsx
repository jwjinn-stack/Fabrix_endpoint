// 스켈레톤 로딩 — 콘텐츠 구조를 미리 그려 체감 지연 감소(텍스트 "로딩 중" 대비 우수).
// 접근성: 컨테이너에 aria-hidden + 별도 라이브리전으로 "불러오는 중" 안내(adrianroselli 패턴).
export function Skeleton({ w = "100%", h = 14, r = 6, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) {
  return <span className="skel" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

// KPI 카드 4개 스켈레톤 (관제 대시보드 초기 로딩용).
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <>
      <div className="cards-4" aria-hidden="true">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="card" style={{ padding: "var(--sp-4)" }}>
            <Skeleton w={90} h={12} />
            <div style={{ display: "flex", gap: 24, marginTop: 16 }}>
              <Skeleton w={70} h={28} />
              <Skeleton w={50} h={28} />
            </div>
            <Skeleton w="100%" h={8} style={{ marginTop: 18 }} />
          </div>
        ))}
      </div>
      <span className="sr-only" role="status" aria-live="polite">데이터를 불러오는 중입니다.</span>
    </>
  );
}

// 테이블 행 스켈레톤.
export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: "flex", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} w={c === 0 ? 120 : `${Math.round(60 / cols)}%`} h={12} />
          ))}
        </div>
      ))}
      <span className="sr-only" role="status" aria-live="polite">목록을 불러오는 중입니다.</span>
    </div>
  );
}
