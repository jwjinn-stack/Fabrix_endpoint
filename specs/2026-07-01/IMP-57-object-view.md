# IMP-57 — Object View 화면 (단일 엔티티 상세 + 관계 패널 + Action 버튼 kinetic)

- Type: ux (sev=high)
- Cycle: evolve-cycle4-ontology
- 선행: IMP-56(ontology types/mock/client), IMP-59(ActionForm)

## 문제 (Problem)

Topology.tsx 노드 선택 패널은 메트릭 리스트 + 드릴다운 버튼만 보여주고, 관계를
in/out **개수(inCount/outCount)** 로만 노출한다. Palantir Workshop 스타일의 **Object View**
— 한 엔티티의 속성 + 인접 관계(클릭 가능한 이웃 객체) + 상단 Action — 가 없다.
'Model qwen25-vl-7b' 를 열어 그 replicas·GPUs·소비 Services·최근 Traces·연결 Incidents 를
한 패널에서 보고 조치(act)할 수 없다.

## 해결 (Fix)

`SlidePanel` 프리미티브 위에 공용 `ObjectView` 패널을 만든다. 진입점은 (공통 entry)
Topology 노드 클릭 + Traces 행 + Models 행. Palantir/Datadog 순서:

1. **Header** — 타입 글리프 + title + 상태 Badge + 두드러진 metric(s) 를 elevated 카드로.
2. **Properties 테이블** — `DetailRow` 재사용.
3. **Related 섹션** — linkKind 로 그룹(Replicas / GPUs / consuming Services / recent Traces /
   linked Incidents). 각 이웃은 **클릭 가능** → **같은 패널에서 in-place traverse** + 작은
   breadcrumb/back 스택(load-bearing — 링크 나열이 아님). `GET /ontology/objects/:id/links?kind=`.
4. **Actions 섹션** — 대상 Object 에 유효한 ActionType 버튼을 `<ActionForm>` 으로 렌더.
   manage 프로파일에서만 enabled, observe → disabled + 사유 tooltip(ActionForm 이 기계판독
   reason 제공).

추가: '전체 페이지 열기' escape hatch; auto/manual 관계 구분(표시상 — 현 mock 은 전부 파생/auto);
objectId(+traverse-stack head) 를 urlState 에 보존 → deep-link + back 버튼 일관.

## 설계 (Design)

### 데이터 흐름
- 신규 라우트 `GET /ontology/objects/:id` (단일 객체) — deep-link 복원·이웃 해석 안정화.
  `/links` 정규식보다 **뒤에** 매칭(구체 경로 우선). 미존재 → 404.
- 클라 메서드 `fetchOntologyObject(id)`.
- ObjectView 는 objectId 변경 시:
  (a) `fetchOntologyObjects()` 전체 목록 → id→object 인덱스(이웃 title/status/type 해석용),
  (b) `fetchOntologyObject(id)`(대상 canonical),
  (c) `fetchOntologyLinks(id)`(관계).
  전부 mock/실백엔드 동일 계약. 미존재 id → "객체를 찾을 수 없음" 빈 상태.

### traverse / breadcrumb
- 컴포넌트 내부 back 스택(`string[]`): head = 현재 objectId. 이웃 클릭 → push, back → pop.
- URL: `obj`(현재 head), `objstack`(이전 스택 CSV) 를 urlState 로 보존. 패널은 페이지 무관하게
  `obj` 가 있으면 열린다(deep-link). 닫으면 두 키 제거.

### Action 게이팅
- 대상 type 에 맞는 ACTION_REGISTRY spec 만 노출(`spec.target === object.type`).
- 게이팅은 ActionForm 의 evaluateSubmission(can()+status) 이 담당 — observe 에서 **버튼
  disabled + 기계판독 사유**. UI 숨김이 아니라 계약 게이팅(trust boundary; mock 도 403).

### 진입점
- Topology: 기존 thin 패널을 ObjectView 로 교체(노드 id → `node:`/`gpu:`/`service:` 접두 매핑).
- Traces: 행에 'Object View' 버튼 → `trace:<id>`.
- Models: 상세 패널 footer 에 'Object View' 버튼 → `model:<name>`.

## 테스트 케이스 (Vitest)

- **normal**: header(글리프+title+상태 Badge+metric) / properties / related 그룹 렌더.
- **traverse(normal)**: 이웃 클릭 → in-place 이동 + breadcrumb push; back → pop.
- **retry/deterministic**: 같은 objectId 재오픈 시 동일 관계 집합.
- **failure**: 알 수 없는 objectId → 404 → "객체를 찾을 수 없음" 빈 상태(throw 안 함).
- **bad-input**: 링크 kind 필터 미존재 → 빈 그룹(패널 정상).
- **env-missing / observe**: can()=false(observe) → Action 버튼 disabled + 사유; manage → enabled.
- **deep-link**: URL `obj=` 로 마운트 시 해당 객체 복원.
- 기존 테스트(ontology/ActionForm/SlidePanel) 비회귀.

## 범위 밖 (Out of scope)
- 실제 auto/manual 관계 소스 구분(현 mock 전부 파생) — 라벨만 'auto'.
- 그래프 시각 traverse(별도).

## TOUCHED_SURFACES (visual QA)
- 신규 `web/src/components/ObjectView.tsx` (+ index.css object-view-* 토큰).
- Topology(`/topology`) 노드 클릭 → ObjectView.
- Traces(`/traces`) 행 'Object View' 버튼.
- Models(`/models`) 상세 패널 'Object View' 버튼.
- deep-link `/(any)?obj=model:<name>`.
