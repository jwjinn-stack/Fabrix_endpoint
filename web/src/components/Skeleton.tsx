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
            <div style={{ display: "flex", gap: "var(--sp-5)", marginTop: "var(--sp-4)" }}>
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

// 라우트 지연 로딩(IMP-85) 공통 fallback — 페이지 청크가 도착하기 전 아웃렛 영역을 채운다.
// CLS 회피(최상위 caveat): 대부분의 화면이 공유하는 대략적 구조(제목 스트립 → KPI 카드 4개 → 표 행)를
// 미리 차지해, 실제 콘텐츠가 붙어도 레이아웃 점프를 최소화한다. 앱 셸/nav 는 이미 eager 로 그려진 상태.
export function PageSkeleton() {
  return (
    <div aria-hidden="true" style={{ padding: "var(--sp-4) 0" }}>
      {/* 제목 스트립 */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", marginBottom: "var(--sp-5)" }}>
        <Skeleton w={220} h={22} />
        <Skeleton w={120} h={22} style={{ marginLeft: "auto" }} />
      </div>
      {/* KPI 카드 4개 */}
      <SkeletonCards count={4} />
      {/* 본문 표 */}
      <div className="card" style={{ padding: "var(--sp-4)", marginTop: "var(--sp-5)" }}>
        <SkeletonRows rows={8} cols={5} />
      </div>
      <span className="sr-only" role="status" aria-live="polite">화면을 불러오는 중입니다.</span>
    </div>
  );
}

// 테이블 행 스켈레톤.
export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: "flex", gap: "var(--sp-4)", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} w={c === 0 ? 120 : `${Math.round(60 / cols)}%`} h={12} />
          ))}
        </div>
      ))}
      <span className="sr-only" role="status" aria-live="polite">목록을 불러오는 중입니다.</span>
    </div>
  );
}
