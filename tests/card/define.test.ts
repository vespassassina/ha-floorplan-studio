import { afterEach, describe, expect, it, vi } from "vitest";
import { defineElement } from "../../src/card/define";

/** Stands in for the scoped-custom-element-registry polyfill HA's core installs: a fresh registry that knows
 * nothing about names defined natively before it arrived (seen live on 0.12.1: get() undefined, while
 * document.createElement still built our class). */
function fakeRegistry() {
  const m = new Map<string, CustomElementConstructor>();
  return {
    get: (n: string) => m.get(n),
    define: vi.fn((n: string, c: CustomElementConstructor) => {
      if (m.has(n)) throw new Error(`${n} already defined`);
      m.set(n, c);
    }),
  };
}

describe("S8.3: defineElement survives a registry swap", () => {
  const original = Object.getOwnPropertyDescriptor(window, "customElements");
  const swap = (r: unknown) => Object.defineProperty(window, "customElements", { value: r, configurable: true, writable: true });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (original) Object.defineProperty(window, "customElements", original);
    else delete (window as { customElements?: unknown }).customElements;
  });

  it("defines at once on the registry it finds", () => {
    const r = fakeRegistry();
    swap(r);
    class A extends HTMLElement {}
    defineElement("s83-a", A);
    expect(r.get("s83-a")).toBe(A);
  });

  it("defines again on a registry that replaced the first one later", () => {
    vi.useFakeTimers();
    const first = fakeRegistry();
    swap(first);
    class B extends HTMLElement {}
    defineElement("s83-b", B);
    const second = fakeRegistry();
    swap(second);
    expect(second.get("s83-b")).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(second.get("s83-b")).toBe(B);
  });

  it("never defines twice on the same registry, and never throws", () => {
    vi.useFakeTimers();
    const r = fakeRegistry();
    swap(r);
    class C extends HTMLElement {}
    defineElement("s83-c", C);
    vi.advanceTimersByTime(60_000);
    expect(r.define).toHaveBeenCalledTimes(1);
  });

  it("stops watching after 30 s", () => {
    vi.useFakeTimers();
    swap(fakeRegistry());
    class D extends HTMLElement {}
    defineElement("s83-d", D);
    vi.advanceTimersByTime(31_000);
    const late = fakeRegistry();
    swap(late);
    vi.advanceTimersByTime(5_000);
    expect(late.get("s83-d")).toBeUndefined();
  });
});
