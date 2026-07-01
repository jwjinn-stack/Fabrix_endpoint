# IMP-62 — IA 재편 — nav 를 관측→추적→제어 흐름 5그룹으로(탐색/관측/추적/제어/연동)

- Type: ux (sev=medium) · Cycle4 온톨로지
- Branch: `feature/evolve-cycle4-ontology`
- Sources: docs/palantir-ontology-analysis.md §7(IA 재구성 제안 — 트러블슈팅 흐름 중심) · 기존 Layout.tsx nav children 규약 · router PAGE_CAP

## 문제 (Why)

`Layout.tsx` 의 nav 는 **메트릭 나열형**(플랫한 최상위 항목 + 인프라 화면만 묶은 단일 그룹, IMP-53). router `ROUTES` 도 플랫하다. doc §7 은 팔란티어식 **object-centric + 흐름 중심** IA 를 제안한다 — 사용자가 **관측→추적→제어** 순서로 자연스럽게 흐르도록. IMP-53 은 인프라 그룹만 정리했을 뿐 전면 재편이 아니다. 특히 이번 사이클에 추가된 근본원인 추적(COP, `/investigate`)·AI Agent(`/agent`)·온톨로지(`/ontology`)가 "인프라·관측" 그룹 안에 섞여 있어 1급 흐름으로 드러나지 않는다.

## 해결 (What)

`Layout.tsx` 의 NAV 를 **5개 흐름 그룹**으로 재편한다. **기존 페이지는 하나도 제거·개명하지 않고**(라우트 그대로), 그룹 헤더만 추가하고 소속만 재배치한다. doc §7 매핑:

- **탐색(Explore)**: 온톨로지(`/ontology`) — Object 탐색은 온톨로지 개요가 겸한다(전용 엔트리 없음).
- **관측(Observe)**: 관제(dashboard) · 사용량(usage) · 트레이스(traces) · 세션(sessions) · GPU/MIG(gpu) · 노드(nodes) · 네트워크(network) · 토폴로지(topology) · 트래픽(traffic).
- **추적(Investigate)**: 근본원인 추적(COP)(`/investigate`). (Incidents 는 investigate 화면 내부 surface — 전용 라우트 없음.)
- **제어(Operate)**: AI Agent(`/agent`) · 플레이그라운드(playground). (Actions 는 ObjectView/Investigate 내부 — 전용 라우트 없음.)
- **연동(Integrate)**: 연동 상태(diagnostics) · 모델(models) · 모델 임포트(model-import) · 엔드포인트(endpoints) · 서드파티 자격증명(credentials) · 키·앱(keys) · 가드레일(guard) · 평가(eval) · 설정(settings).

판단 콜(guard/eval/keys/traffic 배치): 5-그룹 흐름의 의도(관측=현상 보기 / 추적=원인 / 제어=행위 / 연동=구성·거버넌스)로 묶는다.
- traffic → **관측**(트래픽 흐름은 현상 관측).
- guard/eval/keys → **연동**(정책·구성·거버넌스 성격, 배포·연동 축).

## 설계 (How)

### 기존 데이터 shape 확장(재작성 금지)

현 `NavItem = { glyph, label, page?, soon?, children? }` / `NavChild = { label, page }`. groupless 그룹(page 없음 + children)은 클릭 시 확장/접힘만(자식만 이동). 기존 "인프라·관측" 이 이미 이 패턴을 쓴다 — **동일 패턴을 5그룹 전부에 적용**한다.

- 5개 그룹 전부를 `page` 없는 groupless 그룹으로 정의(각자 glyph + 한글 label + children).
- 오늘 2단 서브(models→model-import, settings→credentials)는 `NavChild` 가 플랫(`{label,page}`)이라 3단 중첩이 불가. → **model-import·credentials 를 소속 그룹(연동)의 형제 children 으로 평탄화**한다. 두 화면은 이미 고유 라우트(`/models/import`, `/settings/credentials`)·`App.tsx` 렌더 스위치(effPage 기반, L108/L120)를 가져 nav shape 와 무관하게 도달 가능 → 평탄화해도 렌더·라우팅 불변.
- **capability 게이팅(PAGE_CAP)·capForPage·visibleNav 필터·expand/collapse·active highlight·⌘K 명령 생성·a11y(aria-expanded/aria-current) 로직은 전부 그대로 재사용**. 이미 groupless 그룹을 처리하므로 데이터만 바꾸면 됨. observe 프로파일에선 mutating cap 이 꺼진 항목이 자동으로 빠져 제어/연동 그룹이 자연히 줄어든다.

