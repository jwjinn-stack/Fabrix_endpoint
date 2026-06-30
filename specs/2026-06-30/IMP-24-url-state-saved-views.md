# 기능: 필터·기간 상태 URL 동기화 + 저장된 뷰 (useUrlState) — IMP-24

## 목적
트레이스/세션/사용량/가드레일 화면의 필터(모델·상태·판정·앱·기간·드릴다운 차원)가 컴포넌트
로컬 state 로만 살아 URL 에 반영되지 않는다. 그 결과 온콜이 "이 endpoint 의 지난 1시간 차단
트레이스" 같은 조사 뷰를 **링크로 공유**하거나, **새로고침/뒤로가기로 재현**하거나, **저장**할 수
없다. Datadog/Honeycomb/Grafana 는 모두 공유 가능한 deep-link 상태를 핵심 협업 기능으로 제공한다.

해결: 의존성 0 `useUrlState` 훅을 기존 bespoke History-API 라우팅(`router.ts`) 위에 얹어
state ↔ URL 양방향 동기화한다. 현재의 "시드-온-마운트 후 setFilter 는 URL 안 건드림" 비대칭을
제거하고 단일 출처(URL)로 통합한다. 그 위에 localStorage 기반 "저장된 뷰"와 "뷰 링크 복사"를 얹는다.

- **읽기(링크 복사)는 항상 허용** (observe 읽기전용 포함).
- **쓰기(뷰 저장)는 manage 프로파일만** (cap 게이팅). observe 에선 저장 UI 숨김.
- react-router 도입 금지 — 기존 History API 패턴 유지. **ZERO 새 런타임 의존성.**

## 요구사항
1. **useUrlState 훅** (`web/src/urlState.ts`)
   - 마운트 시 현재 `window.location.search` 에서 등록된 키를 읽어 초기 state 시드(시드-온-마운트 대체).
   - state 변경 시 URL querystring 으로 되씀. **필터/기간 미세조정 = `history.replaceState`**
     (back 스택 오염 방지). 경로 자체(페이지 전환·드릴다운)는 기존 App.navigate 의 pushState 가 담당.
   - 기본값(default)과 같은 값은 URL 에서 생략 → 깔끔한 공유 URL + "전체=all" 노이즈 제거.
   - 직렬화 대상: `model`·`status`·`decision`·`app`·`range`·`group`·`type` + 드릴다운 `dim`.
     배열 값은 콤마 인코딩(`a,b,c`). URL→state 복원 시 타입 검증.
   - `range` 는 TimeRange 화이트리스트(`1h|6h|24h|7d`)로 검증 — 미허용 값은 default 로 폴백(crafted URL 방어).
   - 자유 텍스트(검색어 등) 입력은 ~300ms debounce 후 replaceState (히스토리/리렌더 폭주 방지).
2. **시드-온-마운트 대체**: Traces/Sessions/Usage/Guard 의 현 로컬 필터 state + queryParam 시드 코드를
   `useUrlState` 로 교체. setFilter/setRange 가 곧 URL 되쓰기가 되도록(비대칭 제거).
3. **뷰 링크 복사 버튼**: filter-bar 우측에 버튼 1개. 현재 전체 URL(`location.href`)을
   `navigator.clipboard.writeText` 로 복사 + toast "링크 복사됨". clipboard 미지원 시 폴백(execCommand 또는 toast 안내).
   **항상 허용**(읽기 동작).
4. **저장된 뷰(localStorage)**: 이름→querystring 스냅샷. manage 프로파일에서만 저장 UI 노출.
   목록에서 클릭 시 해당 querystring 으로 state 복원. 삭제 가능. localStorage 키 prefix `fabrix.savedViews.<page>`.
   백엔드 저장 승격은 차기(cap 게이팅 자리만 마련).

