import { afterEach, describe, expect, it, vi } from "vitest";
import { batch, computed, effect, linkedSignal, signal } from "../../packages/reactive/src";

afterEach(() => vi.useRealTimers());

describe("batch()", () => {
  it("runs an effect once with the final values", () => {
    const x = signal(0);
    const y = signal(0);
    const seen: Array<[number, number]> = [];
    effect(() => { seen.push([x(), y()]); });
    seen.length = 0;

    batch(() => {
      x.set(10);
      y.set(20);
    });

    expect(seen).toEqual([[10, 20]]);
  });

  it("returns the value of the function", () => {
    expect(batch(() => 42)).toBe(42);
  });

  it("reads fresh computed values inside the batch", () => {
    const a = signal(1);
    const double = computed(() => a() * 2);
    let inside = 0;
    batch(() => {
      a.set(5);
      inside = double();
    });
    expect(inside).toBe(10);
  });

  it("updates a diamond once", () => {
    const a = signal(0);
    const b = computed(() => a() + 1);
    const c = computed(() => a() * 2);
    const run = vi.fn(() => b() + c());
    const d = computed(run);
    run.mockClear();

    batch(() => { a.set(1); a.set(2); });

    expect(d()).toBe(3 + 4);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("flushes when the outermost batch ends", () => {
    const a = signal(0);
    const run = vi.fn();
    effect(() => { a(); run(); });
    run.mockClear();

    batch(() => {
      batch(() => { a.set(1); });
      expect(run).not.toHaveBeenCalled();
      a.set(2);
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("still delivers every change event to observable subscribers during the batch", () => {
    const a = signal(0);
    const seen: number[] = [];
    a.observable.subscribe((v) => seen.push(v));
    batch(() => { a.set(1); a.set(2); });
    expect(seen).toEqual([0, 1, 2]);
  });

  it("flushes even when the function throws", () => {
    const a = signal(0);
    const run = vi.fn();
    effect(() => { a(); run(); });
    run.mockClear();

    expect(() => batch(() => { a.set(1); throw new Error("stop"); })).toThrow("stop");
    expect(run).toHaveBeenCalledTimes(1);

    a.set(2); // not batching anymore
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps running other updates when one throws, and reports the error", () => {
    vi.useFakeTimers();
    const a = signal(0);
    const after = vi.fn();
    effect(() => { if (a() === 1) throw new Error("boom"); });
    effect(() => { a(); after(); });
    after.mockClear();

    batch(() => { a.set(1); });
    expect(after).toHaveBeenCalledTimes(1);
    expect(() => vi.runAllTimers()).toThrow("boom");
  });

  it("works with linkedSignal", () => {
    const a = signal(1);
    const b = signal(1);
    const linked = linkedSignal(() => a() + b());
    const run = vi.fn();
    effect(() => { linked(); run(); });
    run.mockClear();

    batch(() => { a.set(2); b.set(3); });
    expect(linked()).toBe(5);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
