# 기능: 넓은 데이터 표(Traces·Sessions·Keys) 행 windowing (행수 게이트, 무의존)

## 목적
트레이스·세션·키 표는 결과 배열을 `.map` 으로 통째 `<tbody>` 에 그린다(가상화·windowing 부재).
현재는 mock/제한 응답이라 괜찮지만, 라이브 트레이스는 수천 행 + 폴링이 겹치면 큰 DOM + 매
갱신마다 재조정으로 입력 지연·스크롤 버벅임이 난다. 화면에 실제로 보이는 행만 그려 DOM 노드 수와
재조정 비용을 상한선 안에 묶는다(렌더 핫스팟 제거).

핵심 제약:
- **무의존(zero-dep)**: 새 런타임 의존성 금지. `@tanstack/react-virtual` 등 추가하지 않는다.
  손수 만든 고정행높이 windowing 훅(~60줄)으로 구현.
- **행수 게이트**: windowing 은 행 수가 임계(`WINDOW_THRESHOLD ≈ 150`)를 넘을 때만 켠다.
  그 이하에선 기존대로 전량 렌더(windowing 자체에 per-render 오버헤드가 있으므로 게이트).
- **렌더 레이어 한정**: 정렬·필터·내보내기(Export)는 항상 전체 결과 배열에서 동작한다.
  windowing 은 "지금 그릴 행"만 고르는 렌더 관심사일 뿐, 데이터 파이프라인을 건드리지 않는다.

## 비포함(deferred to human review)
- **백엔드 cursor/limit 페이지네이션**: `traces.go` 의 limit / opaque-cursor 변경은
  API 계약 변경으로 민감 영역 → **사람 리뷰로 이연**. 이번 작업은 클라이언트 windowing 레이어만.
  (서버가 수천 행을 보내는 상황을 클라이언트가 견디게 만드는 것이 이번 범위.)

## 요구사항
1. `useRowWindow` 훅: 스크롤 컨테이너 ref + 전체 행 수 + 고정 행 높이를 받아,
   화면에 보이는 행의 `[start, end)` 인덱스 범위와 위/아래 스페이서 높이를 계산해 돌려준다.
   - overscan(여유분) 행을 위아래로 두어 빠른 스크롤 시 빈칸이 안 보이게 한다.
   - 스크롤 이벤트에서 `scrollTop` 을 읽어 `requestAnimationFrame` 으로 throttle, state 갱신.
   - 컨테이너 높이는 `clientHeight` 로 측정(+ `ResizeObserver` 가 있으면 리사이즈 추적).
   - jsdom 은 실제 레이아웃이 없으므로 측정값 0 을 대비해, 측정 전이면 안전한 기본 행 수를 쓴다.
2. `VirtualRows` 컴포넌트: 표의 `<tbody>` 안에서 쓰는 windowing 래퍼.
   - 행 수 ≤ threshold → 전체 행을 그대로 렌더(게이트 OFF, 기존과 동일 동작·오버헤드 0).
   - 행 수 > threshold → 위 스페이서 `<tr>` + 보이는 행들 + 아래 스페이서 `<tr>` 만 렌더.
   - 스페이서는 `<tr aria-hidden>` + 단일 `<td colSpan>` 의 height 로 표현해 `<table>`/`<tbody>`
     문맥을 깨지 않는다(셀 정렬·테이블 시맨틱 유지).
   - 스크롤 컨테이너는 기존 `.table-scroll`(IMP-17, 좌우 스크롤) 바깥의 세로 스크롤 영역을 쓴다.
     세로 windowing 용 `max-height` 컨테이너에 ref 를 건다.
3. 적용 대상: Traces.tsx(가장 핫) → Sessions.tsx → Keys.tsx 순. 각 표의 `tbody.map` 을
   `VirtualRows` 로 교체하되 행 렌더 함수(기존 `<tr>` JSX)는 그대로 재사용.
