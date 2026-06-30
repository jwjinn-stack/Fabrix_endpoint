// IMP-24 — 필터·기간 상태를 URL 과 양방향 동기화하는 의존성 0 훅.
//
// 기존 bespoke History-API 라우팅(router.ts) 위에 얹는다. 경로(페이지 전환·드릴다운)는
// App.navigate 의 pushState 가 담당하고, 여기서는 querystring(필터·기간 미세조정)만 책임진다.
// 미세조정은 replaceState 로 되써 back 스택을 오염시키지 않는다(Datadog/Grafana deep-link 패턴).
//
// 단일 출처: 화면의 필터/기간 state 를 URL 에서 시드하고, 변경 시 URL 로 되쓴다 —
// "시드-온-마운트 후 setFilter 는 URL 안 건드림" 비대칭을 제거한다.
import { useCallback, useEffect, useRef, useState } from "react";
import type { TimeRange } from "./api/types";

// ───────────────────────── 필드 직렬화 규칙 ─────────────────────────
// parse 는 잘못된/미허용 값에 대해 반드시 default 를 돌려준다(throw 금지 — crafted URL 방어).
export interface UrlField<T> {
  default: T;
  serialize: (v: T) => string | undefined; // undefined → URL 에서 생략(= default 와 동일할 때)
  parse: (raw: string | null) => T; // null/미허용 → default
}

// 단순 문자열 — default 와 같으면 생략(=all 등 노이즈 제거).
export function strField(def: string): UrlField<string> {
  return {
    default: def,
    serialize: (v) => (v === def || v === "" ? undefined : v),
    parse: (raw) => (raw == null || raw === "" ? def : raw),
  };
}

// 화이트리스트 enum — 미허용 값은 default 로 폴백.
export function enumField<T extends string>(allowed: readonly T[], def: T): UrlField<T> {
  const set = new Set<string>(allowed);
  return {
    default: def,
    serialize: (v) => (v === def ? undefined : v),
    parse: (raw) => (raw != null && set.has(raw) ? (raw as T) : def),
  };
}

// 배열 ↔ "a,b,c". 빈 배열은 생략. 빈 토큰은 제거.
export function csvField(def: string[] = []): UrlField<string[]> {
  const defStr = def.join(",");
  return {
    default: def,
    serialize: (v) => {
      const s = v.filter((x) => x !== "").join(",");
      return s === "" || s === defStr ? undefined : s;
    },
    parse: (raw) =>
      raw == null || raw === "" ? def : raw.split(",").map((s) => s.trim()).filter((s) => s !== ""),
  };
}

// 공용 기간 필드(TimeRange 화이트리스트). 미허용 값은 24h 로.
export const RANGE_VALUES: readonly TimeRange[] = ["1h", "6h", "24h", "7d"] as const;
export const rangeField: UrlField<TimeRange> = enumField(RANGE_VALUES, "24h");

// ───────────────────────── 순수 인코더/디코더 ─────────────────────────
// (테스트 용이성 — DOM/History 없이 schema + search string 만으로 동작.)
// 스키마 제약 — 필드 값 타입은 필드마다 다르므로 `any` 로 둔다(매핑 타입이 정확한 T 를 복원).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Schema = Record<string, UrlField<any>>;
export type StateOf<S extends Schema> = {
  [K in keyof S]: S[K] extends UrlField<infer T> ? T : never;
};
type PatchOf<S extends Schema> = Partial<StateOf<S>>;

export function decodeState<S extends Schema>(schema: S, search: string): StateOf<S> {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out = {} as StateOf<S>;
  for (const key of Object.keys(schema)) {
    (out as Record<string, unknown>)[key] = schema[key].parse(sp.get(key));
  }
  return out;
}

// default 와 동일한 값은 생략. 키 정렬 → 같은 뷰는 같은 URL(공유·재현 안정).
export function encodeState<S extends Schema>(schema: S, state: StateOf<S>): string {
  const parts: string[] = [];
  for (const key of Object.keys(schema).sort()) {
    const raw = schema[key].serialize((state as Record<string, unknown>)[key]);
    if (raw != null && raw !== "") {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(raw)}`);
    }
  }
  return parts.join("&");
}

const DEBOUNCE_MS = 300;

// schema 가 관리하지 않는 다른 query 키(예: 드릴다운에서 넘어온 from/to, key 등)는 보존한다 —
// 우리 키만 갈아끼우고 나머지는 그대로 둔다.
function mergeSearch<S extends Schema>(schema: S, currentSearch: string, encoded: string): string {
  const keep = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  for (const key of Object.keys(schema)) keep.delete(key);
  const mine = encoded;
  const rest = keep.toString();
  const merged = [mine, rest].filter((s) => s !== "").join("&");
  return merged;
}

// ───────────────────────── 훅 ─────────────────────────
// 반환: [state, patch]. patch 는 부분 갱신 + replaceState. opts.debounce=true 면 ~300ms 후 되쓰기(자유 텍스트용).
export function useUrlState<S extends Schema>(
  schema: S,
): [StateOf<S>, (next: PatchOf<S>, opts?: { debounce?: boolean }) => void] {
  // schema 는 모듈 상수로 넘어오므로 ref 로 고정(deps 안정).
  const schemaRef = useRef(schema);

  const [state, setState] = useState<StateOf<S>>(() =>
    decodeState(schemaRef.current, typeof window === "undefined" ? "" : window.location.search),
  );

  const stateRef = useRef(state);
  stateRef.current = state;

  // URL 되쓰기 — replaceState(필터/기간 미세조정은 back 스택을 더럽히지 않게).
  const writeUrl = useCallback((s: StateOf<S>) => {
    if (typeof window === "undefined") return;
    const encoded = encodeState(schemaRef.current, s);
    const search = mergeSearch(schemaRef.current, window.location.search, encoded);
    const url = window.location.pathname + (search ? `?${search}` : "");
    if (url !== window.location.pathname + window.location.search) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);

  const debounceRef = useRef<number | null>(null);
  const clearDebounce = () => {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  const patch = useCallback(
    (next: PatchOf<S>, opts?: { debounce?: boolean }) => {
      const merged = { ...stateRef.current, ...next } as StateOf<S>;
      stateRef.current = merged;
      setState(merged);
      clearDebounce();
      if (opts?.debounce) {
        debounceRef.current = window.setTimeout(() => {
          debounceRef.current = null;
          writeUrl(stateRef.current);
        }, DEBOUNCE_MS);
      } else {
        writeUrl(merged);
      }
    },
    [writeUrl],
  );

  // 뒤로/앞으로 가기(popstate) → URL 에서 state 복원. 드릴다운 pushState 후 back 도 여기로 잡힌다.
  useEffect(() => {
    const onPop = () => {
      const decoded = decodeState(schemaRef.current, window.location.search);
      stateRef.current = decoded;
      setState(decoded);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      clearDebounce();
    };
  }, []);

  return [state, patch];
}
