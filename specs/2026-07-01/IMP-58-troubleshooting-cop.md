# IMP-58 — Troubleshooting Flow(COP) 화면 — Endpoint→Model→GPU→Node 근본원인 추적 단일 화면

- Type: ux (sev=high) · Cycle4 온톨로지 · 시그니처 딜리버러블
- Branch: `feature/evolve-cycle4-ontology`
- Sources: Datadog Watchdog RCA · Grafana RCA Workbench(assertion timeline + dependency graph + entity-click KPI drawer in one screen) · Dynatrace Davis/Smartscape · arXiv 2512.22113 · docs/palantir-ontology-analysis.md §5.2, §4

## 문제 (Why)

근본원인 추적이 오늘은 화면 점프(Topology→Gpu→NodeMetrics)로만 가능하고, 컨텍스트는 URL 필터로만 이어져 파편화된다. Palantir COP(Common Operating Picture)처럼 **느린 Endpoint 하나에서 출발해 관계 그래프를 따라 원인 후보(어느 Model/GPU/Node, 그 Node 의 다른 영향 Service)까지 한 화면에서** — 각 hop 의 골든시그널을 나란히 보며 — 추적하는 경로가 없다.

## 해결 (What)

새 페이지 `/investigate` 를 추가한다. 3요소:

1. **LEFT — 진입 Object**: 문제 Endpoint(또는 Incident). `?entity=` deep-link(urlState `investigateSchema`). 진입 후보(느린 Endpoint / triggered Incident) 리스트에서 선택.
2. **CENTER — 근본원인 PATH**: 온톨로지 링크를 따라 자동 확장하는 hop 카드 세로 스택.
   경로: `Endpoint --serves--> Model --runsOn--> GpuDevice --hostedBy--> Node --(blast-radius) 그 Node 의 다른 영향 Service`.
   각 hop 카드: 골든시그널(latency/error/util) + status Badge + anomaly band(Sparkline warn/crit 임계선) + edge-type badge(serves/runsOn/hostedBy/impacts).
3. **RIGHT — KPI 드로어**: hop 클릭 시 상세 metric + ObjectView(IMP-57, in-place traverse + inline Action IMP-59).

### 필수 3요소

- **[a] 시간축 정렬**: 각 hop 을 first-anomaly time 으로 badge("먼저 무너진 것"). 결정적 seed 로 산출.
- **[b] 임계 hop 자동 지정**: 가장 이른 first-anomaly hop 을 "추정 근본원인" 으로 라벨.
- **[c] 조기 종결 방지(blast-radius)**: 첫 임계 hop 이후 **한 hop 더** 확장 — 상류 or 같은 Node 의 다른 영향 Service — 으로 blast-radius 를 보여준다.

edge-type badge(runsOn/hostedBy/impacts)는 mock.ts 온톨로지에서 결정적으로 생성된 링크에서 파생. Copy 는 **"추정 근본원인 / 영향 경로"** (상관을 인과로 과장 금지).

## 설계 (How)

- **순수 traversal 모듈** `web/src/api/investigate.ts`:
  - `buildRootCausePath(objects, links, entryId, seedFn)` → `RootCausePath` (순수 — 단위 테스트로 가드).
  - 온톨로지는 client `fetchOntologyObjects()` + `fetchOntologyLinks()` 로 이미 제공(IMP-56). 새 엔드포인트 불필요.
  - hop 별 골든시그널 시계열 + first-anomaly index 는 `seededSeries`/`hash` 로 결정적 생성(mockFactory 재사용).
  - `pickEntryCandidates(objects, links)` → 진입 후보(느린/미준비 Endpoint + triggered Incident) 결정적 정렬.
- **페이지** `web/src/pages/Investigate.tsx`: LEFT(후보+진입) / CENTER(hop 스택) / RIGHT(useObjectView + ObjectView). Gpu.tsx page-head + DataFreshness 미러.
- **배선**: router.ts(`investigate` → `/investigate`, PAGE_CAP=dashboard) · Layout.tsx nav("인프라·관측" 그룹 하단) · App.tsx render switch · urlState `investigateSchema`(`entity`).
- **재사용**: Gauge/Sparkline(골든시그널·anomaly band) · ObjectView/useObjectView(RIGHT) · ActionForm(ObjectView 내부) · statusFromThresholds/worstStatus(단일 출처).

## 데이터 계약

- 신규 타입 없음(온톨로지 OntologyObject/OntologyLink 재사용). 페이지-로컬 타입 `Hop`/`RootCausePath`/`EntryCandidate` 는 investigate.ts 에 둔다.
- edge-type badge: hop.linkKind(serves|runsOn|hostedBy|affects→"impacts") 를 라벨링.

## 테스트 케이스

- **normal**: 페이지가 진입 Object + 자동확장 PATH 렌더 / hop 카드가 골든시그널 표시 / 임계 hop "추정 근본원인" 라벨 / blast-radius 추가 hop 존재.
- **retry(결정성)**: 같은 entryId 재빌드 시 동일 경로·동일 first-anomaly 순서.
- **failure**: 알 수 없는 entity → 빈 경로 graceful(throw 없음, 안내 메시지).
- **bad-input**: entryId="" / 링크 없는 고립 Object → 단일 hop(진입만) + blast-radius 없음.
- **env-missing**: 온톨로지 fetch reject → 에러 상태(페이지 죽지 않음).
- hop 클릭 → 드로어/ObjectView 열림 · `?entity=` deep-link 복원 · nav/route 등록.

## Out of scope

- 실제 인과 추론(ML) — mock 은 first-anomaly 시간 heuristic 만. Copy 로 "추정" 명시.
- ObjectView/ActionForm/온톨로지 타입 변경(additive 만).
