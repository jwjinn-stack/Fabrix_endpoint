# IMP-70 — 온톨로지 진입점 재배치 — 과업(Inbox)·상황(COP)·객체 랜딩, 스키마 개요 강등(박물관 정문 제거)

- Type: ux (sev=medium, effort=M) · Cycle5 active-ontology
- Branch: `feature/evolve-cycle5-active-ontology`
- Sources: docs/ontology-usecase-comparison.md §2(패턴 1·5)/§4, Datadog Service Page(https://docs.datadoghq.com/tracing/services/service_page/)

## 문제 (Why)

실사례(Netflix·Datadog·ServiceNow·Palantir)는 오퍼레이터를 **과업/상황/객체**(TASK·SITUATION·OBJECT)에 랜딩시키고, 글로벌 스키마 그래프는 **분리된 참조 아티팩트**로 둔다(패턴 1·5). IMP-62 로 nav 를 5그룹화했으나 그룹 **순서**가 여전히 `탐색(ontology 추상 개요) → 관측 → 추적 → 제어 → 연동` 이라, 추상 온톨로지 개요가 사이드바 **최상단 정문**처럼 노출돼 "박물관 입구" 인상을 준다. IMP-68 은 이미 `/ontology` **화면 내부**를 재설계했다(기본 탭=운영 준비도 스코어카드, 스키마 그래프는 "스키마 참조" 보조 탭). IMP-70 은 남은 절반 — **nav/랜딩 레벨**의 재배치 — 를 마무리한다.

기본 랜딩 자체는 이미 actionable 하다: `pageFromPath("/")` 와 미지 경로는 `dashboard`(관측) 로 폴백한다(온톨로지 아님). 문제는 순전히 **IA 순서/프레이밍** 이다.

## 해결 (What)

**nav 그룹 순서 재배치 + 온톨로지 그룹 프레이밍 강등** 만 한다. 페이지·라우트·PAGE_CAP·렌더 스위치는 **전혀 손대지 않는다**(orphan 0).

1. **그룹 순서 재배치** — 일상 흐름(관측→추적→제어)이 먼저 오도록:
   `관측(Observe) → 추적(Investigate) → 제어(Operate) → 참조(Reference·온톨로지) → 연동(Integrate)`.
   - 관측→추적→제어 가 사이드바 상단 3그룹으로 연속 노출돼 흐름이 legible.
   - 온톨로지 개요 그룹은 **정문(최상단)에서 운영 흐름 뒤 참조 위치로 강등**. 여전히 도달 가능(reachable).
2. **온톨로지 그룹 프레이밍 강등** — 그룹 label 을 `탐색`(개방적 탐색=정문 뉘앙스) → **`참조`**(Reference=스키마/개요 참조 surface) 로 바꾼다. 자식 `온톨로지` 는 그대로. 이는 "reference/schema surface, not the primary entry" 를 nav 레벨에서 구현. (화면 내부 스코어카드/스키마-참조 분리는 IMP-68 이 이미 완료 — 재작업 금지.)
3. **기본 랜딩 = task-anchored actionable surface** — `pageFromPath` 의 루트/미지 폴백이 `dashboard`(관측, 온톨로지 아님) 임을 회귀 테스트로 못박는다. 별도 "home" 개념이 없으므로 기본 라우트가 곧 랜딩 — 이미 정답(dashboard=관제)이며 이를 고정한다.
4. **불변** — 모든 라우트 reachable(orphan 0), capability 게이팅(PAGE_CAP/capForPage) 불변, 키보드 a11y(aria-expanded/aria-current)·active highlight·⌘K 명령 생성 로직 전부 재사용.

## 설계 (How)

### 파일

- `web/src/components/Layout.tsx`: `NAV` 상수의 **그룹 배열 순서** 재배치 + 온톨로지 그룹 `label`("탐색"→"참조")·의도 주석 갱신. glyph/자식/데이터 shape·게이팅·렌더 JSX·⌘K·a11y 로직 **불변**.
- `web/src/components/Layout.nav.test.tsx`: 소속 표(GROUPS) 를 새 label("참조")·새 순서로 갱신 + **그룹 순서 회귀 테스트** 추가(관측이 참조·연동보다 앞, 추적·제어가 참조보다 앞).
- `web/src/router.cap.test.ts`: **기본 랜딩 회귀 테스트** 추가(`pageFromPath("/")`·`pageFromPath("/museum-front-door")` 가 온톨로지가 아닌 actionable surface=dashboard).

### 데이터 shape (재작성 금지)

현 `NavItem = { glyph, label, page?, soon?, children? }`. groupless 그룹(page 없음+children)은 클릭 시 확장/접힘만. 5그룹 전부 이 패턴 유지. **배열 순서만** 바꾸고 온톨로지 그룹 `label` 만 교체한다.

### 불변(회귀 가드)

- `router.ts` `ROUTES`·`PAGE_CAP`·`capForPage` **손대지 않음** → 기존 router.cap.test 통과 유지.
- `App.tsx` 기본 라우트 로직·렌더 스위치 **손대지 않음**(pageFromPath 폴백이 이미 dashboard).
- 모든 기존 페이지는 **정확히 한 번** 그룹 아래 등장(orphan 0) — GROUPS 표 vs ROUTES 전체 집합 일치.

## 테스트 케이스 (normal / retry / failure / bad-input / env-missing)

- **normal(기본 랜딩)**: `pageFromPath("/")` 가 `dashboard`(task-anchored actionable surface), **`ontology` 아님**. → 오퍼레이터가 박물관 정문(온톨로지 개요)에 랜딩하지 않는다.
- **normal(그룹 순서=관측→추적→제어→참조→연동)**: nav 그룹 부모 순서가 흐름을 반영. `관측` 인덱스 < `추적` < `제어` < `참조`, 그리고 `관측/추적/제어` 모두 `참조`·`연동` 보다 앞. (관측→추적→제어 흐름 legible + 온톨로지 강등 증명.)
- **normal(온톨로지 강등·존재)**: 온톨로지 개요는 **여전히 도달 가능**하되 "탐색" 정문이 아니라 **"참조" 그룹**에 있고, 그 그룹이 최상단이 아니다(관측 뒤). 자식 `온톨로지` 클릭 → `onNavigate("ontology")`.
- **normal(orphan 0)**: GROUPS 표의 page 집합이 ROUTES 전체와 정확히 일치(누락·중복 0) — 재배치로 라우트를 잃지 않았다.
- **normal(자동 확장)**: 현재 페이지가 그룹 자식이면 그 그룹 자동 확장(aria-expanded=true) + active highlight 유지(재배치 후에도).
- **retry(확장/접힘 토글)**: 그룹 부모 두 번 클릭 → 열림→닫힘. groupless 이므로 부모 클릭은 이동하지 않음(onNavigate 미호출).
- **failure/게이팅(observe) 불변**: observe(dashboard on, mutating off)에서 mutating cap 항목(플레이그라운드/가드레일 등)은 숨고 dashboard cap 화면(온톨로지·관측 전부·추적)은 노출 + "관제 전용" 배지. 재배치가 게이팅을 바꾸지 않음.
- **bad-input**: 존재하지 않는 경로(예: `/museum-front-door`)는 라우터가 `dashboard` 로 폴백(온톨로지 아님).
- **env-missing**: capability 응답이 비어도(cap 미정=허용) 항상-허용 그룹은 렌더(useCap mock 기본 manage 경로).

## Out of scope

- 라우트 개명·페이지 삭제·router `ROUTES`/`PAGE_CAP` 변경.
- `/ontology` **화면 내부** 재설계(스코어카드 기본 탭 / 스키마 참조 보조 탭) — IMP-68 이 이미 완료.
- 전용 "Object 탐색기"·"Incidents"·"Actions" 라우트 신설(각각 온톨로지/Investigate/ObjectView 내부 surface).
- nav 시각 스타일(색·아이콘)·페이지 재빌드 — 순서/프레이밍/기본 라우트 고정만.

## TOUCHED_SURFACES (visual QA)

좌측 사이드바 nav 전체(모든 화면 공통):
- 그룹 순서가 **관측 → 추적 → 제어 → 참조 → 연동** 으로 바뀜(이전: 탐색 → 관측 → 추적 → 제어 → 연동). 관측→추적→제어 3그룹이 상단에 연속 노출.
- 최상단 그룹이 `탐색(온톨로지)` → `관측(관제…)` 으로 교체 — 오퍼레이터가 actionable surface 를 먼저 본다.
- 온톨로지 그룹 헤더 label 이 `탐색` → **`참조`** 로 바뀌고 운영 흐름 **뒤**로 이동(정문 강등, 여전히 확장/접힘 헤더로 도달 가능).
- 기본 진입(`/`) 은 `관제`(dashboard) 화면 — 온톨로지 개요 아님(회귀 테스트로 고정).
- 확장 상태·active highlight·⌘K 이동 목록·게이팅 회귀 없음 확인.
