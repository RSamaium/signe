import { describe, expect, it, vi } from "vitest";
import { computed, isSignal, signal } from "../../packages/reactive/src";

describe("signal", () => {
  it("should create a signal with a primitive value", () => {
    const numSignal = signal(0);
    expect(numSignal()).toBe(0);
    numSignal.set(1);
    expect(numSignal()).toBe(1);
  });

  it("should create a signal with an array", () => {
    const arraySignal = signal([1, 2, 3]);
    expect(arraySignal()).toEqual([1, 2, 3]);
    arraySignal.set([4, 5, 6]);
    expect(arraySignal()).toEqual([4, 5, 6]);
  });

  it("should create a signal with an object", () => {
    const objectSignal = signal({ a: 1 });
    expect(objectSignal()).toEqual({ a: 1 });
    objectSignal.set({ a: 2 });
    expect(objectSignal()).toEqual({ a: 2 });
  });

  it('should mutate a signal with an array', () => {
    const arraySignal = signal([1, 2, 3]);
    arraySignal.mutate(arr => arr.push(4));
    expect(arraySignal()).toEqual([1, 2, 3, 4]);
  });

  it('should mutate a signal with an object', () => {
    const objectSignal = signal<any>({ a: 1 });
    objectSignal.mutate(obj => obj.b = 2);
    expect(objectSignal()).toEqual({ a: 1, b: 2 });
  });

  it('should update a signal with a new value using update function', () => {
    const numSignal = signal(1);
    numSignal.update(value => value + 1);
    expect(numSignal()).toBe(2);
  });

  it('should expose an observable and emit values correctly', () => {
    const numSignal = signal(0);
    const observedValues: number[] = [];
    numSignal.observable.subscribe(value => {
      observedValues.push(value);
    });

    numSignal.set(1);
    numSignal.set(2);

    expect(observedValues).toEqual([0, 1, 2]);
  });
});

describe("isSignal", () => {
  it("should identify a signal", () => {
    const numSignal = signal(0);
    expect(isSignal(numSignal)).toBe(true);
  });

  it("should not identify a non-signal", () => {
    const notSignal = { value: 0 };
    expect(isSignal(notSignal)).toBe(false);
  });
});

describe("computed", () => {
  it("should create a computed signal based on other signals", () => {
    const numSignal1 = signal(1);
    const numSignal2 = signal(2);
    const sumSignal = computed(() => numSignal1() + numSignal2());

    expect(sumSignal()).toBe(3);
    numSignal1.set(2);
    expect(sumSignal()).toBe(4);
  });

  it("should dispose the computed signal", () => {
    const numSignal = signal(1);
    const disposeFn = vi.fn();
    const compSignal = computed(() => numSignal() * 2, disposeFn);

    expect(compSignal()).toBe(2);
    numSignal.set(2);
    expect(compSignal()).toBe(4);

    compSignal.subscription.unsubscribe();
    expect(disposeFn).toHaveBeenCalled();
  });
});
