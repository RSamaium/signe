import { describe, it, expect, vi } from "vitest";
import { signal, computed, untracked, effect } from "../../packages/reactive/src";

describe("untracked", () => {
  it("should return the function result", () => {
    const num = signal(1);
    const result = untracked(() => num() + 1);
    expect(result).toBe(2);
  });

  it("should not track dependencies", () => {
    const num = signal(1);
    const comp = computed(() => {
      untracked(() => num());
      return 5;
    });

    expect(comp()).toBe(5);
    expect(comp.dependencies).toHaveLength(0);
  });

  describe("with effects", () => {
    it("should not track signal dependencies when reading inside untracked", () => {
      const tracked = signal(1);
      const untracked1 = signal(10);
      const mockFn = vi.fn();

      // Create an effect that reads one signal normally and another inside untracked
      const myEffect = effect(() => {
        tracked(); // This should create a dependency
        untracked(() => {
          untracked1(); // This should NOT create a dependency
        });
        mockFn();
      });

      expect(mockFn).toHaveBeenCalledTimes(1);

      // Changing the tracked signal should trigger the effect
      tracked.set(2);
      expect(mockFn).toHaveBeenCalledTimes(2);

      // Changing the untracked signal should NOT trigger the effect
      untracked1.set(20);
      expect(mockFn).toHaveBeenCalledTimes(2);

      myEffect.subscription.unsubscribe();
    });

    it("should still allow effects to react to tracked dependencies outside untracked", () => {
      const tracked1 = signal(1);
      const tracked2 = signal(2);
      const untrackedSignal = signal(100);
      const mockFn = vi.fn();

      const myEffect = effect(() => {
        const val1 = tracked1(); // Tracked dependency
        const val2 = tracked2(); // Tracked dependency
        
        // Read a signal inside untracked - should not create dependency
        const untrackedValue = untracked(() => untrackedSignal());
        
        mockFn(val1, val2, untrackedValue);
      });

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenLastCalledWith(1, 2, 100);

      // Changing tracked signals should trigger the effect
      tracked1.set(10);
      expect(mockFn).toHaveBeenCalledTimes(2);
      expect(mockFn).toHaveBeenLastCalledWith(10, 2, 100);

      tracked2.set(20);
      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(mockFn).toHaveBeenLastCalledWith(10, 20, 100);

      // Changing the untracked signal should NOT trigger the effect
      untrackedSignal.set(200);
      expect(mockFn).toHaveBeenCalledTimes(3);

      myEffect.subscription.unsubscribe();
    });

    it("should work with nested untracked calls in effects", () => {
      const tracked = signal(1);
      const untracked1 = signal(10);
      const untracked2 = signal(20);
      const mockFn = vi.fn();

      const myEffect = effect(() => {
        const trackedValue = tracked();
        
        const result = untracked(() => {
          const val1 = untracked1();
          const val2 = untracked(() => untracked2()); // Nested untracked
          return val1 + val2;
        });
        
        mockFn(trackedValue, result);
      });

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenLastCalledWith(1, 30);

      // Only the tracked signal should trigger the effect
      tracked.set(5);
      expect(mockFn).toHaveBeenCalledTimes(2);
      expect(mockFn).toHaveBeenLastCalledWith(5, 30);

      // Untracked signals should not trigger the effect
      untracked1.set(15);
      untracked2.set(25);
      expect(mockFn).toHaveBeenCalledTimes(2);

      myEffect.subscription.unsubscribe();
    });

    it("should preserve untracked behavior when effect cleanup function is returned", () => {
      const tracked = signal(1);
      const untrackedSignal = signal(100);
      const mockFn = vi.fn();
      const cleanupFn = vi.fn();

      const myEffect = effect(() => {
        const trackedValue = tracked();
        
        untracked(() => {
          untrackedSignal(); // Should not create dependency
        });
        
        mockFn(trackedValue);
        return cleanupFn;
      });

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(cleanupFn).toHaveBeenCalledTimes(0);

      // Changing tracked signal should trigger effect
      tracked.set(2);
      expect(mockFn).toHaveBeenCalledTimes(2);

      // Changing untracked signal should not trigger effect
      untrackedSignal.set(200);
      expect(mockFn).toHaveBeenCalledTimes(2);

      // Cleanup should be called when effect is disposed
      myEffect.subscription.unsubscribe();
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it("should allow reading the same signal both tracked and untracked in different parts", () => {
      const sharedSignal = signal(1);
      const mockFn = vi.fn();

      const myEffect = effect(() => {
        const trackedRead = sharedSignal(); // This creates a dependency
        
        const untrackedRead = untracked(() => {
          return sharedSignal(); // This should NOT create an additional dependency
        });
        
        mockFn(trackedRead, untrackedRead);
      });

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenLastCalledWith(1, 1);

      // Signal change should still trigger the effect (due to tracked read)
      sharedSignal.set(5);
      expect(mockFn).toHaveBeenCalledTimes(2);
      expect(mockFn).toHaveBeenLastCalledWith(5, 5);

      myEffect.subscription.unsubscribe();
    });
  });
});
