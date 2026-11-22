import { BehaviorSubject, filter, Subscription } from "rxjs";
import { ArraySubject } from "./ArraySubject";
import { ObjectSubject } from "./ObjectSubject";
import type { ComputedSignal, Signal, WritableArraySignal, WritableObjectSignal, WritableSignal } from "./types";

/**
 * Creates a global store that works across all JavaScript environments
 * @returns The global reactive store singleton
 * 
 * @example
 * const store = getGlobalReactiveStore();
 * store.currentDependencyTracker = myTrackerFunction;
 */
const getGlobalReactiveStore = () => {
  const globalKey = '__REACTIVE_STORE__';
  
  // Use globalThis (ES2020) which is supported in modern environments
  // including browsers, Node.js and Edge environments
  if (typeof globalThis !== 'undefined') {
    if (!globalThis[globalKey]) {
      globalThis[globalKey] = {
        currentDependencyTracker: null,
        currentSubscriptionsTracker: null
      };
    }
    return globalThis[globalKey];
  }
  
  // Fallback for older environments
  let globalObj: any;
  
  // Browser
  if (typeof window !== 'undefined') {
    globalObj = window;
  } 
  // Node.js - avoid using 'global' directly to prevent type errors
  else if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    // In Node.js, 'global' is equivalent to globalThis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalObj = (Function('return this')()) as any;
  }
  // Web Worker or other environments
  else if (typeof self !== 'undefined') {
    globalObj = self;
  }
  // Really unusual environment
  else {
    // Create a local object as a last resort
    // This will work in the current context but will not be shared
    console.warn('Unable to find global object, using local instance');
    return {
      currentDependencyTracker: null,
      currentSubscriptionsTracker: null
    };
  }
  
  if (!globalObj[globalKey]) {
    globalObj[globalKey] = {
      currentDependencyTracker: null,
      currentSubscriptionsTracker: null
    };
  }
  
  return globalObj[globalKey];
};

// Get the global store only once
const reactiveStore = getGlobalReactiveStore();

// Replace module global variables with store access
const trackDependency = (signal) => {
  if (reactiveStore.currentDependencyTracker) {
    reactiveStore.currentDependencyTracker(signal);
  }
};

/**
 * Options for creating a signal
 * @template T The type of the signal value
 */
export interface SignalOptions<T> {
    /**
     * Equality function to determine if two values are equal.
     * If not provided, default comparison logic is used.
     * @param a The current value
     * @param b The new value
     * @returns True if values are equal, false otherwise
     * 
     * @example
     * import _ from 'lodash';
     * const data = signal(['test'], { equal: _.isEqual });
     */
    equal?: (a: T, b: T) => boolean;
}

/**
 * Creates a reactive signal with the given default value.
 * @template T The type of the signal value
 * @param {T} defaultValue The initial value of the signal
 * @param {SignalOptions<T>} [options] Optional configuration for the signal
 * @returns {WritableSignal<T> | WritableArraySignal<T> | WritableObjectSignal<T>} A writable signal
 * 
 * @example
 * // Basic usage
 * const count = signal(0);
 * 
 * @example
 * // With custom equality function
 * import _ from 'lodash';
 * const data = signal(['test'], { equal: _.isEqual });
 */
