// 파라미터 폼 검증 훅 (IMP-59) — ActionParam[] 스키마를 받아 값/에러/터치 상태를 관리한다.
// FieldError(빨강 아이콘+텍스트) 와 짝을 이루고, ActionForm 이 submit 게이팅에 validateAll() 을 쓴다.
// zero-dep — 폼 라이브러리(react-hook-form 등) 미사용(프로젝트 ethos).
import { useCallback, useMemo, useState } from "react";
import type { ActionParam } from "../api/types";

export type FieldValues = Record<string, string>;
export type FieldErrors = Record<string, string | undefined>;

// 단일 필드 검증 — required 미입력·number 형식·enum 후보 위반을 잡는다.
function validateOne(param: ActionParam, raw: string): string | undefined {
  const v = (raw ?? "").trim();
  if (param.required && v === "") return "필수 입력 항목입니다";
  if (v === "") return undefined; // 선택 항목 미입력은 통과
  if (param.kind === "number") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "숫자를 입력하세요";
  }
  if (param.kind === "enum" && param.options && !param.options.includes(v)) {
    return "허용된 값이 아닙니다";
  }
  return undefined;
}

export interface FieldValidation {
  values: FieldValues;
  errors: FieldErrors;
  touched: Record<string, boolean>;
  setValue: (name: string, value: string) => void;
  touch: (name: string) => void;
  validateAll: () => boolean; // 전체 검증 후 통과 여부. 실패 시 모든 필드 touched + errors 채움.
  reset: () => void;
}

export function useFieldValidation(params: ActionParam[]): FieldValidation {
  // enum 기본값은 첫 옵션 — required enum 이 빈 값으로 남지 않게.
  const initial = useMemo<FieldValues>(() => {
    const o: FieldValues = {};
    for (const p of params) o[p.name] = p.kind === "enum" && p.options?.length ? p.options[0] : "";
    return o;
  }, [params]);

  const [values, setValues] = useState<FieldValues>(initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const errors = useMemo<FieldErrors>(() => {
    const e: FieldErrors = {};
    for (const p of params) e[p.name] = validateOne(p, values[p.name] ?? "");
    return e;
  }, [params, values]);

  const setValue = useCallback((name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const touch = useCallback((name: string) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
  }, []);

  const validateAll = useCallback(() => {
    const allTouched: Record<string, boolean> = {};
    let okAll = true;
    for (const p of params) {
      allTouched[p.name] = true;
      if (validateOne(p, values[p.name] ?? "")) okAll = false;
    }
    setTouched(allTouched);
    return okAll;
  }, [params, values]);

  const reset = useCallback(() => {
    setValues(initial);
    setTouched({});
  }, [initial]);

  return { values, errors, touched, setValue, touch, validateAll, reset };
}
