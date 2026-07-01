# IMP-88 — 기능 격리 회귀 테스트 (cap-off / 라우트 미등록 시 나머지 앱 동작 보장)

- **Type**: code (sev=high, effort=S) · Direction 9 (isolation)
- **Branch**: feature/evolve-cycle6-ontology-ux
- **Date**: 2026-07-02

## Why (배경)
FABRIX 는 고객사별로 화면·기능을 선택 활성화해 배포한다. 한 기능을 빼거나(cap OFF /
라우트 미등록) 해도 나머지 화면이 **조용히** 깨지면 안 된다. 두-프로파일 게이팅
(`capabilities` + `PAGE_CAP`)과 mock 파생(`buildOntology` 및 스코어카드/Kinetic 감지/
메트릭 트리)이 강하게 얽혀 있어, IMP-90(`/inbox` 격리 제거)·향후 cap-off 작업이 회귀를
부를 위험이 있다. 이 아이템은 그 안전 전제인 **자동 회귀 가드**를 세운다.

이 테스트가 없으면 "빼도 나머지 통과"가 리뷰어 눈검사에만 의존한다 —
IMP-90 을 안전하게 진행하려면 기계적 가드가 선행돼야 한다.

## Scope
- TEST-ONLY. 실제 크래시가 드러날 때만 **최소** 방어 가드 추가(광범위 리팩터 금지).
- `/inbox` 제거는 하지 않는다(그건 IMP-90). 여기선 "제거해도 안전함"을 증명하는 가드만.

## 설계 — 무엇을 어떻게 검증하나

### 얽힘 지도(사전 조사 결과)
- **라우트/캡 층**: `router.ts`(`ROUTES`/`PAGE_CAP`/`pageFromPath`/`capForPage`) →
  `App.tsx`(`effPage` = cap 불허 시 `dashboard` 폴백) → `Layout.tsx`(cap off 자식·그룹 숨김).
- **mock 파생 층**(전부 `objects`/`links` 배열을 인자로 받는 순수 함수 → 타입 부재를
  직접 주입해 검증 가능):
  - `buildScorecard(objects)` — `SCORABLE_TYPES` 로 `filter`, 규칙 `applies`/안전 접근자.
  - `attributeDetections(objects, links, opts)` — crit/warn + Model/GpuDevice/Node 만 승격,
    `num()` 안전 추출.
  - `buildSchemaGraph(objects, links)` / `buildObjectTypeCatalog(objects)` /
    `buildGraph(objects, links)` — dangling 타입 방어, `usedTypes` 기반 노드 구성
    (IMP-68 이 Task 노드 누락 크래시를 이미 가드).

### 테스트 케이스 (web/src/isolation.test.tsx)
1. **cap 매트릭스 × 핵심 화면 라우트 정합**: 각 코어 화면(dashboard·ontology·endpoints
   ·gpu·traces)에 대해, 그 화면의 cap 을 OFF 로 둔 `can` 을 만들어 App 의 `effPage`
   폴백 로직(`!cap || can(cap) ? page : "dashboard"`)이 크래시 없이 동작하고, cap OFF 화면은
   dashboard 로 폴백, 나머지는 자기 자신으로 유지됨을 assert.
2. **라우트 미등록 폴백**: `pageFromPath` 가 미등록/미지 경로에 대해 dashboard 로 폴백
   (throw 없음). 코어 경로는 왕복(round-trip) 유지.
3. **nav 필터가 cap-off 에서 크래시 없이 렌더**: 각 코어 cap 을 하나씩 OFF 로 `Layout` 렌더
   → throw 없음 + 남은 nav 항목이 여전히 보임(그룹 전멸 시 그룹째 숨김도 정상 동작).
4. **"빼도 나머지 통과" 회귀 가드**(제거 대상 대비):
   - ontology cap OFF → dashboard·endpoints 는 여전히 접근/렌더.
   - endpoints cap OFF → ontology·dashboard 는 여전히 접근/렌더.
   - inbox(=dashboard cap 공유) 경로 미등록 시뮬레이션 → 나머지 라우팅 무영향(IMP-90 전제).
5. **mock 파생 크래시 가드(타입 부재 → degrade, not crash)**: 코어 스냅샷에서 특정 타입
   (Task / Endpoint / GpuDevice)을 필터로 제거하거나 빈 배열을 넣어도 `buildScorecard`
   ·`attributeDetections`·`buildSchemaGraph`·`buildObjectTypeCatalog`·`buildGraph` 가
   throw/undefined-access 없이 결과를 반환(카탈로그는 타입당 카드 유지 등 graceful degrade)함을 assert.
   특히 Task 만 있는 스냅샷·Endpoint 부재 스냅샷을 명시 케이스로.

## 파일
- 추가: `web/src/isolation.test.tsx` (신규 격리 회귀 스위트)
- (필요 시) 최소 방어 가드: 위 파생 중 실제 크래시가 나는 지점에만.

## 완료 기준
- `npm run test` 전체 PASS + `npm run build`(tsc) PASS.
- IMPROVEMENTS.md 의 IMP-88 Status → done.
- 보안 라이트체크(테스트/가드 코드 — clean).
