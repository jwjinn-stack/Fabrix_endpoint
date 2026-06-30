import { useCallback, useId, useMemo, useRef, useState } from "react";

// IMP-22 — 의존성 0 접근가능 폼 검증 훅.
// 3단계 타이밍(NN/g Forms guidelines): pristine=무에러 / blur=해당 필드 검증 / 이미-에러 or submit-후=change마다 재검증 / submit=전체.
// 죽은 상호작용(조용한 return)·disabled submit 안티패턴을 검증→에러렌더→포커스관리로 교체한다.

export type Validator<V> = (value: V[keyof V], values: V) => string | undefined;
export type Rules<V> = Partial<Record<keyof V, Validator<V>>>;

export interface FieldProps {
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  onBlur: () => void;
  ref: (el: HTMLElement | null) => void;
}

export interface FieldValidation<V> {
  /** 현재 노출 중(touched 또는 submit 후 & 에러 있음)인 필드 에러. */
  errors: Partial<Record<keyof V, string>>;
  submitted: boolean;
  /** <input {...fieldProps('name')} /> 로 스프레드. aria-invalid/describedby/onBlur/ref 일괄. */
  fieldProps(name: keyof V): FieldProps;
  /** 에러 노드 id(aria-describedby 대상). 항상 안정적인 값을 반환. */
  errorId(name: keyof V): string;
  /** 지금 노출해야 할 에러 텍스트(없으면 undefined). */
  showError(name: keyof V): string | undefined;
  /** 전체 검증 → 통과 시 onValid 실행, 실패 시 첫 오류필드(또는 summary)로 포커스 이동. */
  handleSubmit(onValid: () => void): void;
  reset(): void;
  /** 에러 SUMMARY 용 — 노출 중 에러 목록(필드 정의 순서). */
  visibleErrors: { name: keyof V; message: string }[];
  /** summary 컨테이너 ref(submit 시 포커스 이동 대상). opts.summary=true 일 때 사용. */
  summaryRef: (el: HTMLElement | null) => void;
  /** summary 점프 링크용 — 해당 필드로 포커스 이동. */
  focusField(name: keyof V): void;
}

// 공용 필수값 규칙 — 문자열은 trim, 그 외 falsy(빈/undefined/null) 차단.
export function required<V>(msg = "필수 항목입니다."): Validator<V> {
  return (value) => {
    if (typeof value === "string") return value.trim() ? undefined : msg;
    return value === undefined || value === null || value === "" ? msg : undefined;
  };
}

export function useFieldValidation<V extends object>(
  values: V,
  rules: Rules<V>,
  opts?: { summary?: boolean },
): FieldValidation<V> {
  const baseId = useId();
  const [touched, setTouched] = useState<Partial<Record<keyof V, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const refs = useRef(new Map<keyof V, HTMLElement | null>());
  const summaryEl = useRef<HTMLElement | null>(null);

  const ruleKeys = Object.keys(rules) as (keyof V)[];

  // 단일 필드 검증(규칙 없으면 undefined).
  const validateField = useCallback(
    (name: keyof V): string | undefined => {
      const rule = rules[name];
      return rule ? rule(values[name], values) : undefined;
    },
    [rules, values],
  );

  // 현재 노출 대상 에러 — touched 또는 submit 후인 필드만.
  const errors = useMemo(() => {
    const out: Partial<Record<keyof V, string>> = {};
    for (const name of ruleKeys) {
      if (submitted || touched[name]) {
        const msg = validateField(name);
        if (msg) out[name] = msg;
      }
    }
    return out;
    // ruleKeys 는 매 렌더 새 배열이라 deps 제외; validateField(values·rules)·touched·submitted 변화로 충분히 재계산.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validateField, touched, submitted]);

  const errorId = useCallback((name: keyof V) => `${baseId}-${String(name)}-err`, [baseId]);

  const showError = useCallback((name: keyof V) => errors[name], [errors]);

  const registerRef = useCallback(
    (name: keyof V) => (el: HTMLElement | null) => {
      refs.current.set(name, el);
    },
    [],
  );

  const onBlur = useCallback(
    (name: keyof V) => () => setTouched((t) => (t[name] ? t : { ...t, [name]: true })),
    [],
  );

  const fieldProps = useCallback(
    (name: keyof V): FieldProps => {
      const hasError = !!errors[name];
      return {
        ...(hasError ? { "aria-invalid": true as const, "aria-describedby": errorId(name) } : {}),
        onBlur: onBlur(name),
        ref: registerRef(name),
      };
    },
    [errors, errorId, onBlur, registerRef],
  );

  const visibleErrors = ruleKeys
    .filter((name) => !!errors[name])
    .map((name) => ({ name, message: errors[name] as string }));

  const handleSubmit = useCallback(
    (onValid: () => void) => {
      setSubmitted(true);
      const firstInvalid = ruleKeys.find((name) => validateField(name));
      if (!firstInvalid) {
        onValid();
        return;
      }
      // 포커스 이동: 긴 폼(summary)은 요약 컨테이너로, 짧은 폼은 첫 오류필드로.
      requestAnimationFrame(() => {
        if (opts?.summary && summaryEl.current) {
          summaryEl.current.focus();
        } else {
          refs.current.get(firstInvalid)?.focus();
        }
      });
    },
    [ruleKeys, validateField, opts?.summary],
  );

  const reset = useCallback(() => {
    setTouched({});
    setSubmitted(false);
  }, []);

  const summaryRef = useCallback((el: HTMLElement | null) => {
    summaryEl.current = el;
  }, []);

  const focusField = useCallback((name: keyof V) => {
    const el = refs.current.get(name);
    el?.focus();
    el?.scrollIntoView({ block: "center" });
  }, []);

  return { errors, submitted, fieldProps, errorId, showError, handleSubmit, reset, visibleErrors, summaryRef, focusField };
}
