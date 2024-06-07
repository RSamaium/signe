import { describe, expect, it, vi } from "vitest";
import { signal } from "../../packages/reactive/src";

describe("ArraySubject", () => {
  it("should create an array signal", () => {
    const arraySignal = signal([1, 2, 3]);
    arraySignal.observable.subscribe((change) => {
      expect(change).toEqual({ type: "init", items: [1, 2, 3] });
    });
  });

  it("should notify subscribers on push", () => {
    const arraySignal = signal([1, 2, 3]);
    const mockFn = vi.fn();

    arraySignal.observable.subscribe(mockFn);

    arraySignal.mutate((arr) => arr.push(4));

    expect(mockFn).toHaveBeenCalledWith({ type: "add", index: 3, items: [4] });
  });

  it("should notify subscribers on pop", () => {
    const arraySignal = signal([1, 2, 3, 4]);
    const mockFn = vi.fn();

    arraySignal.observable.subscribe(mockFn);

    arraySignal.mutate((arr) => arr.pop());

    expect(mockFn).toHaveBeenCalledWith({
      type: "remove",
      index: 3,
      items: [],
    });
  });

  it("should notify subscribers on unshift", () => {
    const arraySignal = signal([2, 3, 4]);
    const mockFn = vi.fn();

    arraySignal.observable.subscribe(mockFn);

    arraySignal.mutate((arr) => arr.unshift(1));

    expect(mockFn).toHaveBeenCalledWith({ type: "add", index: 0, items: [1] });
  });

  it("should notify subscribers on shift", () => {
    const arraySignal = signal([1, 2, 3, 4]);
    const mockFn = vi.fn();

    arraySignal.observable.subscribe(mockFn);

    arraySignal.mutate((arr) => arr.shift());

    expect(mockFn).toHaveBeenCalledWith({
      type: "remove",
      index: 0,
      items: [],
    });
  });

  it("should notify subscribers on splice (add)", () => {
    const arraySignal = signal([1, 2, 4]);
    const mockFn = vi.fn();

    arraySignal.observable.subscribe(mockFn);

    arraySignal.mutate((arr) => arr.splice(2, 0, 3));

    expect(mockFn).toHaveBeenCalledWith({ type: "add", index: 2, items: [3] });
  });

  it("should notify subscribers on splice (remove)", () => {
    const arraySignal = signal([1, 2, 3, 4]);
    const mockFn = vi.fn();

    arraySignal.observable.subscribe(mockFn);

    arraySignal.mutate((arr) => arr.splice(2, 1));

    expect(mockFn).toHaveBeenCalledWith({
      type: "remove",
      index: 2,
      items: [],
    });
  });

  it("should notify subscribers on direct index set", () => {
    const arraySignal = signal([1, 2, 3]);
    const mockFn = vi.fn();

    arraySignal.observable.subscribe(mockFn);

    arraySignal.mutate((arr) => (arr[1] = 4));

    expect(mockFn).toHaveBeenCalledWith({
      type: "update",
      index: 1,
      items: [4],
    });
  });

  it("should notify subscribers on reset", () => {
    const arraySignal = signal([1, 2, 3]);
    const mockFn = vi.fn();

    arraySignal.observable.subscribe(mockFn);

    arraySignal.set([4, 5, 6]);

    expect(mockFn).toHaveBeenCalledWith({ type: "reset", items: [4, 5, 6] });
  });
});