export function signal<T extends any[]>(defaultValue: T, options?: SignalOptions<T>): WritableArraySignal<T>;
export function signal<T extends Record<string, any>>(defaultValue: T, options?: SignalOptions<T>): WritableObjectSignal<T>;
export function signal<T>(defaultValue: T, options?: SignalOptions<T>): WritableSignal<T>;
export function signal<T = any>(
    defaultValue: T,
    options?: SignalOptions<T>
): T extends Array<any> ? WritableArraySignal<T> :
    T extends Record<string, any> ? WritableObjectSignal<T> :
    WritableSignal<T> {
    
    let subject;
    if (Array.isArray(defaultValue)) {
        subject = new ArraySubject(defaultValue);
    } else if (typeof defaultValue === 'object' && defaultValue !== null) {
        subject = new ObjectSubject(defaultValue);
    } else {
        subject = new BehaviorSubject(defaultValue);
    }

    const getValue = () => {
        if (subject instanceof ArraySubject) {
            return subject.items;
        } else if (subject instanceof ObjectSubject) {
            return subject.obj;
        }
        return subject.value;
    };

    const fn: any = function () {
        trackDependency(fn);
        return getValue();
    };

    fn.set = (value) => {
        const currentValue = getValue();
        
        // Use custom equality function if provided
        let shouldEmit = true;
        if (options?.equal) {
            // If equal returns true, values are equal, don't emit
            // If equal returns false, values are different, emit
            shouldEmit = !options.equal(currentValue, value);
        } else {
            shouldEmit = currentValue !== value;
        }
        
        // Emit only if values are different
        if (shouldEmit) {
            if (subject instanceof ArraySubject) {
                subject.items = value;
            } else if (subject instanceof ObjectSubject) {
                subject.obj = value;
            } else {
                subject.next(value);
            }
        }
    };

    fn._isFrozen = false;

    fn.freeze = () => {
        fn._isFrozen = true;
    };

    fn.unfreeze = () => {
        fn._isFrozen = false;
        if (subject instanceof ArraySubject) {
            subject.next({ type: 'init', items: subject.items });
        } else if (subject instanceof ObjectSubject) {
            subject.next({ type: 'init', value: subject.obj });
        } else {
            subject.next(subject.value);
        }
    };

    fn.mutate = (mutateFn) => {
        const value = getValue();
        mutateFn(value);
    };

    fn.update = (updateFn) => {
        const updatedValue = updateFn(getValue());
        fn.set(updatedValue);
    };

    fn.observable = subject.asObservable().pipe(
        filter(() => !fn._isFrozen)
    );
    fn._subject = subject;

    return fn as any;
}

/**
 * Checks if a value is a signal.
 * @param {any} value The value to check
 * @returns {boolean} True if the value is a signal, false otherwise
 */
export function isSignal(value: any): boolean {
    return !!(value && value.observable)
}

/**
 * Checks if a value is a computed signal.
 * @param {any} value The value to check
 * @returns {boolean} True if the value is a computed signal, false otherwise
 */
export function isComputed(value: any): boolean {
    return isSignal(value) && !!value.dependencies;
}

/**
 * Collects the signals read by a function on every run and keeps one subscription per
 * dependency: new reads are subscribed to, signals no longer read are unsubscribed from.
 * `onChange` runs when a tracked signal emits. A change emitted while the function is
 * running (e.g. it writes a signal it reads) triggers one more `onChange` afterwards.
 */
function createDependencyTracker(owner: any, onChange: () => void) {
    // Same Set instance for the whole lifetime: it is exposed as `fn.dependencies`.
    const dependencies: Set<WritableSignal<any>> = new Set();
    const subscriptions = new Map<WritableSignal<any>, Subscription>();
    // Signal observables emit their current value on subscribe: ignore it.
    let subscribing = false;
    let running = false;
    let rerunRequested = false;
    let disposed = false;

    const handleChange = () => {
        if (subscribing || disposed) return;
        if (running) {
            rerunRequested = true;
            return;
        }
        do {
            rerunRequested = false;
            onChange();
        } while (rerunRequested && !disposed);
    };

    const run = <T>(compute: () => T): T => {
        const nextDependencies: Set<WritableSignal<any>> = new Set();
        const previousTracker = reactiveStore.currentDependencyTracker;
        reactiveStore.currentDependencyTracker = (signal) => {
            if (signal !== owner) nextDependencies.add(signal);
        };
        running = true;
        let value: T;
        try {
            value = compute();
        } finally {
            running = false;
            reactiveStore.currentDependencyTracker = previousTracker;
        }
        if (disposed) return value;

        for (const [dependency, subscription] of subscriptions) {
            if (!nextDependencies.has(dependency)) {
                subscription.unsubscribe();
                subscriptions.delete(dependency);
            }
        }
        subscribing = true;
        try {
            for (const dependency of nextDependencies) {
                if (!subscriptions.has(dependency)) {
                    subscriptions.set(dependency, dependency.observable.subscribe(handleChange));
                }
            }
        } finally {
            subscribing = false;
        }

        dependencies.clear();
        for (const dependency of nextDependencies) {
            dependencies.add(dependency);
        }
        return value;
    };

    const dispose = () => {
        disposed = true;
        for (const subscription of subscriptions.values()) {
            subscription.unsubscribe();
        }
        subscriptions.clear();
    };

    return { dependencies, run, dispose };
}

