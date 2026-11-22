import { describe, expect, it, vi } from "vitest";
import { computed, effect, linkedSignal, signal, untracked } from "../../packages/reactive/src";

describe("computed: dynamic dependency tracking", () => {
  it("tracks a signal first read in a branch not taken on the first run (#34)", () => {
    const moving = signal(false);
    const running = signal(false);
    const clip = computed(() => (moving() ? (running() ? "Running" : "Walking") : "Idle"));

    const seen: string[] = [];
    clip.observable.subscribe((v) => seen.push(v));

    moving.set(true);
    running.set(true);

    expect(clip()).toBe("Running");
    expect(seen).toEqual(["Idle", "Walking", "Running"]);
    expect(clip.dependencies.size).toBe(2);
  });

  it("stops tracking a signal that is no longer read", () => {
    const useA = signal(true);
    const a = signal(1);
    const b = signal(10);
    const fn = vi.fn(() => (useA() ? a() : b()));
    const value = computed(fn);

    useA.set(false);
    expect(value()).toBe(10);
    expect(value.dependencies.has(a as any)).toBe(false);
    expect(value.dependencies.has(b as any)).toBe(true);

    fn.mockClear();
    a.set(2);
    expect(fn).not.toHaveBeenCalled();

    b.set(20);
    expect(value()).toBe(20);
  });

  it("keeps the same dependencies Set instance", () => {
    const flag = signal(false);
    const other = signal(0);
    const value = computed(() => (flag() ? other() : 0));
    const deps = value.dependencies;

    flag.set(true);

    expect(value.dependencies).toBe(deps);
    expect(deps.size).toBe(2);
  });

  it("propagates through a chain of computed with conditional reads", () => {
    const enabled = signal(false);
    const base = signal(1);
    const doubled = computed(() => base() * 2);
    const result = computed(() => (enabled() ? doubled() : -1));

    enabled.set(true);
    expect(result()).toBe(2);

    base.set(5);
    expect(result()).toBe(10);
  });

  it("does not recompute once per subscriber", () => {
    const source = signal(1);
    const fn = vi.fn(() => source() * 2);
    const value = computed(fn);

    value.observable.subscribe(() => {});
    value.observable.subscribe(() => {});
    fn.mockClear();

    source.set(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("emits the current value to new subscribers", () => {
    const source = signal(3);
    const value = computed(() => source() + 1);
    const seen: number[] = [];

    value.observable.subscribe((v) => seen.push(v));

    expect(seen).toEqual([4]);
  });

  it("stops recomputing and completes once disposed", () => {
    const source = signal(1);
    const fn = vi.fn(() => source());
    const value = computed(fn);
    const complete = vi.fn();
    value.observable.subscribe({ complete });

    value.subscription.unsubscribe();
    fn.mockClear();
    source.set(2);

    expect(fn).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalled();
  });

  it("does not track reads inside untracked()", () => {
    const flag = signal(true);
    const hidden = signal(0);
    const value = computed(() => (flag() ? untracked(() => hidden()) : 0));

    expect(value.dependencies.has(hidden as any)).toBe(false);
  });
});

describe("effect: dynamic dependency tracking", () => {
  it("reruns when a conditionally read signal changes", () => {
    const show = signal(false);
    const label = signal("a");
    const seen: string[] = [];

    effect(() => {
      seen.push(show() ? label() : "hidden");
    });

    show.set(true);
    label.set("b");

    expect(seen).toEqual(["hidden", "a", "b"]);
  });

  it("still calls the cleanup only on dispose", () => {
    const show = signal(false);
    const label = signal("a");
    const cleanup = vi.fn();

    const fx = effect(() => {
      if (show()) label();
      return cleanup;
    });

    show.set(true);
    label.set("b");
    expect(cleanup).not.toHaveBeenCalled();

    fx.subscription.unsubscribe();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("linkedSignal: dynamic dependency tracking", () => {
  it("tracks a signal first read in a branch not taken on the first run", () => {
    const enabled = signal(false);
    const value = signal(1);
    const linked = linkedSignal(() => (enabled() ? value() : 0));

    enabled.set(true);
    value.set(2);

    expect(linked()).toBe(2);
    expect(linked.dependencies.size).toBe(2);
  });

  it("stops tracking a signal that is no longer read", () => {
    const useA = signal(true);
    const a = signal(1);
    const b = signal(10);
    const fn = vi.fn(() => (useA() ? a() : b()));
    const linked = linkedSignal(fn);

    useA.set(false);
    fn.mockClear();
    a.set(2);

    expect(fn).not.toHaveBeenCalled();
    expect(linked()).toBe(10);
  });

  it("tracks signals read conditionally in source + computation mode", () => {
    const useOverride = signal(false);
    const base = signal(1);
    const custom = signal(100);
    const linked = linkedSignal({
      source: () => (useOverride() ? custom() : base()),
      computation: (v: number) => v * 2,
    });

    useOverride.set(true);
    custom.set(200);

    expect(linked()).toBe(400);
  });

  it("resets an override when a newly tracked signal changes", () => {
    const enabled = signal(false);
    const value = signal(1);
    const linked = linkedSignal(() => (enabled() ? value() : 0));

    enabled.set(true);
    linked.set(50);
    expect(linked()).toBe(50);

    value.set(3);
    expect(linked()).toBe(3);
  });

  it("calls the computation once per change regardless of subscribers", () => {
    const source = signal(1);
    const computation = vi.fn((v: number) => v * 2);
    const linked = linkedSignal({ source, computation });

    linked.observable.subscribe(() => {});
    linked.observable.subscribe(() => {});
    computation.mockClear();

    source.set(2);
    expect(computation).toHaveBeenCalledTimes(1);
  });

  it("emits overrides and recomputations to subscribers", () => {
    const source = signal(1);
    const linked = linkedSignal(() => source() * 10);
    const seen: number[] = [];
    linked.observable.subscribe((v) => seen.push(v));

    linked.set(5);
    source.set(2);

    expect(seen).toEqual([10, 5, 20]);
  });

  it("stops recomputing once disposed", () => {
    const source = signal(1);
    const fn = vi.fn(() => source());
    const linked = linkedSignal(fn);

    linked.subscription.unsubscribe();
    fn.mockClear();
    source.set(2);

    expect(fn).not.toHaveBeenCalled();
  });
});
