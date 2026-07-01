# IMP-53 / IMP-51 — 인프라 화면 nav 그룹·cap 정합 + 폴링 신선도/정지·재개 일관 적용

- 날짜: 2026-07-01
- 브랜치: `feature/evolve-cycle3-topology`
- 유형: ux (S+S)
- 의존성: **none** (ZERO new deps). 기존 재사용 — IMP-21 `DataFreshness`, IMP-16 `client.getJSON`, IMP-26 `humanizeError`, 기존 nav `children` 패턴(모델·설정), Gpu.tsx `REFRESH_MS` 폴링 관례.

## 배경 / 현황

이번 사이클에 3개 인프라 화면이 신설됨:
- `web/src/pages/Topology.tsx` (IMP-45, nav '토폴로지')
- `web/src/pages/NodeMetrics.tsx` (IMP-46, nav '노드')
- `web/src/pages/Network.tsx` (IMP-49, nav '네트워크')

셋 다 `cap=dashboard`, router/Layout/App 에 flat 등록됨. 좌측 nav 는 이미 14+ flat 항목.
3화면 모두 이미 `REFRESH_MS(15s)` 폴링 + `DataFreshness` + `humanizeError` + 에러 시 마지막
성공 데이터 유지(에러 시 state 를 비우지 않음)를 갖췄다. **빠진 것**: nav 정보구조(그룹),
그리고 폴링의 (d) 정지/재개 토글 + (f) 에러 시 명시적 stale 배지(마지막 데이터 유지 중 표시).

## 목적

1. (IMP-53) nav flat 폭주 방지 — 인프라/관측 성격 화면을 하나의 확장 그룹으로 묶어 스캔성 회복.
2. (IMP-53) observe/manage 프로파일 정합 재확인 — 3화면 cap 게이트 우회(IMP-2 교훈) 없음 검증.
3. (IMP-51) 3화면 폴링 관례 통일 — 정지/재개 토글 + 에러 시 마지막 데이터 유지 + stale 배지.

## 요구사항

### IMP-53 — nav 정보구조 + cap 정합
- R1. `Layout.tsx` NAV 에 '인프라/관측' 그룹(비네비게이션 부모 = `page` 없음, `children` 사용)을
  신설: GPU/MIG · 노드 · 네트워크 · 토폴로지 · 트래픽 을 children 으로 묶는다.
  - 기존 nav `children` 렌더/확장/⌘K 자동반영/active·focus 관례를 그대로 재사용(신규 UI 로직 없음).
  - 부모는 `page` 없음 → 클릭 시 확장/접힘만(기존 Layout 은 `n.page &&` 가드로 이미 지원).
  - 그룹 가시성: children 중 하나라도 현재 프로파일에서 보이면 그룹 노출(전부 숨으면 그룹 숨김).
- R2. `router.ts` `PAGE_CAP` 에 3화면 `cap=dashboard` 등록 확인(이미 됨 — 회귀 가드 테스트로 고정).
- R3. backend capability 게이트 정합: topology/nodes/network 는 **백엔드 데이터 엔드포인트가 없음**
  (프론트 mock 전용 — `client.ts` `fetchTopology`/`fetchNodeMetrics`/`fetchNetwork` 가 `/topology`,
  `/nodes/metrics`, `/network` 로 요청하나 backend `server.go` 에 해당 라우트 미등록 = mock.ts 가 응답).
  따라서 게이트는 **프론트 cap(PAGE_CAP=dashboard)만** 담당. observe 는 `Dashboard` cap on →
  3화면 노출 + 읽기전용(mutating 라우트 없음). MCP/데이터 우회 경로 없음(백엔드 핸들러 자체가 없음).
  → 백엔드 변경 불필요. 명시적으로 문서화.
- R4. ⌘K CommandPalette 이동 항목: 기존 `visibleNav.flatMap` 이 부모(page 없음)는 건너뛰고
  children 을 `부모라벨 › 자식라벨` 로 자동 생성 → 그룹화해도 이동 명령 유지(회귀 없음).