## 함수 시그니처
```ts
// web/src/urlState.ts

// 한 필드의 직렬화/복원 규칙. parse 는 잘못된 값에 대해 default 를 돌려줘야 한다(throw 금지).
export interface UrlField<T> {
  default: T;
  serialize: (v: T) => string | undefined; // undefined → URL 에서 생략(=default 일 때)
  parse: (raw: string | null) => T;         // null/미허용 → default
}

// 흔한 필드 빌더(타입 안전):
export function strField(def: string): UrlField<string>;                 // 단순 문자열, def 와 같으면 생략
export function enumField<T extends string>(allowed: readonly T[], def: T): UrlField<T>; // 화이트리스트 검증
export function csvField(def?: string[]): UrlField<string[]>;            // 배열 ↔ "a,b,c"
export const rangeField: UrlField<TimeRange>;                            // enumField(["1h","6h","24h","7d"], "24h")

// 스키마 = { 키: UrlField }. 반환값은 [state, patch] (patch 는 부분 갱신, replaceState).
export function useUrlState<S extends Record<string, UrlField<unknown>>>(
  schema: S,
): [{ [K in keyof S]: S[K] extends UrlField<infer T> ? T : never },
    (next: Partial<{ [K in keyof S]: S[K] extends UrlField<infer T> ? T : never }>,
          opts?: { debounce?: boolean }) => void];

// 순수 함수(테스트 용이) — schema + search string ↔ state/querystring.
export function decodeState<S>(schema: S, search: string): StateOf<S>;
export function encodeState<S>(schema: S, state: StateOf<S>): string; // "k=v&..." (default 생략, 정렬)

// web/src/savedViews.ts
export interface SavedView { name: string; query: string; savedAt: number; }
export function listSavedViews(page: string): SavedView[];
export function saveView(page: string, name: string, query: string): SavedView[]; // 동일 이름 덮어쓰기
export function deleteView(page: string, name: string): SavedView[];

// web/src/components/ViewBar.tsx (filter-bar 우측 컨트롤)
export default function ViewBar(props: {
  page: string;
  canSave: boolean;        // manage 프로파일만 true (caps.readonly === false)
  onApply: (query: string) => void; // 저장된 뷰 선택 → state 복원
}): JSX.Element;
// "뷰 링크 복사"(항상) + manage 면 "뷰 저장"/목록.
```

## 테스트 케이스 (`web/src/urlState.test.tsx`, `web/src/savedViews.test.ts`)
1. **url→state restore on mount**: `?model=gpt&decision=blocked&range=1h` → state.model="gpt",
   decision="blocked", range="1h".
2. **state→url replaceState**: patch({decision:"blocked"}) → `history.replaceState` 호출되고
   location.search 에 `decision=blocked` 포함, pushState 는 호출 안 됨.
3. **default 생략**: 모든 값이 default 면 encodeState → "" (깨끗한 URL).
4. **range whitelist rejects bad value**: `?range=999d` → state.range==="24h"(default 폴백, throw 없음).
5. **csv roundtrip**: ["a","b"] → "a,b" → ["a","b"]; 빈 배열 → 생략.
6. **debounced search**: patch({q:"x"},{debounce:true}) 후 즉시는 replaceState 미발생,
   ~300ms(타이머 advance) 후 1회 발생.
7. **saved view roundtrip**: saveView → listSavedViews 에 포함, 같은 이름 재저장 시 덮어씀,
   deleteView 후 사라짐. (localStorage mock)
8. **copy-link**: ViewBar "뷰 링크 복사" 클릭 → navigator.clipboard.writeText(location.href) 호출 +
   toast 표시. canSave=false 여도 복사 버튼은 보인다(저장 버튼만 숨김).

## 출력 위치
- `web/src/urlState.ts` (훅 + 순수 인코더/디코더 + 필드 빌더)
- `web/src/savedViews.ts` (localStorage CRUD)
- `web/src/components/ViewBar.tsx` (링크 복사 + 저장된 뷰 UI)
- `web/src/urlState.test.tsx`, `web/src/savedViews.test.ts`
- 수정: `web/src/pages/Traces.tsx`·`Sessions.tsx`·`Usage.tsx`·`Guard.tsx`

## 의존성
없음 (zero 새 런타임 의존성). React 19 + History API + localStorage + navigator.clipboard 만 사용.
기존 `router.ts`(queryParam/History)·`timeRange.tsx`(TimeRange)·`toast.tsx`·`capabilities.tsx` 재사용.
