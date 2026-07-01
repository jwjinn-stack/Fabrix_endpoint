# IMP-40 — 커스텀 대시보드 v1 (위젯 registry + show/hide + reorder + 레이아웃 저장)

- **Type**: compete (sev=medium, effort=L)
- **Branch**: feature/evolve-cycle2-obs
- **Area**: `web/src/pages/Dashboard.tsx`, `web/src/dashboardLayout.ts`(신규), `web/src/savedViews.ts`(패턴 재사용), `web/src/urlState.ts`(패턴 참고)
- **의존성**: 없음 (ZERO new deps — react-grid-layout / dnd-kit 도입 금지)

## 목적
Dashboard.tsx 는 HealthBanner + 고정 KPI/차트 배열이고, 표시 토글(panels)만 있고 **순서변경 불가**.
운영자가 역할(비용/SRE/보안)에 맞춰 위젯을 **선택(show/hide) + 순서변경(reorder)** 하고
그 레이아웃을 **localStorage 에 영속**하도록 한다. Grafana/Datadog/Langfuse 의 커스텀 대시보드
핵심 동선을 무의존으로 v1 구현. observe 프로파일도 개인 레이아웃은 localStorage 라 write-gate 불요.

## 요구사항 (v1)
1. **WIDGET REGISTRY**: Dashboard 의 고정 카드/차트(트래픽 KPI, 품질 KPI, 가드레일 KPI, GPU/MIG,
   부서/앱 분포, 시계열, 알람)를 typed 위젯 descriptor 카탈로그로 리팩터.
   각 descriptor = `{ id, title, persona, render(ctx) }`. 데이터/렌더 로직은 기존 그대로 보존(이동만).
   HealthBanner 는 항상 최상단 고정(상태 요약 — 레이아웃 대상 아님).
2. **EDIT MODE**: "뷰 편집" 토글 시 각 위젯에 show/hide 체크 + 위/위로/아래로 버튼(drag 금지, 의존성 0).
3. **PERSIST**: 레이아웃 = `{ order: WidgetId[], hidden: WidgetId[] }` 를 localStorage 에 저장/복원.
   savedViews.ts 의 방어적 read/write 패턴 재사용(잘못된 값 → default 폴백).
4. KPI 위젯은 IMP-27/35/44 시각 토큰(StatCard) 보존 — 카드 회귀 금지.

## Follow-up (v1 미포함 — half 구현 금지)
- drag/resize 재배치 (react-grid-layout 류)
- 명명된 multi-dashboard (여러 레이아웃 저장/전환)
- persona 템플릿 원클릭 적용(Cost/SRE/Security 프리셋)
- share-by-URL (레이아웃 직렬화 → querystring)
- 서버 동기화(manage 프로파일 mutation)

## 함수 시그니처 (`dashboardLayout.ts`)
```ts
export type WidgetId =
  | "traffic" | "quality" | "guardrail" | "gpu"
  | "distribution" | "timeseries" | "alarms";

export type Persona = "cost" | "sre" | "security" | "ops";

export interface DashboardLayout {
  order: WidgetId[];     // 표시 순서(전체 위젯 id 의 순열)
  hidden: WidgetId[];    // 숨김 처리된 위젯 id
}

export const ALL_WIDGETS: readonly WidgetId[]; // 기본 순서(canonical)
export const DEFAULT_LAYOUT: DashboardLayout;  // order=ALL_WIDGETS, hidden=["gpu"]

export function loadLayout(): DashboardLayout;          // localStorage → 방어적 파싱 → 정규화
export function saveLayout(layout: DashboardLayout): DashboardLayout; // 저장(실패 무시) 후 반환
export function normalizeLayout(raw: unknown): DashboardLayout; // 임의 값 → 유효 레이아웃(누락 보강·미지 제거·중복 제거)
export function moveWidget(layout: DashboardLayout, id: WidgetId, dir: "up" | "down"): DashboardLayout;
export function toggleWidget(layout: DashboardLayout, id: WidgetId): DashboardLayout;
export function isVisible(layout: DashboardLayout, id: WidgetId): boolean;
```
- `normalizeLayout`: order 에 모든 ALL_WIDGETS 가 정확히 1회 등장하도록 보정(누락은 canonical 순서로 append,
  미지/중복 제거). hidden 은 ALL_WIDGETS 교집합만. throw 금지.
- localStorage key: `fabrix.dashboard.layout` (기존 `fabrix.dashboard.panels` 는 제거/대체).

## 테스트 케이스 (`dashboardLayout.test.ts` + `Dashboard.layout.test.tsx`)
- show/hide 토글: toggleWidget 후 isVisible 반전, hidden 배열 반영
- reorder up/down: moveWidget 으로 인접 위젯과 swap, 경계(맨위 up/맨아래 down)는 무변
- localStorage roundtrip: saveLayout → loadLayout 동일 복원
- 기본 폴백: localStorage 비었을 때 loadLayout === DEFAULT_LAYOUT(정규화)
- 잘못된 저장값 방어: 비-JSON / 배열아님 / 미지 위젯 id / 누락 위젯 → normalize 로 유효 레이아웃, throw 없음
- 정규화: 누락 위젯 append, 중복/미지 제거, hidden 교집합
- RTL: 편집모드에서 위젯 숨기면 본문에서 사라짐 / 아래로 버튼 클릭 시 순서 바뀜(저장됨)

## 출력 위치
- `web/src/dashboardLayout.ts` (신규)
- `web/src/dashboardLayout.test.ts` (신규)
- `web/src/pages/Dashboard.tsx` (리팩터)
- `web/src/pages/Dashboard.layout.test.tsx` (신규)
- `web/src/index.css` (편집 컨트롤 스타일 소량 추가)

## 비회귀
- 기존 위젯 렌더/데이터(StatCard·BarList·TimeseriesChart·Alarms·HealthBanner) 보존 — 배치/토글만 추가.
- IMP-27 카드 토큰 유지. FE only. 민감영역 아님(저장값은 위젯 id 참조뿐, 민감정보 없음).
