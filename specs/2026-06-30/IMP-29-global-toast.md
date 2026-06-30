# 기능: 전역 접근가능 토스트/피드백 시스템 (ToastProvider)

## 목적
앱 전역에 일관된 사용자 피드백 채널이 없다. Settings 만 로컬 `notice` state 토스트,
Keys 는 인라인 배너, 다른 mutation(엔드포인트 생성/삭제·정책 PUT·config patch+rollout·
사용자 CRUD·키 발급)은 화면별 임시방편이거나 조용히 끝난다. mutating 이 핵심인 manage
프로파일에서 "내 변경이 적용됐는지" 일관 확인 패턴이 필요하다.

zero-dep 자체구현 ToastProvider 를 앱 루트에 두고 단일 `toast()` API 로 수렴한다.
React Aria Toast 구조를 청사진으로(라이브러리 금지). WCAG 4.1.3(Status Messages) +
2.2.1(Timing Adjustable) 준수.

## 요구사항
1. 라이브 region 둘 상시 DOM 배치:
   - 성공/상태 = `role="status"` `aria-live="polite"`
   - 오류/세션·보안 = `role="alert"` `aria-live="assertive"`
   - 각 토스트 아이템 `aria-atomic="true"`
2. 단일 API `toast({type, message, action?, promise?})` — 모든 mutation 핸들러가 여기로.
3. WCAG 2.2.1: 자동 dismiss(success/info 4s, 그 외 표시 유지) + 수동 닫기 버튼 +
   호버/포커스 시 타이머 일시정지(leave/blur 시 재개). assertive 는 error 만.
4. 비동기 적용은 promise 형 진행형 토스트: 동일 ID `pending`→`success`/`error` 전이.
   error 매퍼로 `humanizeError`(web/src/utils/errors.ts, IMP-26) 연결.
5. undo 액션은 선택적이되 토스트 밖(페이지/행)에서도 동일 작업 가능해야 함
   (토스트가 유일 복구 경로면 a11y 위반) — 본 구현은 파괴적 작업에 undo 를 강제하지 않음.
6. `prefers-reduced-motion` 존중(애니메이션 off), 동시 토스트 스택 상한(MAX=4, 초과 시 오래된 것 제거).

## 함수 시그니처
```ts
// web/src/toast.tsx
export type ToastType = "success" | "error" | "info";
export interface ToastAction { label: string; onClick: () => void; }
export interface ToastOptions {
  type?: ToastType;            // 기본 "info"
  message: string;
  action?: ToastAction;        // 선택적 인라인 액션(undo 등)
  id?: string;                 // 동일 ID 재호출 시 기존 토스트 갱신(promise 전이)
  duration?: number;           // ms; 0/null = 자동 dismiss 안 함
}
export interface PromiseToastOptions<T> {
  pending: string;
  success: string | ((v: T) => string);
  error?: string | ((e: unknown) => string);  // 기본: humanizeError
}
export interface ToastApi {
  (opts: ToastOptions | string): string;             // id 반환
  success(message: string, opts?: Partial<ToastOptions>): string;
  error(message: string, opts?: Partial<ToastOptions>): string;
  info(message: string, opts?: Partial<ToastOptions>): string;
  promise<T>(p: Promise<T>, o: PromiseToastOptions<T>): Promise<T>;
  dismiss(id: string): void;
}
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element;
export function useToast(): ToastApi;
```

## 테스트 케이스
- success → polite region(`role="status"`)에 렌더.
- error → assertive region(`role="alert"`)에 렌더 + 원문 raw 에러는 `humanizeError` 로 정규화되어 표시.
- 수동 닫기 버튼 클릭 → 해당 토스트 제거.
- 호버 시 자동 dismiss 타이머 일시정지(fake timers: hover 중엔 시간 경과해도 유지, leave 후 만료되면 제거).
- promise 토스트: pending 표시 → resolve 시 success 메시지로 전이(동일 노드).
- 스택 상한: MAX 초과로 토스트를 쌓으면 가장 오래된 것이 제거되어 최대 MAX 개만 유지.

## 출력 위치
- `web/src/toast.tsx` (ToastProvider + useToast + viewport)
- `web/src/main.tsx` (루트 마운트)
- `web/src/index.css` (`.toast*` 토큰 — 기존 `.toast` 재사용/확장)
- 마이그레이션: `web/src/pages/Settings.tsx`(로컬 notice + error), `web/src/pages/Keys.tsx`(인라인 배너 error + 키 발급/회수)
- 테스트: `web/src/toast.test.tsx`

## 의존성
없음(zero new runtime deps). React 19 only. `humanizeError` 재사용.
