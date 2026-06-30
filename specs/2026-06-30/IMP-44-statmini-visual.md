# IMP-44 — KPI stat-mini 통합(인라인 델타·미니 스파크라인·임계 색)

## 목적
Traces·Sessions 등의 `stat-mini` 카드는 현재 `sm-label / sm-val / sm-sub` 텍스트 적층뿐이라
한 카드만 보고 "좋아지나/나빠지나"를 읽을 수 없다. Datadog Query Value / Vercel Analytics
패턴처럼 **큰 메트릭값 + 인라인 델타 배지(▲▼) + 우하단 미니 스파크라인(IMP-25 재사용) +
임계 도달 시 좌측바/값 색**을 한 카드에 묶어 KPI 시각언어를 통일한다.

## SCOPE / 비회귀
- FE aesthetic only. **데이터/계산 로직 변경 없음.** 델타/스파크라인은 이미 있는 값이 있으면
  표시, 없으면 우아하게 생략(억지 계산·새 API 금지).
- ZERO new deps. raw-px·하드코딩 색 금지(토큰 경유). 색은 `--green/--red/--amber`(+weak/border).
- IMP-25 Sparkline 재사용, IMP-27 StatCard·델타 패턴과 시각언어 정합. IMP-40 위젯 registry 비회귀.

## 함수 시그니처 — 통합 StatMini 컴포넌트
`web/src/components/StatMini.tsx`
```ts
export type StatTone = "green" | "red" | "amber";       // 임계 도달 톤
export interface StatMiniProps {
  label: string;                 // 상단 라벨 (--fs-xs 위계)
  value: ReactNode;              // 큰 메트릭값 (--fs-metric)
  unit?: string;                 // 값 옆 디엠퍼사이즈 단위
  sub?: ReactNode;               // 보조 설명(기존 sm-sub)
  delta?: number;                // 전기간 대비 변화율(%). 있으면 ▲▼ 배지. 없으면 생략.
  deltaGood?: "up" | "down";     // "좋은" 방향(기본 up). delta 색 결정.
  spark?: number[];              // 미니 스파크라인 데이터. 길이<2 또는 없으면 생략.
  tone?: StatTone;               // 임계 도달 톤 → 좌측바 + 값 색.
}
export default function StatMini(props: StatMiniProps): JSX.Element;
```
- 델타 배지·임계 톤은 StatCard 의 기존 `Delta` 규칙과 동일(방향×good 으로 good/bad/flat 결정).
- 마크업: `.card.stat-mini`(tone 시 `tone-*` + 좌측바) > `.sm-label` / `.sm-val`(unit·delta 인라인)
  / `.sm-sub` + (spark 있을 때만) `.sm-spark` 우하단 절대배치.

## 테스트 케이스 (RTL, `StatMini.test.tsx`)
1. 라벨·값·단위 렌더, `.sm-unit` 텍스트 일치.
2. 양의 delta + deltaGood=up → `.delta.good`, `▲`, aria-label "개선".
3. deltaGood=down 인데 delta>0 → `.delta.bad`, `▲`, aria-label "악화"(낮을수록 좋은 지표).
4. delta 0 → `.delta.flat`.
5. delta 미지정 → `.delta` 미존재(우아한 생략).
6. spark(길이>=2) → `.sm-spark .sparkline` 존재.
7. spark 미지정/길이<2 → `.sm-spark` 미존재.
8. tone="red" → 카드에 `tone-red` 클래스(임계 색).
9. tone 미지정 → tone-* 클래스 없음.

## 출력 위치
- 신규: `web/src/components/StatMini.tsx`, `web/src/components/StatMini.test.tsx`
- 수정: `web/src/pages/Traces.tsx`(stat-mini 4카드 → StatMini), `web/src/pages/Sessions.tsx`(4카드 → StatMini),
  `web/src/index.css`(.stat-mini 좌측바/tone/.sm-spark 추가; 기존 .sm-* 위계 유지).
- Gpu 는 이미 StatCard(델타/스파크 지원) 사용 → 비대상. Eval 은 stat-mini 표면 없음(eval-trend는 별도) → 비대상.

## 의존성
none (IMP-25 Sparkline·기존 토큰만 재사용).