/**
 * Creates a computed signal based on a compute function.
 * @template T The type of the computed value
 * @param {() => T} computeFunction The function to compute the value
 * @param {() => void} [disposableFn] Optional function to be called when the computed signal is disposed
 * @returns {ComputedSignal<T>} A computed signal
 */
export function computed<T = any>(computeFunction: () => T, disposableFn?: () => void): ComputedSignal<T> {
    let lastComputedValue: T;

    const fn: any = function () {
        trackDependency(fn);
        return lastComputedValue;
    };

    const subject = new BehaviorSubject<T>(undefined as T);
    const tracker = createDependencyTracker(fn, () => {
        lastComputedValue = tracker.run(computeFunction);
        subject.next(lastComputedValue);
    });

    lastComputedValue = tracker.run(computeFunction);
    if (computeFunction['isEffect']) {
        disposableFn = lastComputedValue as any;
    }
    subject.next(lastComputedValue);

    fn.observable = subject.asObservable();
    fn.dependencies = tracker.dependencies;
    fn.subscription = new Subscription(() => {
        tracker.dispose();
        subject.complete();
        disposableFn?.();
    });

    reactiveStore.currentSubscriptionsTracker?.(fn.subscription);

    return fn
}

/**
 * Previous values object passed to computation function.
 * @template TSource The type of the source signal value
 * @template TValue The type of the linked signal value
 */
export interface LinkedSignalPrevious<TSource, TValue> {
    /**
     * The previous value of the source signal.
     */
    source: TSource;
    /**
     * The previous value of the linked signal.
     */
    value: TValue;
}

/**
 * Options for creating a linked signal with source and computation.
 * @template TSource The type of the source signal value
 * @template TValue The type of the linked signal value
 */
export interface LinkedSignalOptions<TSource, TValue> {
    /**
     * Source signal or function that returns the source value.
     * The linked signal will update when this source changes.
     */
    source: Signal<TSource> | (() => TSource);
    /**
     * Computation function that transforms the source value.
     * @param {TSource} value - The new value from the source
     * @param {LinkedSignalPrevious<TSource, TValue>} [previous] - Previous values (only available when generic types are explicitly provided)
     * @returns {TValue} The computed value
     */
    computation: (value: TSource, previous?: LinkedSignalPrevious<TSource, TValue>) => TValue;
    /**
     * Optional equality function to determine if the computed value changed.
     * @param {TValue} a - The current value
     * @param {TValue} b - The new value
     * @returns {boolean} True if values are equal, false otherwise
     */
    equal?: (a: TValue, b: TValue) => boolean;
}

/**
 * Options for creating a linked signal with just a computation function.
 * @template T The type of the linked signal value
 */
export interface LinkedSignalSimpleOptions<T> {
    /**
     * Optional equality function to determine if the computed value changed.
     * @param {T} a - The current value
     * @param {T} b - The new value
     * @returns {boolean} True if values are equal, false otherwise
     */
    equal?: (a: T, b: T) => boolean;
}

/**
 * Linked signal interface that extends ComputedSignal with setter support.
 * @template T The type of the signal value
 */
export interface LinkedSignal<T = any> extends ComputedSignal<T> {
    /**
     * Sets the linked signal value, overriding the computed value.
     * @param {T} value - The new value to set
     */
    set(value: T): void;
}

