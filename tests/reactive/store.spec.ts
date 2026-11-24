import { afterEach, describe, expect, it, vi } from "vitest";
import { isObservable } from "rxjs";
import { signal, computed, SignalStore, subscribeToSignal } from "../../packages/reactive/src";
import * as v2 from "@signe/reactive-v2";

afterEach(() => {
  vi.useRealTimers();
});

describe("SignalStore", () => {
  it("notifies listeners synchronously, without replay", () => {
    const store = new SignalStore(1);
    const seen: number[] = [];
    store.listen((v) => seen.push(v));
    store.emit(2);
    store.emit(3);
    expect(seen).toEqual([2, 3]);
    expect(store.last).toBe(3);
  });

  it("does not call a listener added during an emission", () => {
    const store = new SignalStore(0);
    const late = vi.fn();
    store.listen(() => { store.listen(late); });
    store.emit(1);
    expect(late).not.toHaveBeenCalled();
    store.emit(2);
    expect(late).toHaveBeenCalledWith(2);
  });

  it("does not call a listener removed during an emission", () => {
    const store = new SignalStore(0);
    const second = vi.fn();
    let stopSecond = () => {};
    store.listen(() => stopSecond());
    stopSecond = store.listen(second);
    store.emit(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("keeps notifying other listeners when one throws, and reports the error asynchronously", () => {
    vi.useFakeTimers();
    const store = new SignalStore(0);
    const after = vi.fn();
    store.listen(() => { throw new Error("boom"); });
    store.listen(after);
    store.emit(1);
    expect(after).toHaveBeenCalledWith(1);
    expect(() => vi.runAllTimers()).toThrow("boom");
  });

  it("completes observable subscribers and ignores later emissions", () => {
    const store = new SignalStore(0);
    const complete = vi.fn();
    const next = vi.fn();
    store.toObservable().subscribe({ next, complete });
    store.complete();
    store.emit(5);
    expect(complete).toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1); // replay only
  });

  it("supports many subscribers without slowing down subscription", () => {
    const store = new SignalStore(0);
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) store.listen(() => {});
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("signal on the new stores", () => {
  it("still exposes a real rxjs observable and a _subject with value, items or obj", () => {
    const p = signal(1);
    const a = signal([1]);
    const o = signal({ k: 1 });
    expect(isObservable(p.observable)).toBe(true);
    expect((p as any)._subject.value).toBe(1);
    expect((a as any)._subject.items).toEqual([1]);
    expect((o as any)._subject.obj).toEqual({ k: 1 });
    expect("_items" in (a as any)._subject).toBe(true);
    expect("_obj" in (o as any)._subject).toBe(true);
  });

  it("_subject.next() emits like the former subject", () => {
    const p = signal(1);
    const seen: number[] = [];
    p.observable.subscribe((v) => seen.push(v));
    (p as any)._subject.next(2);
    expect(seen).toEqual([1, 2]);
  });

  it("a computed has no _subject", () => {
    expect((computed(() => 1) as any)._subject).toBeUndefined();
  });

  it("array methods that do not mutate are fast-path bound and still correct", () => {
    const a = signal([3, 1, 2]);
    expect(a().map((x) => x * 2)).toEqual([6, 2, 4]);
    expect(a().includes(2)).toBe(true);
    expect([...a()]).toEqual([3, 1, 2]);
    expect(a().slice(1)).toEqual([1, 2]);
  });

  it("subscribeToSignal uses observable for 2.x signals and skips their replay", () => {
    const s = v2.signal(1);
    const seen: number[] = [];
    const stop = subscribeToSignal(s, (v) => seen.push(v));
    s.set(2);
    stop();
    s.set(3);
    expect(seen).toEqual([2]);
  });
});
