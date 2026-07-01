# IMP-80 — 대량 메트릭 분석 레이아웃 — 평면 key/value 상세를 Object View 360° 3층 위계로

- **Type**: aesthetic (sev=low, effort=M) — 시각/레이아웃. 배치된 `/design-review`(Step 3.7)에서 검증.
- **Branch**: `feature/evolve-cycle5-active-ontology`
- **Date**: 2026-07-02

## 목적

GPU 상세(`Gpu.tsx` SlidePanel)와 노드 상세(`NodeMetrics.tsx` HostDetail)는 스파크라인 + key/value 를
세로로 평면 나열한다 — `DetailRow` 가 라벨:값을 줄줄이 쌓고, 그룹 구분은 `h4` 텍스트뿐이다.
IMP-71 전량 드릴다운(explorer)이 이 평면 패턴 위에 얹히면 수백 행이 벽처럼 쏟아진다.

Palantir Object View 360° / Datadog Host·GPU / Grafana 패널 그리드 / Arize entity view 수준의
**밀도·위계·집계**로 재구성한다: 상단 요약 스트립 → 카테고리 카드 그리드 → 전체 메트릭 테이블(IMP-71).
IMP-71 explorer 와 IMP-76A 하드웨어 섹션은 이 3층의 **컨테이너 안에 그대로 중첩**한다(회귀 없음).

## 요구사항

### 3층 위계 (구현 대상 — 정확히)

1. **(Tier 1) 상단 요약 스트립** — 핵심 KPI 게이지/델타. IMP-54 `Gauge` 재사용.
   - GPU: 사용률·VRAM·온도·전력. 노드: 대표 포화(Load) + 핵심 USE.
   - 각 KPI = 라벨 + 값(단위) + 게이지 임계밴드. 상태 색 + **텍스트 병기**(WCAG 1.4.1).
2. **(Tier 2) 카테고리별 접이식 카드 그리드** — 반응형 2~3열.
   - 카드 = 카테고리 제목 + 상태 요약 + mini 스파크라인(임계 밴드) + 해당 신호 행.
   - 접힘/펼침(`<details>` 시맨틱 또는 `aria-expanded` 버튼). 기본 펼침.
   - GPU 카테고리: Utilization / Memory / Thermal·Power / (하드웨어 = IMP-76A 섹션이 Interconnect·Errors·Clocks 담당).
   - 노드 카테고리: Utilization / Saturation / Errors / Traffic (기존 USE 그룹 유지).
   - IMP-76A `GpuHardwareSection` 은 Tier 2 안에 그대로 렌더(카드 그리드에 병렬 배치).
3. **(Tier 3) 전체 메트릭 검색 테이블** — IMP-71 `MetricExplorer` 를 `<details>` disclosure 로.
   - 기존 `.me-disclosure` 그대로 — 명시적 탈출구. 회귀 없음.

### 공통 컴포넌트 (단일 출처)

새 파일 `web/src/components/MetricLayout.tsx` — 두 표면이 공유하는 3층 컨테이너 프리미티브:
- `SummaryStrip` — KPI 그리드(반응형). item = { label, valueText, gauge?, status }.
- `MetricCategoryCard` — 접이식 카드(제목 + 상태 배지 + mini 스파크라인 + children). 반응형 그리드 셀.
- `CategoryGrid` — 카드들을 responsive 2~3열 그리드로 감싼다.
- 상태색은 `statusFromThresholds` 단일 출처 재사용(GPU/노드 관례). 색-only 금지(텍스트 병기).

### 스타일 (index.css)

- 밀도 토큰(`--sp-*`/`--fs-*`) 사용. 라이트 + 스틸블루, 네온 금지.
- `.metric-summary`(strip), `.metric-cat-grid`(그리드), `.metric-cat-card`(카드), `.metric-cat-head`,
  `.metric-cat-spark`, `.metric-cat-body` 신설.
- 반응형: `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))` — 좁으면 1열.
- 카드 caret transition + 게이지 fill transition 은 `@media (prefers-reduced-motion: reduce)` 로 정지
  (기존 reduce-motion 블록에 셀렉터 추가). 코드베이스 규약 = reduce-motion 은 CSS 가 가드.

## 함수 시그니처

### `web/src/components/MetricLayout.tsx` (신규)

```ts
export interface SummaryKPI {
  label: string;
  valueText: string;          // 값+단위(포맷 완료 텍스트)
  status: "ok" | "warn" | "crit";
  gauge?: { value: number; warn: number; crit: number; max?: number };
}
export function SummaryStrip({ items }: { items: SummaryKPI[] }): JSX.Element;

export interface CategoryCardProps {
  title: string;
  status?: "ok" | "warn" | "crit";      // 카테고리 최악 상태(배지)
  spark?: { values: number[]; status: "ok" | "warn" | "crit"; warnValue?: number; critValue?: number };
  defaultOpen?: boolean;                 // 기본 true
  children: React.ReactNode;             // 신호 행(기존 node-dd-row / gpu-dd-row 재사용)
}
export function MetricCategoryCard(props: CategoryCardProps): JSX.Element;

export function CategoryGrid({ children }: { children: React.ReactNode }): JSX.Element;
```