/**
 * Creates a linked signal that depends on other signals.
 * 
 * A linked signal is a computed signal that automatically updates when its source changes.
 * It supports two usage patterns:
 * 
 * 1. **Simple computation**: `linkedSignal(() => source() * 2)` - can be overridden with `set()`
 * 2. **Source + Computation**: `linkedSignal({ source: () => count(), computation: (value) => value * 2 })`
 * 
 * @template T The type of the linked signal value
 * @param {() => T} computation - Computation function that returns the linked signal value
 * @param {LinkedSignalSimpleOptions<T>} [options] - Optional configuration including equality function
 * @returns {LinkedSignal<T>} A linked signal with read and write access
 * 
 * @example
 * // Simple computation
 * const source = signal(0);
 * const linked = linkedSignal(() => source() * 2);
 * console.log(linked()); // 0
 * source.set(3);
 * console.log(linked()); // 6
 * linked.set(100); // Override the computed value
 * console.log(linked()); // 100
 * 
 * @example
 * // With custom equality
 * const activeUser = signal({id: 123, name: 'Morgan'});
 * const activeUserEditCopy = linkedSignal(() => activeUser(), {
 *   equal: (a, b) => a.id === b.id,
 * });
 */
export function linkedSignal<T>(computation: () => T, options?: LinkedSignalSimpleOptions<T>): LinkedSignal<T>;
/**
 * Creates a linked signal with separate source and computation.
 * 
 * @template TSource The type of the source signal value
 * @template TValue The type of the linked signal value
 * @param {LinkedSignalOptions<TSource, TValue>} options - Options with source and computation
 * @returns {LinkedSignal<TValue>} A linked signal with read and write access
 * 
 * @example
 * // Source + Computation
 * const count = signal(0);
 * const double = linkedSignal({
 *   source: () => count(),
 *   computation: (value) => value * 2
 * });
 * console.log(double()); // 0
 * count.set(5);
 * console.log(double()); // 10
 * double.set(50); // Override the computed value
 * console.log(double()); // 50
 * 
 * @example
 * // With previous values
 * linkedSignal<ShippingMethod[], ShippingMethod>({
 *   source: this.shippingOptions,
 *   computation: (newOptions, previous) => {
 *     return newOptions.find((opt) => opt.id === previous?.value.id) ?? newOptions[0];
 *   },
 * });
 */
