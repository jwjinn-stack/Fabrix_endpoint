# IMP-89 — Endpoint↔app_id 라우팅을 온톨로지 관계로 노출

- **Type**: ux (sev=medium, effort=M)
- **Branch**: feature/evolve-cycle6-ontology-ux
- **Date**: 2026-07-02

## 배경 / 문제

`app_id` 는 Trace·Session·Key·Guard 표에 **leaf 컬럼**으로만 존재한다. `Trace --routedTo--> Endpoint`
링크는 있지만 "이 Endpoint 가 어느 app_id 들에 라우팅되나" 는 어디에도 **관계로** 드러나지 않아
COP/ObjectView/스키마 그래프에서 `Endpoint → App` 을 traverse 할 수 없다(direction 1).

## 결정 — App(Consumer) 객체 + `routes` 링크 (aggregate 아님)

lightweight **`App` ObjectType**(id=`app:<app_id>`)를 추가하고 **`Endpoint --routes--> App`** 링크로 잇는다.

- **왜 App 객체인가(aggregate 대신)**: IMP-84 관계 그래프·COP·ObjectView 가 전부 "객체를 traverse" 하는
  1급 시민 모델이다. Endpoint props 에 app_id 배열만 얹으면 traverse 불가(leaf 재생산). App 을 객체로
  승격해야 `Endpoint→App`(어느 앱이 이 EP 를 쓰나) + `App→Trace`(그 앱의 트레이스) 양방향 traverse 가 열린다.
- **왜 새 LinkKind `routes` 인가(`serves` 재사용 아님)**: `serves` 는 이미 `Endpoint --serves--> Model`
  의미로 고정돼 있다. 같은 kind 를 Endpoint→App 에 재사용하면 스키마 그래프의 타입쌍 대표 kind 가 모호해진다.
  전용 `routes`(라우팅 대상 소비자) 가 의미상 깔끔하고 스키마 그래프에서 구분된다.
- **App 상태**: 소비하는 Endpoint 들의 worst status 에서 파생(단일 출처). Endpoint 없으면 unknown.
- **App props(라우팅 요약 근거)**: `name`, `dept_id`, `endpoints`(라우팅 EP 수), `request_count`(대표 트레이스 기준
  집계 — 있으면), `endpoint_names`(요약 표시). 전부 결정적(메모이즈 스냅샷에서 파생).

## 구현

1. **types.ts**
   - `ObjectType` 에 `"App"` 추가.
   - `LinkKind` 에 `"routes"` 추가.
2. **mock.ts `buildOntologyFresh`**
   - Endpoint 승격 루프에서 각 EP 의 `app_id` 를 수집 → App 객체 생성(중복 dedup, APPS 메타로 name/dept 보강).
   - `Endpoint --routes--> App` 링크 push. `app_id` 없는 EP 는 건너뜀(graceful).
   - Trace 별 app_id 로 App 의 request_count 집계(대표 트레이스). trace 부재/app_id 부재면 0.
   - Endpoint props 에 라우팅 요약 힌트(`app_id` 는 기존 유지) — App 이 관계로 노출되므로 추가 배열 불필요.
3. **objectTypeVisual.ts** — `App` 시각 토큰 추가(글리프·라벨·색·틴트·className). 소비자=teal 계열과 구분되는
   보라(indigo/violet)나 기존 토큰. 네온 금지·기존 CSS 토큰만.
4. **ObjectView.tsx**
   - `TYPE_METRICS.App` 추가(endpoints·request_count).
   - `LINK_META.routes` 추가(라벨 "app 라우팅", 방향).
   - `KIND_ORDER` 에 `routes` 삽입(Endpoint→App 이 위계상 상류로 보이게).
   - Endpoint 헤더/관계: `routes` 그룹이 자동으로 "app_id 라우팅" 관계 섹션이 된다(기존 그룹 렌더 재사용).
