import { Subscription } from "rxjs";
import {
    ArraySignalStore,
    ObjectSignalStore,
    SignalStore,
    attachStore,
    createSignalFunction,
    WritableSignalPrototype,
    ComputedSignalPrototype,
    type ListenerEntry,
    getSignalStore,
    subscribeToSignal,
} from "./store";
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

/**
 * Batching state lives in the global store so that every copy of this version shares it.
 * Older versions ignore these fields.
 */
/** Pending updates: objects with an `update()` method (one entry per tracker). */
const getBatchQueue = (): Set<{ update(): void }> => (reactiveStore.batchQueue ??= new Set());
const isBatching = () => (reactiveStore.batchDepth ?? 0) > 0;

const reportBatchError = (error: unknown) => {
    setTimeout(() => {
        throw error;
    });
};

/**
 * Runs the queued computed and effect updates once each. Updates queued while flushing
 * (a computed that changed during the flush) are run in the same flush.
 */
function flushBatchQueue() {
    if (reactiveStore.batchFlushing) return;
    const queue = getBatchQueue();
    if (queue.size === 0) return;
    reactiveStore.batchFlushing = true;
    try {
        while (queue.size > 0) {
            const pending = queue.values().next().value as { update(): void };
            queue.delete(pending);
            try {
                pending.update();
            } catch (error) {
                reportBatchError(error);
            }
        }
    } finally {
        reactiveStore.batchFlushing = false;
    }
}

/**
 * Groups signal writes: computed signals and effects that depend on several of the written
 * signals are updated once, at the end of the batch, instead of once per write.
 *
 * - Change events (`signal.observable`, `subscribeToSignal`) are still delivered at each write.
 * - Reading a computed signal inside the batch first runs the pending updates, so it never
 *   returns a stale value.
 * - Batches can be nested; updates run when the outermost batch ends.
 *
 * @param fn - Function that writes signals.
 * @returns The value returned by `fn`.
 *
 * @example
 * const x = signal(0), y = signal(0);
 * effect(() => render(x(), y()));
 * batch(() => {
 *   x.set(10);
 *   y.set(20);
 * }); // render runs once, with (10, 20)
 */
export function batch<T>(fn: () => T): T {
    reactiveStore.batchDepth = (reactiveStore.batchDepth ?? 0) + 1;
    try {
        return fn();
    } finally {
        try {
            // Still inside the batch while flushing: updates triggered by the flush are queued
            // and run once in this same flush.
            if (reactiveStore.batchDepth === 1) flushBatchQueue();
        } finally {
            reactiveStore.batchDepth--;
        }
    }
}

/** Before reading a computed value inside a batch, apply the pending updates. */
const flushBeforeRead = () => {
    if (isBatching() && !reactiveStore.batchFlushing) flushBatchQueue();
};

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
    
    // Plain stores instead of rxjs subjects: notifications do not go through rxjs.
    // `signal.observable` stays a real rxjs Observable (see SignalStore.toObservable).
    let store: SignalStore<any>;
    if (Array.isArray(defaultValue)) {
        store = new ArraySignalStore(defaultValue);
    } else if (typeof defaultValue === 'object' && defaultValue !== null) {
        store = new ObjectSignalStore(defaultValue as any);
    } else {
        store = new SignalStore(defaultValue);
    }
    if (options?.equal) {
        store.equal = options.equal;
    }

    // set / update / mutate / freeze / unfreeze / observable / _subject / _isFrozen come from
    // a shared prototype: created on first access, bound to this signal, then reused.
    return createSignalFunction(readWritableSignal, store) as any;
}

/** Body of every writable signal, bound to its store (see createSignalFunction). */
function readWritableSignal(this: SignalStore<any>) {
    trackDependency(this.owner);
    return this.read();
}
Object.setPrototypeOf(readWritableSignal, WritableSignalPrototype);

