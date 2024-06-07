import { describe, expect, it, vi } from "vitest";
import { effect, signal } from "../../packages/reactive/src";

describe("effect", () => {
  it("should create an effect and run the function immediately", () => {
    const numSignal = signal(0);
    const mockFn = vi.fn();

    const myEffect = effect(() => {
      numSignal();
      mockFn();
    });

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("should rerun the effect when the signal changes", () => {
    const numSignal = signal(0);
    const mockFn = vi.fn();

    const myEffect = effect(() => {
      numSignal();
      mockFn();
    });

    expect(mockFn).toHaveBeenCalledTimes(1);

    numSignal.set(1);
    expect(mockFn).toHaveBeenCalledTimes(2);

    numSignal.set(2);
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it("should dispose the effect properly", () => {
    const numSignal = signal(0);
    const mockFn = vi.fn();

    const myEffect = effect(() => {
      numSignal();
      mockFn();
    });

    expect(mockFn).toHaveBeenCalledTimes(1);

    myEffect.subscription.unsubscribe();

    numSignal.set(1);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("should call the cleanup function when disposed", () => {
    const numSignal = signal(0);
    const cleanupFn = vi.fn();

    const myEffect = effect(() => {
      numSignal();
      return cleanupFn;
    });

    myEffect.subscription.unsubscribe();

    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it("should not call the cleanup function when the signal changes", () => {
    const numSignal = signal(0);
    const cleanupFn = vi.fn();

    effect(() => {
      numSignal();
      return cleanupFn;
    });

    numSignal.set(1);
    expect(cleanupFn).toHaveBeenCalledTimes(0);
  });
});
