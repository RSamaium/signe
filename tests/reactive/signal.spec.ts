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

  it('should not emit when setting the same primitive value', () => {
    const numSignal = signal(5);
    const observedValues: number[] = [];
    
    numSignal.observable.subscribe(value => {
      observedValues.push(value);
    });

    // Initial value is emitted
    expect(observedValues).toEqual([5]);
    
    // Set the same value
    numSignal.set(5);
    
    // Should not emit again
    expect(observedValues).toEqual([5]);
    
    // Set a different value to verify it works
    numSignal.set(10);
    expect(observedValues).toEqual([5, 10]);
  });

  it('should not recompute computed signal when dependency sets same value', () => {
    const numSignal = signal(5);
    const computeFn = vi.fn(() => numSignal() * 2);
    const computedSignal = computed(computeFn);
    
    // Initial computation
    expect(computedSignal()).toBe(10);
    expect(computeFn).toHaveBeenCalledTimes(1);
    
    // Set the same value
    numSignal.set(5);
    
    // Should not recompute
    expect(computeFn).toHaveBeenCalledTimes(1);
    expect(computedSignal()).toBe(10);
    
    // Set a different value to verify it works
    numSignal.set(6);
    expect(computeFn).toHaveBeenCalledTimes(2);
    expect(computedSignal()).toBe(12);
  });

  it('should use custom equality function for signal', () => {
    // Deep equality function similar to lodash.isEqual
    const deepEqual = (a: any, b: any): boolean => {
      if (a === b) return true;
      if (a == null || b == null) return false;
      if (typeof a !== 'object' || typeof b !== 'object') return false;
      
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      
      if (keysA.length !== keysB.length) return false;
      
      for (const key of keysA) {
        if (!keysB.includes(key)) return false;
        if (!deepEqual(a[key], b[key])) return false;
      }
      
      return true;
    };

    const arrayEqual = (a: any[], b: any[]): boolean => {
      if (a === b) return true;
      if (a.length !== b.length) return false;
      return a.every((item, index) => deepEqual(item, b[index]));
    };

    const arraySignal = signal(['test'], { equal: arrayEqual });
    const observedValues: any[] = [];
    
    arraySignal.observable.subscribe(value => {
      observedValues.push(value);
    });

    // Initial value is emitted
    expect(observedValues.length).toBeGreaterThan(0);
    const initialCount = observedValues.length;
    
    // Set array with same content but different reference
    arraySignal.set(['test']);
    
    // Should not emit because content is equal (deep comparison)
    expect(observedValues.length).toBe(initialCount);
    
    // Set array with different content
    arraySignal.set(['different']);
    expect(observedValues.length).toBe(initialCount + 1);
  });

  it('should use custom equality function for object signal', () => {
    // Deep equality function
    const deepEqual = (a: any, b: any): boolean => {
      if (a === b) return true;
      if (a == null || b == null) return false;
      if (typeof a !== 'object' || typeof b !== 'object') return false;
      
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      
      if (keysA.length !== keysB.length) return false;
      
      for (const key of keysA) {
        if (!keysB.includes(key)) return false;
        if (typeof a[key] === 'object' && a[key] !== null) {
          if (!deepEqual(a[key], b[key])) return false;
        } else if (a[key] !== b[key]) {
          return false;
        }
      }
      
      return true;
    };

    const objectSignal = signal({ a: 1, b: { c: 2 } }, { equal: deepEqual });
    const observedValues: any[] = [];
    
    objectSignal.observable.subscribe(value => {
      observedValues.push(value);
    });

    // Initial value is emitted
    expect(observedValues.length).toBeGreaterThan(0);
    const initialCount = observedValues.length;
    
    // Set object with same content but different reference
    objectSignal.set({ a: 1, b: { c: 2 } });
    
    // Should not emit because content is equal (deep comparison)
    expect(observedValues.length).toBe(initialCount);
    
    // Set object with different content
    objectSignal.set({ a: 1, b: { c: 3 } });
    expect(observedValues.length).toBe(initialCount + 1);
  });

  it('should use custom equality function for primitive signal', () => {
    // Custom equality that treats numbers within 0.1 as equal
    const approximateEqual = (a: number, b: number): boolean => {
      return Math.abs(a - b) < 0.1;
    };

    const numSignal = signal(5.0, { equal: approximateEqual });
    const observedValues: number[] = [];
    
    numSignal.observable.subscribe(value => {
      observedValues.push(value);
    });

    // Initial value is emitted
    expect(observedValues.length).toBeGreaterThan(0);
    const initialCount = observedValues.length;
    
    // Set value within tolerance
    numSignal.set(5.05);
    
    // Should not emit because values are approximately equal
    expect(observedValues.length).toBe(initialCount);
    
    // Set value outside tolerance
    numSignal.set(5.2);
    expect(observedValues.length).toBe(initialCount + 1);
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

  it("should create a computed with a primitive value", () => {
    const arraySignal = computed(() => [1, 2, 3]);
    expect(arraySignal()).toEqual([1, 2, 3]);
  });

  it("should create a computed with dependencies count", () => {
    const arraySignal = computed(() => [1, 2, 3]);
    expect(arraySignal.dependencies).toHaveLength(0);

    const arraySignal2 = signal([1, 2, 3]);
    const computedSignal = computed(() => arraySignal2());
    expect(computedSignal.dependencies).toHaveLength(1);
  });

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

  it("should subscribe to the simple computed (not contains any signal)", () => {
    const simpleComputed = computed(() => 2 * 2);
    expect(simpleComputed.dependencies).toHaveLength(0);
  });

  it("should recompute currentRadius twice when time signal changes twice", () => {
    const getBaseRadius = computed(() => 30);
    const getRadiusVariation = computed(() => 10);
    
    const time = signal(0);
    
    // Spy on the compute function to track recalculations
    const computeFn = vi.fn(() => {
      const t = time();
      const base = getBaseRadius();
      const variation = getRadiusVariation();
      return base + variation * Math.sin(t);
    });
    
    const currentRadius = computed(computeFn);
    
    // Initial call happens during computed creation
    expect(computeFn).toHaveBeenCalledTimes(1);
    
    // First time change
    time.set(1);
    // Wait for async updates (RxJS combineLatest)
    expect(computeFn).toHaveBeenCalledTimes(2);
    
    // Second time change
    time.set(2);
    expect(computeFn).toHaveBeenCalledTimes(3);
    
    // Verify the computed value is updated
    expect(currentRadius()).toBe(30 + 10 * Math.sin(2));
  });
});
