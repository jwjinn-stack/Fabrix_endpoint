# IMP-54 — 노드/네트워크 메트릭 화면 시각 완성도 (게이지·임계라인·타입위계)

- **Type**: aesthetic (sev=low, effort=M)
- **Branch**: `feature/evolve-cycle3-topology`
- **Date**: 2026-07-01

## 목적

`NodeMetrics.tsx`(IMP-46)·`Network.tsx`(IMP-49) 메트릭 화면은 숫자·스파크라인
위주라 밀도·정렬·타입 위계가 조금만 어긋나도 '숫자 나열'로 전락한다. Grafana stat
panel·Datadog host map의 압축 정보밀도(선형 게이지·임계 밴드·임계 라인·정렬 그리드)에
근접하도록 **시각만** 끌어올린다. 데이터/동작 로직은 비회귀(불변).

## 요구사항

1. **골든시그널을 임계밴드 선형 게이지로** — 포화(util/load/retransmit)를 게이지로
   즉시 읽히게. 자체 SVG(신규 색·신규 deps 금지), Sparkline 스타일 재사용.
2. **시계열 통일 스파크라인 + 임계 라인** — Sparkline에 warn/crit 수평선(옵션) 추가.
   기존 호출부는 미지정 시 라인 없음(하위호환).
3. **타입 위계** — 값 `--fs-metric`(26px)/라벨 `--fs-xs`(11px) 토큰 재정비.
4. **포화 색은 GPU 관례 토큰 재사용**(`statusFromThresholds` → var(--red)/var(--amber)/
   var(--primary))으로 화면 간 일관. raw-px/하드코딩 색 금지(토큰 경유).
5. **색-only 금지**(WCAG 1.4.1) — 게이지·라인은 상태 텍스트/aria 병기.
6. IMP-46/49의 상태 정렬 그리드·zebra·sticky·빈/로딩 스켈레톤은 유지(이미 구현) —
   시각만 강화.

## 함수 시그니처

### 새 컴포넌트: `web/src/components/Gauge.tsx`
```ts
export interface GaugeProps {
  value: number;              // 현재값
  warn: number;               // 주의 임계
  crit: number;               // 위험 임계
  max?: number;               // 게이지 최대(기본 = crit*1.15 자동)
  valueText: string;          // 표시 텍스트(포맷된 값)
  label: string;              // 신호 라벨
  width?: number;             // 기본 100 (부모 100% 채움 CSS)
  height?: number;            // 기본 8 (트랙 두께)
}
export default function Gauge(props: GaugeProps): JSX.Element;
```
- 밴드: `[0..warn)` ok(--grid-line), `[warn..crit)` amber-weak, `[crit..max]` red-weak 트랙 배경.
- 채움(fill): `statusFromThresholds(value, warn, crit)` → var(--primary)/--amber/--red.
- 채움 폭 = `clamp(value/max, 0, 1) * trackWidth`.
- warn/crit 눈금(tick) = `warn/max`, `crit/max` 위치 세로선.
- role="img", aria-label = `${label} ${valueText} — 상태 ${status라벨}`.

### Sparkline 확장: `web/src/components/Sparkline.tsx`
```ts
warnValue?: number;   // 있으면 y(warnValue) 위치 amber 파선 수평선
critValue?: number;   // 있으면 y(critValue) 위치 red 파선 수평선
```
- 값 범위(min/max) 밖의 임계선은 clamp되어 가장자리에 표시(0..height).
- 하위호환: 미지정 시 아무 라인도 렌더 안 함.

## 적용 지점
- `NodeMetrics.tsx`
  - `HostCard`: saturation 그룹 대표(load1) 게이지 1개를 카드에 추가(밀도 강화). 데이터 불변.
  - `HostDetail`: Sparkline에 `warnValue`/`critValue` 전달(임계 라인).
- `Network.tsx`
  - `LinkCard`: 이용률 게이지(util) 추가.
  - `LinkDetail`: Sparkline에 `warnValue`/`critValue` 전달.

## 테스트케이스 (`web/src/components/Gauge.test.tsx`, Sparkline.test.tsx)
1. Gauge: value=warn 미만 → fill 색 = var(--primary), status 라벨 "정상".
2. Gauge: value>=crit → fill 색 = var(--red), aria-label "위험" 포함.
3. Gauge: value>=warn && <crit → var(--amber), "주의".
4. Gauge: 채움 폭이 value/max 비례(작은 값 < 큰 값의 폭).
5. Gauge: warn/crit tick 세로선 2개 렌더.
6. Gauge: aria-label 에 label·valueText 병기(색-only 금지).
7. Sparkline: warnValue/critValue 지정 → 파선 수평선 2개(.spark-threshold) 렌더.
8. Sparkline: 미지정 → 임계선 없음(하위호환).

## 출력 위치
- `web/src/components/Gauge.tsx` (신규)
- `web/src/components/Gauge.test.tsx` (신규)
- `web/src/components/Sparkline.tsx` (수정: 임계 라인 옵션)
- `web/src/components/Sparkline.test.tsx` (신규 or 수정)
- `web/src/pages/NodeMetrics.tsx` (게이지·임계라인 적용)
- `web/src/pages/Network.tsx` (게이지·임계라인 적용)
- `web/src/index.css` (.gauge-*, .spark-threshold 스타일, 토큰 경유)

## 의존성
- none (자체 SVG). ZERO new deps.
- 재사용: `statusFromThresholds`(mockFactory), 색 토큰(--red/--amber/--primary/--grid-line),
  `--fs-metric`/`--fs-xs` 타입 토큰.
