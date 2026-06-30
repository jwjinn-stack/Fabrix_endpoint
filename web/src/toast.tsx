// 전역 토스트/피드백 시스템(IMP-29) — zero-dep 자체구현(라이브러리 금지).
// React Aria Toast 구조를 청사진으로: 라이브 region 둘을 상시 DOM 에 두고 단일 toast() API 로 수렴.
//  - 성공/상태=role=status aria-live=polite, 오류=role=alert aria-live=assertive (아이템 aria-atomic).
//  - WCAG 2.2.1: 자동 dismiss + 수동 닫기 + 호버/포커스 시 타이머 일시정지(error 는 자동 dismiss 안 함).
//  - 비동기 적용은 promise 형(pending→success/실패, 동일 ID), humanizeError 를 error 매퍼로 연결.
//  - prefers-reduced-motion 은 CSS 가 처리, 동시 토스트 스택 상한(MAX).
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { humanizeError } from "./utils/errors";

export type ToastType = "success" | "error" | "info";
export interface ToastAction { label: string; onClick: () => void; }
export interface ToastOptions {
  type?: ToastType;
  message: string;
  action?: ToastAction;
  id?: string;       // 동일 ID 재호출 시 기존 토스트 갱신(promise 전이)
  duration?: number; // ms; 0/null = 자동 dismiss 안 함
}
export interface PromiseToastOptions<T> {
  pending: string;
  success: string | ((v: T) => string);
  error?: string | ((e: unknown) => string);
}
export interface ToastApi {
  (opts: ToastOptions | string): string;
  success(message: string, opts?: Partial<ToastOptions>): string;
  error(message: string, opts?: Partial<ToastOptions>): string;
  info(message: string, opts?: Partial<ToastOptions>): string;
  promise<T>(p: Promise<T>, o: PromiseToastOptions<T>): Promise<T>;
  dismiss(id: string): void;
}

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  action?: ToastAction;
  duration: number | null; // null = 영구(수동 닫기 전까지)
  pending: boolean;        // promise pending(스피너 표시·자동 dismiss 안 함)
}

const MAX_STACK = 4;
const DEFAULT_DURATION = 4000; // success/info 자동 소거(ms)

let seq = 0;
const nextId = () => `t${Date.now().toString(36)}-${(seq++).toString(36)}`;

// 기본 duration: error/pending 은 영구(중요건 — 사용자가 닫음), success/info 는 자동 소거.
function defaultDuration(type: ToastType, pending: boolean): number | null {
  if (pending) return null;
  if (type === "error") return null;
  return DEFAULT_DURATION;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast 는 <ToastProvider> 안에서만 사용할 수 있습니다.");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 추가 또는 갱신(동일 ID) — 스택 상한 초과 시 가장 오래된 것 제거.
  const upsert = useCallback((opts: ToastOptions, pending = false): string => {
    const type = opts.type ?? "info";
    const id = opts.id ?? nextId();
    const duration = opts.duration !== undefined ? (opts.duration || null) : defaultDuration(type, pending);
    setItems((prev) => {
      const exists = prev.some((t) => t.id === id);
      const item: ToastItem = { id, type, message: opts.message, action: opts.action, duration, pending };
      let next = exists ? prev.map((t) => (t.id === id ? item : t)) : [...prev, item];
      if (next.length > MAX_STACK) next = next.slice(next.length - MAX_STACK);
      return next;
    });
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => {
    const fn = ((opts: ToastOptions | string) =>
      upsert(typeof opts === "string" ? { message: opts } : opts)) as ToastApi;
    fn.success = (message, o) => upsert({ ...o, type: "success", message });
    fn.error = (message, o) => upsert({ ...o, type: "error", message });
    fn.info = (message, o) => upsert({ ...o, type: "info", message });
    fn.dismiss = dismiss;
    fn.promise = <T,>(p: Promise<T>, o: PromiseToastOptions<T>): Promise<T> => {
      const id = upsert({ type: "info", message: o.pending }, true);
      return p.then(
        (v) => {
          upsert({ id, type: "success", message: typeof o.success === "function" ? o.success(v) : o.success });
          return v;
        },
        (e) => {
          const msg = o.error
            ? (typeof o.error === "function" ? o.error(e) : o.error)
            : humanizeError(e instanceof Error ? e.message : String(e));
          upsert({ id, type: "error", message: msg });
          throw e;
        },
      );
    };
    return fn;
  }, [upsert, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

// 라이브 region 둘을 상시 배치. polite=성공/상태, assertive=오류.
// region 은 항상 DOM 에 있어야 스크린리더가 동적 삽입을 읽는다(빈 채로라도 마운트).
function ToastViewport({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  const assertive = items.filter((t) => t.type === "error");
  const polite = items.filter((t) => t.type !== "error");
  return (
    <>
      <div className="toast-region" role="status" aria-live="polite" aria-relevant="additions">
        {polite.map((t) => <ToastCard key={t.id} item={t} onDismiss={onDismiss} />)}
      </div>
      <div className="toast-region toast-region-alert" role="alert" aria-live="assertive" aria-relevant="additions">
        {assertive.map((t) => <ToastCard key={t.id} item={t} onDismiss={onDismiss} />)}
      </div>
    </>
  );
}

const ICON: Record<ToastType, string> = { success: "✓", error: "⚠", info: "ℹ" };

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const { id, type, message, action, duration, pending } = item;
  const [paused, setPaused] = useState(false);
  // 남은 시간 추적 — 호버/포커스 시 일시정지, 벗어나면 남은 시간으로 재개(WCAG 2.2.1).
  const remainingRef = useRef<number>(duration ?? 0);
  const startRef = useRef<number>(0);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (duration == null || pending || paused) return;
    startRef.current = Date.now();
    const t = window.setTimeout(() => dismissRef.current(id), remainingRef.current);
    return () => {
      // 일시정지/언마운트 시 경과분만큼 남은 시간 차감.
      window.clearTimeout(t);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startRef.current));
    };
  }, [id, duration, pending, paused]);

  const pause = () => setPaused(true);
  const resume = () => setPaused(false);

  return (
    <div
      className={`toast toast-${type}`}
      aria-atomic="true"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      {pending
        ? <span className="toast-icon spin" aria-hidden="true">◠</span>
        : <span className="toast-icon" aria-hidden="true">{ICON[type]}</span>}
      <span className="toast-msg">{message}</span>
      {action && (
        <button type="button" className="toast-action" onClick={() => { action.onClick(); onDismiss(id); }}>
          {action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="알림 닫기" onClick={() => onDismiss(id)}>×</button>
    </div>
  );
}
