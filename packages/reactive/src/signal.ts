import { BehaviorSubject, combineLatest, filter, finalize, map } from "rxjs";
import { ArraySubject } from "./ArraySubject";
import { ObjectSubject } from "./ObjectSubject";
import type { ComputedSignal, WritableArraySignal, WritableObjectSignal, WritableSignal } from "./types";

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
 * Creates a computed signal based on a compute function.
 * @template T The type of the computed value
 * @param {() => T} computeFunction The function to compute the value
 * @param {() => void} [disposableFn] Optional function to be called when the computed signal is disposed
 * @returns {ComputedSignal<T>} A computed signal
 */
export function computed<T = any>(computeFunction: () => T, disposableFn?: () => void): ComputedSignal<T> {
    const dependencies: Set<WritableSignal<any>> = new Set();
    let init = true;
    let lastComputedValue;
    
    // Sauvegarder l'état précédent
    const previousTracker = reactiveStore.currentDependencyTracker;
    
    // Définir notre tracker temporaire
    reactiveStore.currentDependencyTracker = (signal) => {
        dependencies.add(signal);
    };
    
    lastComputedValue = computeFunction();
    if (computeFunction['isEffect']) {
        disposableFn = lastComputedValue as any;
    }
    
    // Restaurer l'état précédent
    reactiveStore.currentDependencyTracker = previousTracker;
    
    // For computed signals without dependencies (primitive values), create a BehaviorSubject
    // that emits immediately, so combineLatest can work correctly
    const observables = [...dependencies].map(dep => {
        // Check if it's a computed signal without dependencies (primitive computed)
        if (isComputed(dep) && 'dependencies' in dep) {
            const computedDep = dep as unknown as ComputedSignal<any>;
            if (computedDep.dependencies.size === 0) {
                // Create a BehaviorSubject that emits the current value immediately
                return new BehaviorSubject(computedDep()).asObservable();
            }
        }
        // For regular signals or computed with dependencies, use their observable
        return dep.observable;
    });
    
    const computedObservable = combineLatest(observables)
        .pipe(
            filter(() => !init),
            map(() => computeFunction()),
            finalize(() => disposableFn?.())
        )

    const fn = function () {
        trackDependency(fn);
        return lastComputedValue;
    };

    fn.observable = computedObservable;

    fn.subscription = computedObservable.subscribe(value => {
        lastComputedValue = value;
    });

    fn.dependencies = dependencies;

    reactiveStore.currentSubscriptionsTracker?.(fn.subscription);

    init = false

    return fn
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