# IMP-77 — 온톨로지 객체 상태의 실시간 신선도·폴링 정합 (IMP-51 규약 승격)

- **Type**: ux (sev=medium, effort=S)
- **Branch**: `feature/evolve-cycle5-active-ontology`
- **Date**: 2026-07-02

## 배경 / 문제

`Gpu.tsx`·`NodeMetrics.tsx`·`Topology.tsx`·`Network.tsx`·`Inbox.tsx` 는 IMP-51 규약(`usePolling` +
`DataFreshness` + `PauseToggle` + stale→마지막 데이터 유지)으로 폴링·신선도·정지/재개가 일관된다.
그러나 이번 사이클에 늘어난 온톨로지 표면들은 진입 시 1회 로드가 중심이거나(스코어카드·ObjectView 드로어)
자체 `setInterval` 을 손수 굴려(COP·KineticStrip) 신선도 규약 밖에 있다:

- **COP(`Investigate.tsx`)** — 손수 `setInterval(15s)` + `DataFreshness` 만. **정지/재개 없음, stale 배지 없음.**
- **Ontology 스코어카드(`Ontology.tsx`)** — `useEffect` 1회 로드, `DataFreshness intervalMs={0}`(자동갱신 표기 없음). 폴링·정지·stale 없음.
- **ObjectView 드로어(`ObjectView.tsx`)** — `head` 변경 시 1회 로드. 신선도 표기·폴링 전무.
- **KineticStrip(`KineticStrip.tsx`)** — 자체 `setInterval(15s)` 폴링은 있으나 신선도 라벨·정지·stale 배지 없음.

능동 감지(IMP-72)·라이브 인사이트(IMP-78)가 이 표면 위에 앉으므로 "언제 기준 상태인지 · 자동 갱신 중인지 ·
정지 가능한지" 가 화면마다 달라 '늙은 온톨로지' 오인 위험이 있다.

## 목표 / 비목표

- **목표**: COP·ObjectView 드로어·Ontology 스코어카드·KineticStrip 4개 표면을 IMP-51 규약으로 **승격**하여
  "최종 갱신 N초 전 · 자동 Ns" + 자동 새로고침 + 정지/재개 + stale 시 마지막 데이터 유지 배지를 **일관** 적용.
- **목표**: 폴링 주기는 감지 신선도 vs 비용 균형(**15s 기본**). 드로어는 **열려 있을 때만** 폴링(닫히면 폴링 정지).
- **목표**: 상태 변화(stale 전환)를 `aria-live` 로 고지(색 비의존 + reduce-motion 안전 — 기존 primitive 그대로).
- **비목표**: 화면이 **보여주는 내용**은 바꾸지 않는다(신선도/새로고침/정지 규약만 통일). 새 기능·새 폴링 라이브러리 없음.
- **비목표**: AiAgent 생성적 인사이트(IMP-78 `runAgentInsights`)에 자동 폴링을 **강제하지 않는다** — 수동 "다시 분석" 유지.
  (RCA 탭의 `DataFreshness intervalMs={0}` 도 on-demand 성격이라 그대로 둔다.)

## 재사용 규약(IMP-51, 신규 발명 금지)

- `web/src/utils/usePolling.ts` — `{ data, error, loading, lastLoaded, paused, isStale, reload, setPaused }`.
- `web/src/components/DataFreshness.tsx` — "최종 갱신 N초 전 · 자동 Ns" + `role=status`/`aria-live` stale 고지.
- `web/src/components/PauseToggle.tsx` — `aria-pressed` 정지/재개 토글.
- 스테일 배지 카피: 에러 라인에 `.state-stale` "· 마지막으로 받은 데이터를 표시 중입니다."(Topology 관례).

## 설계 / 구현

### 1) `usePolling` 최소 확장 — `enabled` 옵션(하위호환)
현 `usePolling` 은 항상 `setInterval(intervalMs)` 를 건다. 드로어("열릴 때만") · KineticStrip(`intervalMs=0`)
케이스를 규약 안에서 처리하려면 **폴링만 끄되 초기/deps 로드는 유지**하는 스위치가 필요하다.
`opts.enabled?: boolean`(기본 `true`)을 추가한다:
- `enabled === false` → interval 미설치(초기 로드·deps 로드·`reload()`·정지/재개 로직은 유지).
- 기존 호출부(Topology/Inbox/Gpu·NodeMetrics/Network)는 `enabled` 미지정 → 기본 `true` → **동작 불변**.
- 새 폴링 라이브러리가 아니라 기존 primitive 의 1-인자 확장(effort=S 정합).

### 2) COP(`Investigate.tsx`)
- 손수 `load`/`setInterval` 제거 → `usePolling(async (signal) => { objects, links }, { intervalMs: 15s, enabled: !demoOn })`.
  - 데모 모드는 seeded fixture 라 폴링/신선도 대상 아님 → `enabled: !demoOn`(정지·라벨은 데모 아닐 때만 의미).
- page-head: 기존 `DataFreshness` 옆에 `PauseToggle`(데모 아닐 때만) 추가. 새로고침 버튼은 `reload` 로.
- 에러 라인에 `isStale` → `.state-stale` 배지. `loading`/`error` 게이트는 `poll.*` 로 대체(기존 조건 유지).