### IMP-51 — 폴링 신선도/정지·재개/에러 복구
- R5. 공용 훅 `usePolling`(신규, `web/src/utils/usePolling.ts`)으로 3화면 폴링 로직 통일:
  - REFRESH_MS 간격 폴링(토큰화 상수 유지, 각 화면이 주입).
  - **정지/재개(pause)** — paused 면 interval 걸지 않음(재개 시 즉시 1회 로드).
  - **에러 시 마지막 성공 데이터 유지** — 에러가 나도 `data` 를 비우지 않음(이미 화면들의 관례).
  - **stale 플래그** — 에러 상태이면서 이전 성공 데이터가 있으면 `isStale=true`.
  - AbortController 로 in-flight 취소(IMP-16 정합), reduce-motion 은 CSS 가 이미 가드.
- R6. 공용 컴포넌트 `PauseToggle`(신규, `web/src/components/PauseToggle.tsx`): '일시정지/재개' 버튼
  (`aria-pressed`, target-size ≥ 기존 refresh-btn 관례). 3화면 page-head 에 배치.
- R7. 에러 배너에 마지막 데이터가 있으면 "마지막 데이터 표시 중" stale 안내(색 비의존 텍스트 병기).
- R8. 3화면의 데이터/시각/드릴다운/정렬/KPI 는 **불변**(비회귀) — 폴링 wiring 만 훅으로 치환.

## 함수 시그니처

```ts
// web/src/utils/usePolling.ts
export interface PollingState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;      // 최초 로드 중(data 없음)
  lastLoaded: number | null;
  paused: boolean;
  isStale: boolean;      // error 이면서 직전 성공 data 보유
  reload: () => void;    // 수동 새로고침
  setPaused: (p: boolean) => void;
}
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: { intervalMs: number; deps?: unknown[] },
): PollingState<T>;
```

```ts
// web/src/components/PauseToggle.tsx
export default function PauseToggle(
  props: { paused: boolean; onToggle: () => void; label?: string },
): JSX.Element;
```

```tsx
// Layout.tsx — NAV 그룹(부모 page 없음)
{ glyph: "▤", label: "인프라 · 관측", children: [
  { label: "GPU / MIG", page: "gpu" },
  { label: "노드", page: "nodes" },
  { label: "네트워크", page: "network" },
  { label: "토폴로지", page: "topology" },
  { label: "트래픽", page: "traffic" },
]}
```

## 테스트 케이스

- T1. (Layout) '인프라 · 관측' 그룹 부모가 렌더되고, children(노드·네트워크·토폴로지·GPU·트래픽) 을 가진다.
- T2. (Layout) 그룹 부모 클릭 → 확장되어 children 노출(토글).
- T3. (Layout, observe) `capabilities` = observe(dashboard on, mutating off) 에서 3화면 nav 노출 +
  '관제 전용' 배지 노출(읽기전용 정합). manage 와 노출 항목 동일(3화면 dashboard cap).
- T4. (router) `PAGE_CAP.topology/nodes/network === "dashboard"` (회귀 가드).
- T5. (usePolling) 정지 토글 → interval tick 이 fetcher 를 추가 호출하지 않음. 재개 → 즉시 1회 로드.
- T6. (usePolling) 최초 성공 후 에러 → `data` 유지 + `error` 세팅 + `isStale=true`.
- T7. (화면) PauseToggle 클릭 → aria-pressed 토글 + 폴링 정지(타이머 진행해도 fetch 증가 없음).
- T8. (화면) 성공 후 에러 시 마지막 데이터 계속 표시 + stale 안내 텍스트 노출.

## 출력 위치

- 신규: `web/src/utils/usePolling.ts`, `web/src/components/PauseToggle.tsx`,
  `web/src/utils/usePolling.test.tsx`, `web/src/components/Layout.nav.test.tsx`
- 수정: `web/src/components/Layout.tsx`(NAV 그룹), `web/src/pages/Topology.tsx`·`NodeMetrics.tsx`·`Network.tsx`
  (usePolling + PauseToggle + stale 배지), `web/src/index.css`(PauseToggle·stale 스타일), 3화면 기존 테스트 보강.
- router.ts: 무변경(회귀 가드 테스트만 추가 — `web/src/router.cap.test.ts`).
- backend: 무변경(mock 전용 — 위 R3).

## 비회귀 / 스코프

3화면 데이터·시각 유지. nav IA + 폴링 관례만 추가/통일. observe read-only 정합(IMP-2 우회 없음).
ZERO new deps.
