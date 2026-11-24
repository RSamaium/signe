import { describe, expect, it, vi } from "vitest";
import { computed, effect, isSignal, signal } from "../../packages/reactive/src";

describe("signal methods on the shared prototype", () => {
  it("returns the same bound method on every access", () => {
    const s = signal(0);
    expect(s.set).toBe(s.set);
    expect(s.freeze).toBe(s.freeze);
    expect(s.observable).toBe(s.observable);
  });

  it("does not share methods between signals", () => {
    const a = signal(0);
    const b = signal(0);
    expect(a.set).not.toBe(b.set);
    a.set(1);
    expect(b()).toBe(0);
  });

  it("lets a method be replaced by assignment, on that signal only", () => {
    const a = signal(0);
    const b = signal(0);
    const custom = vi.fn();
    (a as any).set = custom;
    a.set(5);
    expect(custom).toHaveBeenCalledWith(5);
    expect(a()).toBe(0);
    b.set(5);
    expect(b()).toBe(5);
  });

  it("maps _isFrozen reads and writes to the signal state", () => {
    const s = signal(0);
    const seen: number[] = [];
    s.observable.subscribe((v) => seen.push(v));
    (s as any)._isFrozen = true;
    s.set(1);
    expect(s.freeze).toBeTypeOf("function");
    (s as any)._isFrozen = false;
    s.set(2);
    expect(seen).toEqual([0, 2]);
  });

  it("keeps signals recognizable and callable", () => {
    const s = signal(1);
    const c = computed(() => s() + 1);
    expect(isSignal(s)).toBe(true);
    expect(isSignal(c)).toBe(true);
    expect(typeof s).toBe("function");
    expect(s.call(null)).toBe(1);
    expect(c()).toBe(2);
  });

  it("creates computed.subscription on first access and disposes through it", () => {
    const s = signal(1);
    const run = vi.fn();
    const fx = effect(() => { s(); run(); });
    expect(fx.subscription).toBe(fx.subscription);
    fx.subscription.unsubscribe();
    s.set(2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("has no own enumerable methods, but `for...in` still lists them", () => {
    const s = signal(0);
    expect(Object.keys(s)).toEqual([]);
    const keys: string[] = [];
    for (const key in s) keys.push(key);
    expect(keys.sort()).toEqual(["_isFrozen", "_subject", "freeze", "mutate", "observable", "set", "unfreeze", "update"]);
  });
});