### `web/src/pages/Gpu.tsx` (SlidePanel 본문 재구성)

- Tier 1 `SummaryStrip`: 사용률/VRAM/온도/전력(각 게이지 + 상태 텍스트).
- Tier 2 `CategoryGrid`: Utilization(사용률·SM·Tensor·MIG효율) / Memory(VRAM) / Thermal·Power(온도·전력)
  카드 + `GpuHardwareSection`(hw 있을 때). 각 카드는 시계열(ts.points)로 mini 스파크라인.
- MIG note 유지. Tier 3 `<details>` + `MetricExplorer` 유지.

### `web/src/pages/NodeMetrics.tsx` (HostDetail 재구성)

- Tier 1 `SummaryStrip`: 상태 + 대표 포화(Load) + CPU·메모리(게이지).
- Tier 2 `CategoryGrid`: USE 그룹(Utilization/Saturation/Errors/Traffic)을 각 `MetricCategoryCard` 로.
  카드 mini 스파크라인 = 그룹 대표 신호. 카드 body = 기존 `node-dd-row`(스파크라인+값+상태 텍스트) 유지.
- 안내(hint) 유지. Tier 3 `<details>` + `MetricExplorer` 유지.

## 테스트 케이스

### `web/src/pages/NodeMetrics.test.tsx` (기존 확장 — 회귀 방지 + 3층)
- 기존 6 케이스 전부 통과 유지(정렬·색+텍스트·에러·빈 상태·카드·상세 노출).
- **요약 스트립 게이지**: 상세 열면 Tier1 요약 스트립에 게이지(role=img, aria-label 에 상태 텍스트) ≥1.
- **카테고리 카드 그리드 반응형·접기/펼치기**: 상세에 `.metric-cat-card` ≥4(USE 4그룹), 카드 헤더 클릭 →
  `aria-expanded` 토글(펼침→접힘).
- **카드별 mini 스파크라인**: 각 카테고리 카드 헤더에 `.metric-cat-spark svg`(sparkline) 존재.
- **상태 색+텍스트 병기**: 위험 노드(node-02) 상세에 "위험" 텍스트 + 색 스타일 둘 다(기존 유지 + 요약).
- **전체 메트릭 링크(Tier3)**: `<details>` "전체 메트릭" disclosure 존재(IMP-71 회귀 없음).

### `web/src/components/MetricLayout.test.tsx` (신규 — 순수 컴포넌트)
- **SummaryStrip**: items 렌더 시 각 KPI 라벨·값 텍스트·게이지(aria-label 상태) 노출.
- **MetricCategoryCard 접기/펼치기**: 기본 펼침(children 보임) → 헤더 클릭 시 `aria-expanded=false`.
- **mini 스파크라인**: spark prop 있으면 `.metric-cat-spark` 안 svg 렌더, 없으면 미렌더.
- **상태 색+텍스트**: status=crit 이면 "위험" 텍스트 + 배지 노출(색-only 아님).
- **reduce-motion 경로**: caret/gauge 는 정적 DOM 으로 존재(애니는 CSS 가드 — DOM 은 항상 렌더).

## 출력 위치
- 신규: `web/src/components/MetricLayout.tsx`, `web/src/components/MetricLayout.test.tsx`
- 수정: `web/src/pages/Gpu.tsx`(SlidePanel 본문), `web/src/pages/NodeMetrics.tsx`(HostDetail), `web/src/index.css`
- 확장: `web/src/pages/NodeMetrics.test.tsx`

## 의존성
- IMP-54 `Gauge`, `Sparkline`, IMP-25 threshold line. IMP-71 `MetricExplorer`(Tier 3). IMP-76A `GpuHardwareSection`(Tier 2).
- `statusFromThresholds`/`worstStatus`(mockFactory) — 상태 단일 출처.

## 비회귀
- IMP-71 explorer(전량 드릴다운)와 IMP-76A 하드웨어 섹션은 3층 안에 그대로 중첩 — 기능·계약 불변.
- IMP-46 노드 화면 fleet 카드·정렬·mock 배지 불변.
- ObjectView(IMP-57/64/71) 요약/전체 메트릭 탭은 별도 표면 — 이 항목 범위 밖(건드리지 않음).
- 상태 색 + 텍스트 병기(WCAG 1.4.1), reduce-motion 안전, 라이트+스틸블루(네온 금지).