export function linkedSignal<TSource, TValue>(options: LinkedSignalOptions<TSource, TValue>): LinkedSignal<TValue>;
export function linkedSignal<TSource, TValue>(
    computationOrOptions: (() => TValue) | LinkedSignalOptions<TSource, TValue>,
    simpleOptions?: LinkedSignalSimpleOptions<TValue>
): LinkedSignal<TValue> {
    let lastComputedValue: TValue;
    let computeFunction: () => TValue;
    let sourceSignal: Signal<TSource> | (() => TSource) | undefined;
    let computationFn: ((value: TSource, previous?: LinkedSignalPrevious<TSource, TValue>) => TValue) | undefined;
    let equalFn: ((a: TValue, b: TValue) => boolean) | undefined;
    let previousValue: LinkedSignalPrevious<TSource, TValue> | undefined;
    let isOverridden = false;
    let overriddenValue: TValue | undefined;
    let lastComputedBeforeOverride: TValue | undefined;
    // Track dependency versions to know when to drop an override
    let depVersion = 0;
    let overrideDepVersion: number | null = null;

    // Determine the mode
    if (typeof computationOrOptions === 'function') {
        // Simple mode: just a computation function
        computeFunction = computationOrOptions as () => TValue;
        equalFn = simpleOptions?.equal;
    } else {
        // Source + Computation mode
        const options = computationOrOptions as LinkedSignalOptions<TSource, TValue>;
        sourceSignal = options.source;
        computationFn = options.computation;
        equalFn = options.equal;

        // Create compute function that uses source and computation
        if (typeof sourceSignal === 'function' && !isSignal(sourceSignal)) {
            // source is a function, not a signal
            const sourceFn = sourceSignal as () => TSource;
            computeFunction = () => {
                const sourceValue = sourceFn();
                if (computationFn!.length > 1) {
                    // Computation accepts previous parameter
                    const result = computationFn!(sourceValue, previousValue);
                    previousValue = {
                        source: sourceValue,
                        value: result
                    };
                    return result;
                } else {
                    const result = computationFn!(sourceValue);
                    previousValue = {
                        source: sourceValue,
                        value: result
                    };
                    return result;
                }
            };
        } else {
            // source is a signal
            const source = typeof sourceSignal === 'function' ? sourceSignal as Signal<TSource> : sourceSignal;
            computeFunction = () => {
                const sourceValue = source();
                if (computationFn!.length > 1) {
                    // Computation accepts previous parameter
                    const result = computationFn!(sourceValue, previousValue);
                    previousValue = {
                        source: sourceValue,
                        value: result
                    };
                    return result;
                } else {
                    const result = computationFn!(sourceValue);
                    previousValue = {
                        source: sourceValue,
                        value: result
                    };
                    return result;
                }
            };
        }
    }

    const fn: any = function () {
        trackDependency(fn);

        // If we have an override and dependencies, check whether sources changed (using depVersion)
        if (isOverridden && dependencies.size > 0) {
            if (overrideDepVersion !== depVersion) {
                // Sources changed since the override -> recompute and drop override
                const computed = tracker.run(computeFunction);
                isOverridden = false;
                overriddenValue = undefined;
                lastComputedValue = computed;
                lastComputedBeforeOverride = computed;
                overrideDepVersion = null;
                return computed;
            }
            // Sources unchanged, keep override
            return overriddenValue!;
        }

        // If overridden and no dependencies, simply return the overridden value
        if (isOverridden) {
            return overriddenValue!;
        }

        // If there are no dependencies, recompute the value on each read
        // This ensures that external values updated are reflected
        if (dependencies.size === 0) {
            const computed = tracker.run(computeFunction);
            lastComputedValue = computed;
            lastComputedBeforeOverride = computed;
        }
        return lastComputedValue;
    };

    // A tracked signal changed: recompute (dependencies are collected again) and drop any override
    const tracker = createDependencyTracker(fn, () => {
        const computed = tracker.run(computeFunction);
        const changed = equalFn ? !equalFn(lastComputedValue, computed) : lastComputedValue !== computed;
        if (changed) {
            lastComputedValue = computed;
        }
        depVersion++;
        isOverridden = false;
        overriddenValue = undefined;
        overrideDepVersion = null;
        lastComputedBeforeOverride = lastComputedValue;
        subject.next(lastComputedValue);
    });
    const dependencies = tracker.dependencies;

    lastComputedValue = tracker.run(computeFunction);
    lastComputedBeforeOverride = lastComputedValue;

    // Holds the current value (computed or overridden) and is shared by all subscribers
    const subject = new BehaviorSubject<TValue>(lastComputedValue);

    fn.observable = subject.asObservable();
    fn.subscription = new Subscription(() => {
        tracker.dispose();
        subject.complete();
    });

    fn.dependencies = dependencies;
    fn._subject = subject;

    // Always add setter to allow overriding the computed value
    fn.set = (value: TValue) => {
        // Store the current computed value before override (only if not already overridden)
        if (!isOverridden) {
            lastComputedBeforeOverride = lastComputedValue;
            overrideDepVersion = depVersion;
            // Update previousValue to reflect the manual override so future computations use it
            if (computationFn && sourceSignal) {
                const sourceValue = untracked(() => {
                    if (typeof sourceSignal === 'function') {
                        const source = sourceSignal as any;
                        return isSignal(source) ? source() : (sourceSignal as () => TSource)();
                    }
                    return (sourceSignal as Signal<TSource>)();
                });
                previousValue = {
                    source: sourceValue as TSource,
                    value
                };
            }
        }
        isOverridden = true;
        overriddenValue = value;
        lastComputedValue = value;
        subject.next(value);
    };

    reactiveStore.currentSubscriptionsTracker?.(fn.subscription);

    return fn as LinkedSignal<TValue>;
}

/**
 * Execute a function without tracking reactive dependencies.
 * @template T
 * @param {() => T} fn - The function to execute without tracking.
 * @returns {T} The return value of the executed function.
 */
export function untracked<T>(fn: () => T): T {
    const prevDepTracker = reactiveStore.currentDependencyTracker;
    const prevSubTracker = reactiveStore.currentSubscriptionsTracker;
    reactiveStore.currentDependencyTracker = null;
    reactiveStore.currentSubscriptionsTracker = null;
    try {
        return fn();
    } finally {
        reactiveStore.currentDependencyTracker = prevDepTracker;
        reactiveStore.currentSubscriptionsTracker = prevSubTracker;
    }
}