5. **드릴스루(app_id 클릭)**
   - `router.ts` `NavParams` 에 `app?: string` 추가(Traces 의 `app` 필터 seed).
   - `Traces.tsx` app_id 컬럼 셀을 클릭 가능한 버튼으로 → `setFilter("app", app_id)`(같은 화면 필터).
   - ObjectView App 객체 → App→Trace traverse 로 그 앱의 트레이스 확인(관계 섹션).
6. **모든 `Record<ObjectType,…>` 맵 확장(dangling 방지)**:
   - `objectTypeVisual`(Record<ObjectType,…>), `ObjectView.TYPE_METRICS`,
     `ontologyScorecard.keysByType`×2(has-telemetry/threshold-signal),
     `Ontology.TYPE_DESC`, `MetricSources.OBJ_LABEL`, `AiAgent.TYPE_GLYPH`/`TYPE_LABEL`.
   - `ontologySchema.OBJECT_TYPES`(카탈로그·스키마 그래프 노출), `LINK_KINDS` 에 `routes`.
   - `SCORABLE_TYPES` 는 App 을 **제외**(Trace/Incident 처럼 준비도 채점 대상 아님 — 소비자 카탈로그 엔티티).
   - `Ontology.LINK_LABEL` 에 `routes`.
   - `Partial<Record<ObjectType,…>>`(agent/detection SUGGESTED_ACTION)은 App 미포함 OK(Partial).

## 격리(direction 9 / IMP-88)

- App 객체는 traces/app_id 부재 시 자연 degrade: EP 에 app_id 가 없으면 App 객체·routes 링크가 생성되지
  않을 뿐(빈 결과), 어떤 파생도 throw 하지 않는다. 모든 파생은 objects/links 순수 함수.
- IMP-88 스위트의 `ALL_TYPES`(7종 부재 전수) 는 그대로 통과. 카탈로그 길이 상수 비교는 OBJECT_TYPES 기준이라
  App 추가와 정합. App 부재 스냅샷(현 fixture)에서도 crash 없음.
- IMP-88 fixture 에 App 타입 부재 케이스를 1건 추가(App 없이도 파생 graceful) — 회귀 가드 강화.

## 테스트 케이스

1. **Endpoint→App relation present**: buildOntology 스냅샷에 `type==="App"` 객체 ≥1, 각 App 에
   `Endpoint --routes--> App` in-link ≥1. app_id 있는 EP 개수만큼 routes 링크.
2. **App routing summary**: App props 에 endpoints(라우팅 EP 수)·name 존재. Endpoint 의 out-link 중
   `routes` 로 App 에 도달 가능(traverse).
3. **App→Trace traverse**: App 이 그 app_id 트레이스들과 연결(routedTo 체인 또는 직접) — App 에서 트레이스로
   도달(관계 섹션). (App→Endpoint→Trace 경로로 최소 도달 보장.)
4. **app_id 클릭 drill-through**: NavParams 에 `app` 존재, `pathForPage("traces",{app})` 가 `app=` 쿼리 포함.
5. **결정적**: 두 번 buildOntology 스냅샷의 App 객체·routes 링크가 동일(id·개수·props).
6. **격리 graceful**: app_id 없는 Endpoint-only 스냅샷 → App 객체 0, routes 링크 0, throw 없음.
   빈 스냅샷/각 타입 부재에서 모든 파생 graceful(IMP-88 전수 유지).
7. **objectTypeVisual.App**: glyph/label/color/className 비어있지 않음(단일 출처 완전성).

## 비목표(out of scope)

- App 에 대한 mutating Action(App 은 read-only 소비자 엔티티).
- Endpoints 목록 표에 app_id 컬럼 신설(현 표는 app_id 컬럼이 없음 — Traces 의 기존 app_id 컬럼만 클릭화).
- 실백엔드 App 집계(mock-first; 실연동은 동일 계약으로 transport 스왑).
