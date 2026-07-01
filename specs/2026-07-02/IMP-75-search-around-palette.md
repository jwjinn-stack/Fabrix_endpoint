# IMP-75 — Search Around 객체-액션 런처 (⌘K를 온톨로지 순회·즉시 조치 진입점으로)

- Type: ux (sev=medium, effort=L)
- Cycle: evolve-cycle5-active-ontology
- 선행/합류: IMP-57(ObjectView.open), IMP-59(ActionForm+evaluateSubmission), IMP-62/70(nav·진입점),
  IMP-66(OntologyGraph.neighbors/bfs), IMP-73(query_objects/toolQueryObjects)

## 문제 (Problem)

`CommandPalette.tsx`(⌘K)는 정확한 WAI-ARIA combobox 구현(role=combobox/listbox,
aria-activedescendant, scrollIntoView, group header, keyboard nav, focus-on-open)을 갖췄지만
**화면 이동 + 소수 전역 작업만** 한다. 온톨로지(Object/Link/Action)가 이미 있는데도 키보드
진입은 여전히 '페이지' 단위다 — 특정 객체를 이름으로 찾고, 그 이웃(runsOn GPU, hostedBy Node)으로
Palantir Object Explorer의 **'Search Around'**(링크 순회로 객체 집합 도달)을 하거나, 객체 대상
Action(cordon/drain/scale)에 팔레트에서 바로 진입하는 Foundry식 **객체-중심 런처**가 없다.

## 해결 (Fix)

CommandPalette를 **중첩(nested)/상태(stateful) 팔레트**로 승격한다. 이미 있는 네 primitive만
엮는다(rebuild 금지): (a) a11y combobox shell, (b) query_objects(toolQueryObjects title/id 부분일치),
(c) OntologyGraph.neighbors(id,kind)/bfs, (d) ACTION_REGISTRY+evaluateSubmission 게이팅 + ObjectView.open.

### 1) 모드 state machine + breadcrumb (Linear/Raycast 패턴)
- **root** — 기존 flat `Command[]`(navigate + globals) 그대로. 회귀 없음.
- root에서 타이핑 → **object-search** 모드: query_objects(debounced 200ms)로 객체를 검색해
  결과를 `Command[]`(그룹=객체 타입 라벨)로 렌더.
- 객체에서 Enter → **object-context** 페이지 push: 그 객체의 Action Panel =
  `[Open ObjectView]`(primary) + `Search Around → serves/runsOn/hostedBy…`(그 객체가 실제로 가진
  관계만) + capability 통과한 Actions(secondary).
- Search Around 항목 Enter → **search-around** 페이지 push: `neighbors(id, kind)`를 **집합(SET)** 으로 나열.
- mode/context **스택** + breadcrumb row. **빈 쿼리에서 Backspace → 한 단계 pop**(Raycast/Linear 관례).

### 2) WAI-ARIA combobox 계약 — 모드 전환 간 회귀 금지
- 매 전환마다 `active=0` 리셋(이미 query 변화에 리셋됨 + 모드 전환 key로 강제 리셋).
- DOM 포커스는 input 유지, aria-activedescendant + scrollIntoView 유지(기존 shell 그대로).
- **추가(유일한 a11y 갭 닫기)**: `aria-live="polite"` 노드 — "N개 객체" / "Searching around <object>" /
  결과 수를 안내. shell 내부 `.sr-only` live region으로 상주.

### 3) Search-around 결과 = JUMP 아닌 SET (Foundry "selected set → action form")
- `Search Around → runsOn` = `neighbors(id,'runsOn')` 이웃 **집합**을 sub-page로 나열.
- 각 이웃 Enter = **ObjectView.open**(안전, 항상 가용). manage에서는 그 집합에 적용할 게이팅된
  bulk Action 진입(현 단계 = set의 각 대상에 대해 ActionForm을 여는 진입점; 팔레트가 직접 mutate 금지).
- **딥링크**: object-context/search-around 컨텍스트를 urlState로 보존(공유·재현). mock-first 정합.
- **set size 경량 가드**: Foundry >1000 cap을 미러 — 1000 초과면 bulk action 비활성 + 사유 안내.

### 4) capability 게이팅 재사용 (rebuild 금지 — trust boundary 불변)
- ACTION_REGISTRY 엔트리는 `useCap()`/`requiredCap`(evaluateSubmission) 통과 시**만** command로 노출
  (observe 숨김 — nav와 동일). 실행은 **반드시 기존 ActionForm + evaluateSubmission 경로**로만.
- **팔레트 측 mutation 절대 금지** — 403 trust boundary·audit 불변. 팔레트는 ObjectView(+ActionForm)를
  열 뿐이다. Primary=Open ObjectView(안전), mutating Actions=secondary(Raycast primary/secondary 위계).

## 설계 (Design)

### 컴포넌트 경계 (기존 shell 재사용, 포크 금지)
- `CommandPalette.tsx` — 기존 combobox shell을 **모드-aware**로 확장(신규 파일 아님):
  - `Command`에 옵션 `keepOpen?: boolean` 추가 — true면 Enter/click이 `run()`만 하고 팔레트를
    닫지 않는다(= 하위 페이지 push). 미지정(기존 command)은 종전대로 close+run.
  - 옵션 props 추가: `breadcrumb?: string[]`, `onBack?: () => void`(빈 쿼리 Backspace), 
    `liveMessage?: string`(aria-live 텍스트), `placeholder?`, `onQueryChange?: (q)=>void`,
    `query`/`onQueryChangeControlled` 는 **비제어 유지**(내부 state) — 대신 검색 debounce는 상위가
    `onQueryChange`로 관찰. root의 fuzzyScore/group header/키보드/포커스/activedescendant 전부 불변.