### 3) Ontology 스코어카드(`Ontology.tsx`)
- `useEffect` 1회 로드 → `usePolling(loadModel, { intervalMs: 15s })`.
- `DataFreshness intervalMs={0}` → `intervalMs={REFRESH_MS}`(자동 갱신 표기), `PauseToggle` 추가, 새로고침 = `reload`.
- 스코어카드/스키마 탭이 소비하는 `model` 은 `poll.data`. 에러/로딩 게이트는 `poll.*`. stale 배지 에러 라인에.

### 4) ObjectView 드로어(`ObjectView.tsx`) — **열릴 때만 폴링**
- `head` 키 로드(`fetchOntologyObject`+`fetchOntologyLinks`+`fetchOntologyObjects`)를
  `usePolling(fetchHead, { intervalMs: 15s, deps: [head], enabled: !!head })` 로 이관.
  - `enabled: !!head` → 드로어 닫히면(`objectId=null`→`head=null`) 폴링 정지("don't hammer when closed").
  - `deps:[head]` → traverse/재진입 시 즉시 재로드(기존 동작 보존).
- traverse back-stack·감사 로그·탭 리셋은 **컴포넌트 로컬 상태 그대로**(폴링과 독립). `head` 변화 시 리셋 로직 유지.
- Action 반영 후 `reloadHead()` → `poll.reload()` 로 대체(canonical 재로딩).
- 패널 헤더(breadcrumb 아래)에 컴팩트 `DataFreshness` + `PauseToggle` 한 줄(`ov-freshness`). stale 시 마지막 데이터 유지.
  - 폴링은 조용해야 하므로(드로어 잡음 억제) 라벨만 최소 표기. reduce-motion 은 기존 CSS 가 담당.

### 5) KineticStrip(`KineticStrip.tsx`)
- 자체 `setInterval` 제거 → `usePolling(fetchKineticAlerts→alerts, { intervalMs, enabled: intervalMs > 0 })`.
  - `intervalMs=0`(테스트·정적 사용) → `enabled:false` → 폴링 없음(초기 1회 로드만). 기존 계약 보존.
  - fetch 실패는 조용히 흡수(관제 보조 표면) — `usePolling` 이 마지막 데이터 유지 + `isStale` 제공.
- 알림 0건이면 스트립 미렌더(기존). 알림이 있으면 strip-head 우측에 `DataFreshness`(intervalMs>0 일 때만) +
  `PauseToggle`(폴링 켜졌을 때만) + stale 배지 추가.

### 6) AiAgent — 손대지 않음
생성적 인사이트는 on-demand("다시 분석"). 자동 폴링 강제 금지(비목표). 변경 없음.

## 테스트 케이스(Vitest, 백엔드 0개)

`usePolling.test.tsx` 확장:
- **enabled:false → interval tick 이 재조회하지 않음(초기 1회 로드만)**, `reload()` 는 여전히 1회 로드.
- (기존 케이스: 최초 로드 / interval 재조회 / 정지·재개 / 에러 시 stale 유지 — 회귀 없음.)

`Investigate.test.tsx` 확장:
- 신선도 라벨("자동 15s")이 렌더된다.
- 정지 토글 → interval tick 이 추가 `fetchOntologyObjects` 를 호출하지 않는다 / 재개 → 즉시 1회 따라잡기.
- fetch 실패(성공 후) → 마지막 경로 유지 + `.state-stale` 배지 노출.
- 데모 모드에서는 폴링/정지 토글이 뜨지 않는다(seeded fixture).

`Ontology.test.tsx` 확장:
- 신선도 라벨("자동 15s") + `PauseToggle` 렌더.
- interval tick 마다 재조회(스코어카드 자동 갱신).

`ObjectView.test.tsx` 확장:
- 드로어 열림 → 신선도 라벨 렌더 + interval tick 마다 재조회.
- 드로어 닫힘(objectId=null) → interval tick 이 재조회하지 않는다(닫혔을 때 hammering 없음).

`KineticStrip.test.tsx` 확장:
- `intervalMs>0` → 신선도 라벨 + `PauseToggle` 렌더 + tick 재조회.
- `intervalMs=0`(기존 테스트 기본) → 신선도/정지 컨트롤 미렌더 + 폴링 없음(회귀 없음).

공통(기존 primitive 가 보증, 회귀 확인):
- `aria-live` — `DataFreshness` 의 `role=status`/`aria-live=polite` 가 stale 전환 고지.
- reduce-motion — `@media (prefers-reduced-motion)` 전역 규칙이 spin/애니 정적화(신규 CSS 없음).

## 게이트

- `cd web && npm run test` 전부 통과.
- `cd web && npm run build`(tsc) 통과.
- 보안 라이트체크(UI/폴링 — secret/injection/unsafe 없음).

## 시각 QA(TOUCHED_SURFACES)

- `/investigate`(COP) — page-head 에 정지/재개 + "자동 15s", 정지 시 갱신 멈춤·재개 시 즉시 1회.
- `/ontology`(스코어카드) — page-head 에 "자동 15s" + 정지/재개.
- ObjectView 드로어(토폴로지/COP/스코어카드에서 객체 클릭) — 헤더에 신선도·정지, 닫으면 폴링 정지.
- KineticStrip(COP/스코어카드 상단) — strip-head 우측에 신선도·정지(폴링 켜졌을 때).
