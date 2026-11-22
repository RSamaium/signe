/**
 * Public contract of @signe/reactive, as used by CanvasEngine (v2 branch) and RPG-JS (v5 branch).
 *
 * These tests pin observable behavior that downstream code depends on, so that internal
 * changes (for example replacing rxjs on the hot path) can be checked against it.
 * Each block names the downstream code that relies on it. Do not change an expectation
 * here without checking those call sites.
 */
import { describe, expect, it, vi } from "vitest";
import { combineLatest, isObservable, map, startWith, Subscription } from "rxjs";
import {
  computed,
  effect,
  isComputed,
  isSignal,
  signal,
  untracked,
} from "../../packages/reactive/src";
import { load } from "../../packages/sync/src";
import * as v2 from "@signe/reactive-v2";

const collect = (observable: any) => {
  const events: any[] = [];
  // Copy each event: object/array signals emit live (proxied) values that change later
  const subscription = observable.subscribe((e: any) =>
    events.push(e === undefined ? e : JSON.parse(JSON.stringify(e)))
  );
  return { events, subscription };
};

describe("contract: signal.observable is an rxjs Observable", () => {
  // CanvasEngine engine/reactive.ts (combineLatest of sig.observable), hooks/useProps.ts (pipe(map)),
  // RPG-JS server Player.ts (combineLatest x/y), client Game/Object.ts (pipe(map, startWith)).
  it("is recognized by rxjs and supports pipe operators", () => {
    const s = signal(1);
    expect(isObservable(s.observable)).toBe(true);

    const seen: number[] = [];
    s.observable.pipe(map((v: number) => v * 10)).subscribe((v) => seen.push(v));
    s.set(2);
    expect(seen).toEqual([10, 20]);
  });

  it("works with combineLatest: emits immediately, then on each change", () => {
    const x = signal(1);
    const y = signal(2);
    const seen: number[][] = [];
    combineLatest([x.observable, y.observable]).subscribe((v) => seen.push(v as number[]));

    x.set(3);
    y.set(4);
    expect(seen).toEqual([[1, 2], [3, 2], [3, 4]]);
  });

  it("works with startWith + map on a primitive signal (payload is the raw value)", () => {
    const scale = signal(1);
    const seen: number[] = [];
    scale.observable
      .pipe(startWith({ value: scale() }), map((p: any) => p?.value ?? p))
      .subscribe((v) => seen.push(v));
    scale.set(2);
    expect(seen).toEqual([1, 1, 2]);
  });

  // RPG-JS client Gui/Gui.ts: subscription.add(dependency.observable.subscribe(...))
  it("returns rxjs subscriptions that can be grouped and unsubscribed", () => {
    const s = signal(0);
    const fn = vi.fn();
    const group = new Subscription();
    group.add(s.observable.subscribe(fn));
    group.unsubscribe();
    fn.mockClear();
    s.set(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("emits the current value on subscribe and skips identical writes", () => {
    const s = signal(1);
    const { events } = collect(s.observable);
    s.set(1);
    s.set(2);
    expect(events).toEqual([1, 2]);
  });
});

describe("contract: object signal events", () => {
  // RPG-JS common/rooms/Map.ts: ({ value, type, key }) with add / update / remove / reset.
  // CanvasEngine engine/reactive.ts (loop over object signals uses change.key), tick ({ value }).
  it("emits init, then add / update / remove / reset with key and value", () => {
    const o = signal<Record<string, number>>({ a: 1 });
    const { events } = collect(o.observable);

    o().b = 2;
    o().a = 3;
    delete o().b;
    o.set({ c: 4 });

    expect(events).toEqual([
      { type: "init", value: { a: 1 } },
      { type: "add", key: "b", value: 2 },
      { type: "update", key: "a", value: 3 },
      { type: "remove", key: "b", value: 2 },
      { type: "reset", value: { c: 4 } },
    ]);
  });

  it("emits a property event from mutate() and a reset from update()", () => {
    const o = signal<Record<string, number>>({});
    const { events } = collect(o.observable);
    events.length = 0;

    o.mutate((v) => { v.d = 5; });
    o.update((v) => ({ ...v, e: 6 }));

    expect(events).toEqual([
      { type: "add", key: "d", value: 5 },
      { type: "reset", value: { d: 5, e: 6 } },
    ]);
  });

  // CanvasEngine and RPG-JS handle the first event specially: a late subscriber
  // receives the last emitted event, not a synthesized "init".
  it("replays the last event to a late subscriber", () => {
    const o = signal<Record<string, number>>({});
    o().a = 1;
    const { events } = collect(o.observable);
    expect(events).toEqual([{ type: "add", key: "a", value: 1 }]);
  });

  // CanvasEngine components/Canvas.ts: tick = signal({...}); tick.set({...}); subscribers read ({ value })
  it("delivers the new object as value when set() replaces it", () => {
    const tick = signal({ deltaTime: 0, frame: 0 });
    const frames: number[] = [];
    tick.observable.subscribe(({ value }: any) => frames.push(value.frame));
    tick.set({ deltaTime: 16, frame: 1 });
    expect(frames).toEqual([0, 1]);
  });
});

describe("contract: array signal events", () => {
  // RPG-JS client Game/Object.ts: ({ items }); CanvasEngine engine/reactive.ts loop over array signals.
  it("emits init, then add / update / remove / reset with index and items", () => {
    const a = signal<number[]>([1]);
    const { events } = collect(a.observable);

    a().push(2, 3);
    a()[0] = 9;
    a().pop();
    a().unshift(7);
    a().shift();
    a.set([5]);

    expect(events.map(({ type, index, items }) => ({ type, index, items }))).toEqual([
      { type: "init", index: undefined, items: [1] },
      { type: "add", index: 1, items: [2, 3] },
      { type: "update", index: 0, items: [9] },
      { type: "remove", index: 2, items: [] },
      { type: "add", index: 0, items: [7] },
      { type: "remove", index: 0, items: [] },
      { type: "reset", index: undefined, items: [5] },
    ]);
  });

  it("emits splice as remove / add / update", () => {
    const a = signal<number[]>([1, 2, 3]);
    const { events } = collect(a.observable);
    events.length = 0;

    a().splice(0, 1);
    a().splice(0, 0, 8);
    a().splice(0, 1, 9);

    expect(events.map(({ type, index }) => ({ type, index }))).toEqual([
      { type: "remove", index: 0 },
      { type: "add", index: 0 },
      { type: "update", index: 0 },
    ]);
  });

  it("replays the last event to a late subscriber", () => {
    const a = signal<number[]>([]);
    a().push(4);
    const { events } = collect(a.observable);
    expect(events).toEqual([{ type: "add", index: 0, items: [4] }]);
  });
});

describe("contract: freeze / unfreeze", () => {
  // RPG-JS uses freeze/unfreeze widely; CanvasEngine directives/Controls.ts, engine/reactive.ts.
  it("suppresses emissions while frozen and emits the current value on unfreeze", () => {
    const p = signal(1);
    const { events } = collect(p.observable);
    p.freeze();
    p.set(2);
    p.set(3);
    expect(p()).toBe(3);
    p.unfreeze();
    expect(events).toEqual([1, 3]);
  });

  it("emits an init event on unfreeze for object and array signals", () => {
    const o = signal<Record<string, number>>({});
    const a = signal<number[]>([]);
    const oe = collect(o.observable).events;
    const ae = collect(a.observable).events;
    oe.length = 0;
    ae.length = 0;

    o.freeze();
    a.freeze();
    o().z = 1;
    a().push(1);
    o.unfreeze();
    a.unfreeze();

    expect(oe).toEqual([{ type: "init", value: { z: 1 } }]);
    expect(ae).toEqual([{ type: "init", items: [1] }]);
  });

  it("exposes the frozen state as _isFrozen", () => {
    const p = signal(1);
    p.freeze();
    expect((p as any)._isFrozen).toBe(true);
    p.unfreeze();
    expect((p as any)._isFrozen).toBe(false);
  });
});

describe("contract: detached methods and signal-like wrappers", () => {
  // CanvasEngine hooks/useProps.ts copies methods onto another function:
  //   callable.set = valueSignal.set; callable.observable = valueSignal.observable; callable._subject = valueSignal._subject
  //   derived.mutate = source.mutate; derived.freeze = source.freeze
  it("set / update / mutate / freeze / unfreeze work when detached from the signal", () => {
    const s = signal(1);
    const { set, update, freeze, unfreeze } = s;
    const seen: number[] = [];
    s.observable.subscribe((v) => seen.push(v));

    set(2);
    update((v) => v + 1);
    freeze();
    set(10);
    unfreeze();

    expect(s()).toBe(10);
    expect(seen).toEqual([1, 2, 3, 10]);

    const o = signal<Record<string, number>>({});
    const { mutate } = o;
    mutate((v) => { v.a = 1; });
    expect(o()).toEqual({ a: 1 });
  });

  it("a wrapper copying observable and _subject is a signal for isSignal and load()", () => {
    const valueSignal: any = signal(() => "a");
    const callable: any = (...args: any[]) => valueSignal()(...args);
    callable.set = valueSignal.set;
    callable.observable = valueSignal.observable;
    callable._subject = valueSignal._subject;

    expect(isSignal(callable)).toBe(true);
    expect(callable._subject).toBeTruthy();

    const target: any = { prop: callable };
    load(target, { prop: () => "b" }, true);
    expect(callable()).toBe("b");
  });

  // CanvasEngine engine/animation.ts (animatedSignal): `for (const key in publicSignal) fn[key] = publicSignal[key]`
  it("a function filled with `for...in` over a signal gets its methods and observable", () => {
    const publicSignal = signal(1);
    const fn: any = () => publicSignal();
    for (const key in publicSignal) {
      fn[key] = (publicSignal as any)[key];
    }
    expect(isSignal(fn)).toBe(true);
    for (const key of ["set", "update", "mutate", "freeze", "unfreeze", "observable", "_subject", "_isFrozen"]) {
      expect(key in fn).toBe(true);
    }
    const seen: number[] = [];
    fn.observable.subscribe((v: number) => seen.push(v));
    fn.set(2);
    fn.freeze();
    fn.set(3);
    fn.unfreeze();
    expect(fn()).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("a computed copied with `for...in` keeps observable, dependencies and subscription", () => {
    const a = signal(1);
    const c = computed(() => a() * 2);
    const copy: any = () => c();
    for (const key in c) {
      copy[key] = (c as any)[key];
    }
    expect(isSignal(copy)).toBe(true);
    expect(copy.dependencies).toBe(c.dependencies);
    expect(copy.subscription).toBe(c.subscription);
  });

  it("isSignal is true for signals and computed, false for plain values", () => {
    expect(isSignal(signal(1))).toBe(true);
    expect(isSignal(computed(() => 1))).toBe(true);
    expect(isSignal(() => 1)).toBe(false);
    expect(isSignal({})).toBe(false);
  });
});

describe("contract: computed and effect", () => {
  // CanvasEngine engine/reactive.ts: "dependencies" in value && value.dependencies.size == 0,
  //   isComputed(items) && items.dependencies.size == 0; directives/Drag.ts: prop.dependencies.forEach
  it("exposes dependencies as a Set, empty for a constant computed", () => {
    const a = signal(1);
    const c = computed(() => a() + 1);
    const k = computed(() => 42);

    expect(c.dependencies).toBeInstanceOf(Set);
    expect(c.dependencies.size).toBe(1);
    expect(c.dependencies.has(a as any)).toBe(true);
    expect(k.dependencies.size).toBe(0);
    expect(isComputed(c)).toBe(true);
    expect(isComputed(a)).toBe(false);
  });

  it("computed.observable emits the current value on subscribe, then each change", () => {
    const a = signal(1);
    const c = computed(() => a() * 2);
    const { events } = collect(c.observable);
    a.set(5);
    expect(events).toEqual([2, 10]);
  });

  it("computed.observable works with combineLatest", () => {
    const a = signal(1);
    const c = computed(() => a() * 2);
    const seen: any[] = [];
    combineLatest([a.observable, c.observable]).subscribe((v) => seen.push(v));
    a.set(2);
    expect(seen[0]).toEqual([1, 2]);
    expect(seen.at(-1)).toEqual([2, 4]);
  });

  // CanvasEngine and RPG-JS dispose effects/computed through .subscription
  it("subscription.unsubscribe() stops recomputation and runs the effect cleanup", () => {
    const a = signal(1);
    const run = vi.fn();
    const cleanup = vi.fn();
    const fx = effect(() => {
      a();
      run();
      return cleanup;
    });
    a.set(2);
    expect(run).toHaveBeenCalledTimes(2);
    expect(cleanup).not.toHaveBeenCalled();

    fx.subscription.unsubscribe();
    a.set(3);
    expect(run).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("untracked() reads are not dependencies", () => {
    const a = signal(1);
    const b = signal(1);
    const run = vi.fn();
    effect(() => {
      a();
      untracked(() => b());
      run();
    });
    b.set(2);
    expect(run).toHaveBeenCalledTimes(1);
    a.set(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("reports computed subscriptions to the global subscriptions tracker", () => {
    const store = (globalThis as any).__REACTIVE_STORE__;
    const tracked: any[] = [];
    const previous = store.currentSubscriptionsTracker;
    store.currentSubscriptionsTracker = (s: any) => tracked.push(s);
    try {
      const c = computed(() => 1);
      expect(tracked).toContain(c.subscription);
    } finally {
      store.currentSubscriptionsTracker = previous;
    }
  });
});

describe("contract: interop with @signe/reactive 2.x", () => {
  // RPG-JS client loads @signe/reactive 2.10.0 (through canvasengine) and 3.x at the same time.
  // Both share globalThis.__REACTIVE_STORE__ and subscribe to each other's signals via .observable.
  it("shares the global store", () => {
    const store = (globalThis as any).__REACTIVE_STORE__;
    expect(store).toBeDefined();
    expect("currentDependencyTracker" in store).toBe(true);
    expect("currentSubscriptionsTracker" in store).toBe(true);
  });

  it("a 2.x computed tracks a signal of this version", () => {
    const s = signal(1);
    const c = v2.computed(() => s() * 2);
    s.set(5);
    expect(c()).toBe(10);
  });

  it("a computed of this version tracks a 2.x signal", () => {
    const s = v2.signal(1);
    const c = computed(() => s() * 2);
    s.set(5);
    expect(c()).toBe(10);
  });

  it("a 2.x effect reruns when a signal of this version changes", () => {
    const s = signal(1);
    const seen: number[] = [];
    v2.effect(() => { seen.push(s()); });
    s.set(2);
    expect(seen).toEqual([1, 2]);
  });

  it("an effect of this version reruns when a 2.x object signal changes", () => {
    const o = v2.signal<Record<string, number>>({});
    const seen: number[] = [];
    effect(() => { seen.push(Object.keys(o()).length); });
    o().a = 1;
    expect(seen).toEqual([0, 1]);
  });

  it("observables of both versions combine with combineLatest", () => {
    const a = signal(1);
    const b = v2.signal(2);
    const seen: any[] = [];
    combineLatest([a.observable, b.observable]).subscribe((v) => seen.push(v));
    b.set(3);
    expect(seen).toEqual([[1, 2], [1, 3]]);
  });
});