### 파일

- `web/src/components/Layout.tsx`: `NAV` 상수만 5그룹으로 교체(+그룹 의도 한글 주석). `Page` union·게이팅·렌더 JSX·⌘K 로직 불변.
- `web/src/components/Layout.nav.test.tsx`: 5그룹 + 소속을 검증하도록 갱신.

### 불변(회귀 가드)

- `router.ts` `ROUTES`·`PAGE_CAP`·`capForPage` **전혀 손대지 않음** → `router.cap.test.ts` 통과 유지.
- 모든 기존 페이지는 **정확히 한 번** 그룹 아래 등장(orphan 라우트 0).

## 테스트 케이스 (normal / retry / failure / bad-input / env-missing)

- **normal(그룹 렌더)**: 5그룹 부모(탐색/관측/추적/제어/연동)가 모두 nav 에 렌더된다.
- **normal(소속·도달성)**: 각 그룹을 펼치면 소속 화면이 노출되고, 자식 클릭 시 `onNavigate(page)` 호출. 신규 3화면 — 온톨로지→탐색, 근본원인 추적→추적, AI Agent→제어 — 이 각 그룹에 있다. 모든 기존 페이지가 어느 한 그룹에 정확히 한 번 등장(orphan 0).
- **normal(자동 확장)**: 현재 페이지가 그룹 자식이면 그 그룹이 자동 확장(aria-expanded=true), active highlight 유지.
- **retry(확장/접힘 토글)**: 그룹 부모를 두 번 클릭하면 열림→닫힘. groupless 이므로 부모 클릭은 이동하지 않는다(onNavigate 미호출).
- **failure/게이팅(observe)**: observe(dashboard on, mutating off)에서 mutating cap 필요 항목(예: 플레이그라운드=playground cap off → 제어 그룹에서 숨음, guard/models 등 연동 항목)은 숨고, dashboard cap 화면(온톨로지·관측 전부·근본원인 추적)은 노출. "관제 전용" 배지 표시.
- **failure/그룹 전체 숨김**: 그룹의 보이는 자식이 0이면 그룹 헤더 자체가 사라진다(빈 그룹 미표시).
- **bad-input**: 존재하지 않는 라우트/알 수 없는 page 는 라우터가 dashboard 로 폴백(router 기존 계약; 본 변경은 nav 표시만 다룸).
- **env-missing**: capability 응답이 비어도(cap 미정=허용) 항상-허용 화면 그룹은 렌더된다(useCap mock 기본 manage/전부 허용 경로로 검증).

## Out of scope

- 라우트 개명·페이지 삭제·router `ROUTES`/`PAGE_CAP` 변경.
- 전용 "Object 탐색기"·"Incidents"·"Actions" 라우트 신설(각각 온톨로지/Investigate/ObjectView 내부 surface 로 충분).
- nav 시각 스타일(색·아이콘) 변경 — 그룹 재편만.

## TOUCHED_SURFACES (visual QA)

좌측 사이드바 nav 전체(모든 화면 공통) — 최상위가 5개 흐름 그룹(전부 확장/접힘 헤더)으로 바뀜. 기존 플랫 항목(관제·온톨로지·사용량·가드레일·모델·플레이그라운드·평가·엔드포인트·키·앱·트레이스·세션·연동 상태·설정)이 그룹 하위로 이동. model-import·credentials 는 연동 그룹의 형제 항목으로 평탄화. 확장 상태·active highlight·⌘K 이동 목록 회귀 확인.