- `web/src/actions/searchAround.ts`(신규, 순수 seam) — 모드 머신의 **순수 로직**:
  - `SEARCH_AROUND_KINDS: LinkKind[]`(런처에 노출할 관계 순서), `MAX_SET`(=1000, Foundry cap 미러).
  - `objectSearchCommands(objects, q)` — toolQueryObjects 재사용 → `Command[]`(그룹=타입 라벨).
  - `objectContextCommands(...)` — `[Open ObjectView]` + 실재 관계별 `Search Around →` + 게이팅 Action.
  - `searchAroundSet(graph, id, kind)` — `neighbors(id, kind)` 그대로(집합·결정적 정렬).
  - 게이팅 판정은 `evaluateSubmission`(단일 출처)만 호출 — 자체 규칙 없음.
- `useSearchAround()` 훅(searchAround.ts 또는 CommandPalette 인접) — 스택/모드/liveMessage/breadcrumb
  상태를 관리하고 위 순수 함수를 조합해 `commands`를 계산. Layout이 `useCap()`/`open(id)`를 주입.
- `Layout.tsx` — 기존 `commands`(root flat)를 `useSearchAround`에 root로 넘기고, 팔레트에
  breadcrumb/onBack/liveMessage/onQueryChange를 스프레드. `useObjectView().open`을 주입해 ObjectView 진입.

### 딥링크 (urlState)
- `searchAroundSchema = { sactx: strField(""), saround: strField("") }` — sactx=object-context 대상 id,
  saround=`<id>|<kind>` search-around 컨텍스트. 빈 값=root. crafted URL 방어(parse는 throw 금지).
- 팔레트 열림 자체는 URL에 싣지 않는다(휘발). 컨텍스트만 공유 대상.

### 데이터
- 객체 목록/그래프: `fetchOntologyObjects()`(mock/실백엔드 동일) 1회 로드 → 인덱스 + `buildGraph`.
  neighbors/query_objects는 이 스냅샷 위 순수 연산(결정적). 미존재 id → 빈 집합(throw 없음).

## 테스트 케이스 (Vitest — CommandPalette.searchAround.test.tsx + searchAround.test.ts)

- **모드 전환**: root(flat nav/globals) → 타이핑 시 object-search(query_objects 필터) →
  객체 Enter → object-context([Open ObjectView] + Search Around + Actions) →
  Search Around Enter → search-around(neighbors 집합).
- **breadcrumb pop**: search-around/object-context에서 빈 쿼리 Backspace → 한 단계 pop(스택 복원).
- **a11y 비회귀**: 모드 전환 시 active=0 리셋; aria-activedescendant present; aria-live 노드가
  결과 수/"Searching around" 안내. DOM 포커스 input 유지.
- **object-search 필터**: 쿼리가 toolQueryObjects(title/id 부분일치)로 좁혀진다(무관 객체 제외).
- **search-around = SET**: `Search Around → runsOn`이 neighbors(id,'runsOn')를 나열(집합, 결정적 순서);
  이웃 Enter = ObjectView.open 호출(팔레트 직접 mutate 아님).
- **게이팅**: observe(can=false) → object-context에 mutating Action command **미노출**(nav와 동일);
  manage(can=true) → 노출. Open ObjectView는 두 프로파일 모두 노출(안전).
- **mutation 경로**: 팔레트에서 Action 선택 시 submitAction 직접 호출 없음 — ObjectView(+ActionForm)
  진입만(trust boundary). searchAround.ts는 어떤 mutating client도 import하지 않는다.
- **딥링크**: sactx/saround로 컨텍스트 복원(encode/decode 순수 테스트).
- **empty/no-results**: 무매치 쿼리 → 빈 상태 + aria-live "0"; 이웃 없는 kind → 빈 집합 문구.
- **set-size 가드**: >MAX_SET면 bulk action 비활성 + 사유(순수 함수 단위 테스트).
- 기존 CommandPalette(Layout.nav)·ObjectView·ActionForm 테스트 **비회귀**.

## 범위 밖 (Out of scope)
- 실제 서버측 bulk mutation 계약(집합 일괄 실행) — 현 단계는 set→ActionForm 진입까지(팔레트 mutate 금지).
- 그래프 시각 traverse(ObjectView가 담당) · 다중 hop bfs 런처(현 단계는 1-hop neighbors).

## TOUCHED_SURFACES (visual QA)
- `web/src/components/CommandPalette.tsx`(모드-aware shell), `web/src/actions/searchAround.ts`(신규 순수 seam),
  `web/src/components/Layout.tsx`(useSearchAround 배선), `web/src/urlState.ts`(searchAroundSchema), index.css(cmdk-crumbs).
- ⌘K 열기(상단 바 '검색·이동' 또는 ⌘K/Ctrl+K) → 객체명 타이핑(예: "gpu", "qwen") → 결과 객체 Enter
  → object-context 페이지([객체 열기] + Search Around → 실행 GPU/호스트 노드 + (manage) 액션) →
  'Search Around → runsOn' Enter → 이웃 GPU 집합 → 이웃 Enter = ObjectView 열림.
- observe 프로파일: object-context에 mutating 액션이 사라지는지(Open ObjectView는 남음).
- 딥링크 `/(any)?sactx=model:<name>` 또는 `?saround=model:<name>|runsOn`.