4. 접근성·기존 동작 보존:
   - 표 시맨틱(`<table><thead><tbody>`) 유지, sticky-first(Keys) 헤더/첫 컬럼 유지.
   - 키보드 스크롤(컨테이너 `tabIndex`/`role=region`) 유지, 행 `Enter` 진입 유지.
   - ExportButton(IMP-23)·기간/필터(IMP-24)·table-scroll(IMP-17) 동작 불변.

## 함수 시그니처
```ts
// web/src/hooks/useRowWindow.ts
export interface RowWindow {
  start: number;          // 첫 가시 행 인덱스(overscan 포함)
  end: number;            // 마지막+1 가시 행 인덱스(overscan 포함)
  topPad: number;         // 위 스페이서 height(px)
  bottomPad: number;      // 아래 스페이서 height(px)
  windowed: boolean;      // 게이트 ON 여부(total > threshold)
}
export interface UseRowWindowOpts {
  rowHeight?: number;     // 고정 행 높이(px), 기본 36
  overscan?: number;      // 위아래 여유 행, 기본 8
  threshold?: number;     // 이 행 수 초과 시에만 windowing, 기본 150
  /** 테스트 주입용: 측정 대신 강제 값(jsdom 에 실제 레이아웃 없음) */
  viewportOverride?: { scrollTop: number; clientHeight: number };
}
export function useRowWindow(
  scrollRef: React.RefObject<HTMLElement | null>,
  total: number,
  opts?: UseRowWindowOpts,
): RowWindow;
```
```tsx
// web/src/components/VirtualRows.tsx
export interface VirtualRowsProps<T> {
  items: T[];                              // 전체 결과 배열(정렬·필터 끝난 뒤)
  rowHeight?: number;                      // 고정 행 높이(px)
  overscan?: number;
  threshold?: number;                      // 게이트
  colSpan: number;                         // 스페이서 <td colSpan>
  scrollRef: React.RefObject<HTMLElement | null>; // 세로 스크롤 컨테이너
  children: (item: T, index: number) => React.ReactNode; // 행 렌더(기존 <tr>)
  viewportOverride?: { scrollTop: number; clientHeight: number }; // 테스트 주입
}
export default function VirtualRows<T>(props: VirtualRowsProps<T>): React.ReactElement;
```

## 테스트 케이스
- below-threshold: 행 수 ≤ threshold 면 모든 행이 DOM 에 렌더되고 스페이서 `<tr>` 이 없다(게이트 OFF).
- above-threshold: 행 수 > threshold 면 보이는 부분집합만 렌더되고(전량 아님), 위/아래 스페이서 `<tr>` 이 있다.
- scroll updates window: `scrollTop` 을 키워(viewportOverride/이벤트) 보이는 행 집합이 아래로 이동한다.
- sort/filter on full set: windowing 을 켜도 부모가 넘긴 items(정렬·필터·Export 대상)는 전체를 그대로 본다
  — VirtualRows 는 items 를 변형하지 않는다(렌더 인덱스만 선택).
- a11y: 스페이서 행은 `aria-hidden`, 표 시맨틱(`<table><tbody>`)이 유지되어 보이는 행은 정상 `<tr>` 이다.

## 출력 위치
- `web/src/hooks/useRowWindow.ts` (신규)
- `web/src/components/VirtualRows.tsx` (신규)
- `web/src/hooks/useRowWindow.test.tsx` 또는 `web/src/components/VirtualRows.test.tsx` (신규)
- `web/src/pages/Traces.tsx` · `Sessions.tsx` · `Keys.tsx` (tbody 교체)
- `web/src/index.css` (세로 스크롤 컨테이너 `max-height` 유틸 1개)

## 의존성
- 없음(hand-rolled). React 19 내장 훅(`useState`/`useEffect`/`useLayoutEffect`/`useRef`)만 사용.
- 백엔드 변경 없음(cursor/limit 은 사람 리뷰로 이연).
