// Vitest 전역 셋업(IMP-13) — RTL 매처(toBeInTheDocument 등) 등록 + 각 테스트 후 DOM 정리.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// jsdom 의 localStorage 가 환경에 따라 노출되지 않거나 일부 메서드(clear)가 빠지는 경우가 있어
// (IMP-24 저장된 뷰 테스트), 최소 인메모리 Storage 폴리필을 항상 보장한다.
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.clear !== "function") {
  const store = new Map<string, string>();
  const mem: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true, writable: true });
}

// jsdom 은 HTMLDialogElement.showModal/show/close 를 구현하지 않는다(IMP-31).
// 네이티브 <dialog> 기반 Modal/SlidePanel/Notifications 테스트용 최소 폴리필 — open 속성만 토글.
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype;
  if (!proto.showModal) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!proto.show) {
    proto.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!proto.close) {
    proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
      this.open = false;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.dispatchEvent(new Event("close"));
    };
  }
}
