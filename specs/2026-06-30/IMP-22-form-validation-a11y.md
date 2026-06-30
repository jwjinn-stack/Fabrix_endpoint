# 기능: 생성·편집 폼 인라인 검증 + aria-invalid 접근가능화 (IMP-22)

## 목적
엔드포인트 생성 위저드·키 발급·사용자 추가 폼이 클라이언트 인라인 검증을 전혀 하지 않는다.
필수값 누락 시 핸들러가 조용히 `return` 만 하고(죽은 상호작용), 어떤 필드가 왜 막혔는지 피드백이 없다.
전 페이지 grep 결과 `aria-invalid`/`pattern=`/`required`/inline-error 가 0건이라 스크린리더(SR)는 오류 필드를 인지조차 못 한다 (WCAG 3.3.1 Error Identification / 3.3.3 Error Suggestion 위반, 색상단독 1.4.1 위험).

- 증거:
  - `web/src/pages/Endpoints.tsx:265` `if (keyAppMode==="custom" && !keyForm.app_name.trim()) return;` — 에러표시 없이 return
  - `web/src/pages/Keys.tsx:96-97` 동일 조용한 return
  - `web/src/pages/Settings.tsx:167` `if (!form.email.trim() || !form.name.trim()) return;` — 사후 매핑만(:124)
  - submit 버튼은 `disabled` 로 막혀 있어(예: Keys.tsx:394) 왜 막혔는지 드러나지 않음 — disabled 안티패턴.

## 요구사항
의존성 0 검증 헬퍼/훅 + 접근가능 폼 패턴. 폐쇄망에서 클라이언트만으로 동작.

1. 3단계 타이밍
   - untouched(pristine) → 무에러 (타이핑 중 검증 금지)
   - blur → 해당 필드 검증 + touched 마킹
   - 이미 에러인(또는 submit 후) 필드 → change 마다 재검증 (오류가 고쳐지면 즉시 사라짐)
   - submit → 전체 검증 + 전 필드 touched + 노출
2. 필드 a11y
   - 에러 시 `aria-invalid="true"` (touched/submit 후에만)
   - 에러텍스트를 `aria-describedby` 로 연결, 에러노드 `role="alert"`
3. disabled submit 금지 — 제출시켜 오류를 드러낸다. 조용한 return 을 검증→에러렌더→포커스관리로 교체.
4. 긴 폼/위저드는 submit 시 상단 에러 SUMMARY(`role="alert"`, `tabindex=-1`, 각 필드 점프 링크) + 포커스 이동. 짧은 폼은 첫 오류필드 포커스.
5. 기존 `.state.error` 토큰 재사용. 빨간 테두리는 텍스트 동반(색상단독 금지).

## 함수 시그니처
```ts
// web/src/utils/useFieldValidation.ts
export type Validator<V> = (value: V[keyof V], values: V) => string | undefined;
export type Rules<V> = Partial<Record<keyof V, Validator<V>>>;

export interface FieldValidation<V> {
  errors: Partial<Record<keyof V, string>>;   // 현재 노출 중인 에러
  submitted: boolean;
  fieldProps(name: keyof V): {                 // <input {...fieldProps('name')} /> 형태로 스프레드
    "aria-invalid"?: true;
    "aria-describedby"?: string;
    onBlur: () => void;
  };
  errorId(name: keyof V): string;              // 에러 노드 id (aria-describedby 대상)
  showError(name: keyof V): string | undefined;// 노출해야 할 에러 텍스트(없으면 undefined)
  registerRef(name: keyof V): (el: HTMLElement | null) => void; // 포커스 이동용
  handleSubmit(onValid: () => void): void;     // 전체 검증→통과 시 onValid, 실패 시 포커스 이동
  reset(): void;
  visibleErrors: { name: keyof V; message: string }[]; // 에러 SUMMARY 용
}

export function useFieldValidation<V extends Record<string, unknown>>(
  values: V,
  rules: Rules<V>,
  opts?: { summary?: boolean },                // summary=true → 상단 요약 + 점프링크
): FieldValidation<V>;

// 공용 검증 규칙
export const required: (msg?: string) => Validator<Record<string, unknown>>;

// web/src/components/FieldError.tsx — 에러 노드(role=alert) 렌더
// web/src/components/FormErrorSummary.tsx — 상단 요약(role=alert, tabindex=-1, 점프링크)
```

## 테스트 케이스
- normal: 모든 필수값 입력 → handleSubmit 이 onValid 호출, 에러 0
- blur: pristine 필드 타이핑 중엔 에러 없음 → blur 시 해당 필드만 에러 노출 + aria-invalid=true + aria-describedby 연결
- submit-with-errors: 빈 폼 submit → 전체 에러 노출, onValid 미호출, summary(role=alert) 렌더, 첫 오류필드/summary 로 포커스
- bad-input: 형식 위반(예: 이메일 `@` 없음, 음수 쿼터) → 해당 에러 메시지
- error-clears-on-fix: 에러 상태 필드에 유효값 입력(change) → 에러 즉시 사라지고 aria-invalid 해제

## 출력 위치
- 신규: `web/src/utils/useFieldValidation.ts`, `web/src/utils/useFieldValidation.test.tsx`
- 신규: `web/src/components/FieldError.tsx`, `web/src/components/FormErrorSummary.tsx`
- 수정(폼 배선): `web/src/pages/Keys.tsx`(키 발급), `web/src/pages/Endpoints.tsx`(키 모달 + 생성 위저드 summary), `web/src/pages/Settings.tsx`(사용자 추가)
- CSS: `web/src/index.css` — `.field-error`, `input[aria-invalid]`, `.form-error-summary`

## 의존성
없음 (in-house, React 19 훅만 사용). 신규 런타임 의존성 0.