/**
 * Checks if a value is a signal.
 * @param {any} value The value to check
 * @returns {boolean} True if the value is a signal, false otherwise
 */
export function isSignal(value: any): boolean {
    // Signals of this version are recognized without creating their rxjs view
    return !!value && (getSignalStore(value) !== undefined || !!value.observable);
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
interface TrackedDependency {
    /** Last run that read this dependency. */
    epoch: number;
    /** Signals of this version: listener entry in their store (no closure per dependency). */
    store?: SignalStore<any>;
    listener?: ListenerEntry<any>;
    /** Other signals (2.x): unsubscribe from their observable. */
    unsubscribe?: () => void;
}

/** Something to run again when a dependency changes. */
interface Recomputable {
    recompute(): void;
}

/** Tracker of the computed or effect currently running (read by `trackActive`). */
let activeTracker: DependencyTracker | null = null;
/** Installed as the global dependency tracker while a computed runs. */
const trackActive = (signal: WritableSignal<any>) => {
    activeTracker?.track(signal);
};

/**
 * Collects the signals read by a function on every run and keeps one subscription per
 * dependency: new reads are subscribed to, signals no longer read are unsubscribed from.
 * `onChange` runs when a tracked signal emits. A change emitted while the function is
 * running (e.g. it writes a signal it reads) triggers one more `onChange` afterwards.
 *
 * A class (methods shared by all trackers) rather than closures: computed signals are
 * created in large numbers and each closure costs memory.
 */
class DependencyTracker {
    /** Same Set instance for the whole lifetime: it is exposed as `fn.dependencies`. */
    readonly dependencies: Set<WritableSignal<any>> = new Set();
    private readonly entries = new Map<WritableSignal<any>, TrackedDependency>();
    private epoch = 0;
    private reusedCount = 0;
    /** Signals read for the first time during the current run (allocated when needed, then dropped). */
    private newDependencies: Set<WritableSignal<any>> | null = null;
    private running = false;
    private rerunRequested = false;
    private disposed = false;
    /** Listener given to dependencies (the only closure of a tracker). */
    readonly handleChange: () => void;

    constructor(private readonly owner: any, private readonly target: Recomputable) {
        this.handleChange = () => this.onDependencyChange();
    }

    private onDependencyChange() {
        if (this.disposed) return;
        if (this.running) {
            this.rerunRequested = true;
            return;
        }
        if (isBatching()) {
            // Run once when the batch ends (a Set keeps a single entry per tracker)
            getBatchQueue().add(this);
            return;
        }
        this.update();
    }

    update() {
        if (this.disposed) return;
        do {
            this.rerunRequested = false;
            this.target.recompute();
        } while (this.rerunRequested && !this.disposed);
    }

    track(signal: WritableSignal<any>) {
        if (signal === this.owner) return;
        const entry = this.entries.get(signal);
        if (entry) {
            if (entry.epoch !== this.epoch) {
                entry.epoch = this.epoch;
                this.reusedCount++;
            }
        } else {
            (this.newDependencies ??= new Set()).add(signal);
        }
    }

    run<T>(compute: () => T): T {
        this.epoch++;
        this.reusedCount = 0;
        this.newDependencies = null;
        const previousTracker = reactiveStore.currentDependencyTracker;
        const previousActive = activeTracker;
        reactiveStore.currentDependencyTracker = trackActive;
        activeTracker = this;
        this.running = true;
        let value: T;
        try {
            value = compute();
        } finally {
            this.running = false;
            activeTracker = previousActive;
            reactiveStore.currentDependencyTracker = previousTracker;
        }
        if (this.disposed) return value;

        const { entries, dependencies, epoch } = this;
        // Signals not read during this run
        if (this.reusedCount !== entries.size) {
            for (const [dependency, entry] of entries) {
                if (entry.epoch !== epoch) {
                    releaseDependency(entry);
                    entries.delete(dependency);
                    dependencies.delete(dependency);
                }
            }
        }
        // Signals read for the first time
        const newDependencies = this.newDependencies;
        if (newDependencies) {
            this.newDependencies = null;
            for (const dependency of newDependencies) {
                entries.set(dependency, subscribeDependency(dependency, this.handleChange, epoch));
                dependencies.add(dependency);
            }
        }
        return value;
    }

    dispose() {
        this.disposed = true;
        for (const entry of this.entries.values()) {
            releaseDependency(entry);
        }
        this.entries.clear();
    }
}

/** Fast path for signals of this version, `observable` for others (2.x). */
function subscribeDependency(dependency: any, listener: () => void, epoch: number): TrackedDependency {
    const store = getSignalStore(dependency);
    if (store) {
        return { epoch, store, listener: store.addListener(listener) };
    }
    return { epoch, unsubscribe: subscribeToSignal(dependency, listener) };
}

function releaseDependency(entry: TrackedDependency) {
    if (entry.store) {
        entry.store.removeListener(entry.listener!);
    } else {
        entry.unsubscribe?.();
    }
}

function createDependencyTracker(owner: any, onChange: () => void): DependencyTracker {
    return new DependencyTracker(owner, { recompute: onChange });
}

/**
 * Store of a computed signal: holds the compute function, its tracker and the dispose logic,
 * so that a computed needs no closure besides its own function.
 */
class ComputedStore<T> extends SignalStore<T> implements Recomputable {
    tracker!: DependencyTracker;
    disposable: (() => void) | undefined;
    private subscription: Subscription | undefined = undefined;

    constructor(private readonly compute: () => T, disposable?: () => void) {
        super(undefined as T);
        this.disposable = disposable;
    }

    recompute() {
        this.emit(this.tracker.run(this.compute));
    }

    /** `computed.subscription`, created on first use: unsubscribing disposes the computed. */
    getSubscription(): Subscription {
        return (this.subscription ??= new Subscription(() => {
            this.tracker.dispose();
            this.complete();
            this.disposable?.();
        }));
    }
}

/**
 * Creates a computed signal based on a compute function.
 * @template T The type of the computed value
 * @param {() => T} computeFunction The function to compute the value
 * @param {() => void} [disposableFn] Optional function to be called when the computed signal is disposed
 * @returns {ComputedSignal<T>} A computed signal
 */
/** Body of every computed signal, bound to its store (see createSignalFunction). */
function readComputedSignal(this: SignalStore<any>) {
    trackDependency(this.owner);
    flushBeforeRead();
    return this.last;
}
Object.setPrototypeOf(readComputedSignal, ComputedSignalPrototype);

export function computed<T = any>(computeFunction: () => T, disposableFn?: () => void): ComputedSignal<T> {
    const store = new ComputedStore<T>(computeFunction, disposableFn);
    const fn: any = createSignalFunction(readComputedSignal, store);

    store.tracker = new DependencyTracker(fn, store);
    store.last = store.tracker.run(computeFunction);
    if (computeFunction['isEffect']) {
        store.disposable = store.last as any;
    }

    // A computed is read-only: no `_subject`, as before. `observable` and `subscription`
    // are created on first use (shared prototype).
    fn.dependencies = store.tracker.dependencies;

    const subscriptionsTracker = reactiveStore.currentSubscriptionsTracker;
    if (subscriptionsTracker) {
        subscriptionsTracker(fn.subscription);
    }

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
        flushBeforeRead();

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
        store.emit(lastComputedValue);
    });
    const dependencies = tracker.dependencies;

    lastComputedValue = tracker.run(computeFunction);
    lastComputedBeforeOverride = lastComputedValue;

    // Holds the current value (computed or overridden) and is shared by all subscribers
    const store = new SignalStore<TValue>(lastComputedValue);
    attachStore(fn, store);

    fn.subscription = new Subscription(() => {
        tracker.dispose();
        store.complete();
    });

    fn.dependencies = dependencies;

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
        store.emit(value);
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