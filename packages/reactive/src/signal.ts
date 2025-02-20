import { BehaviorSubject, combineLatest, filter, finalize, map } from "rxjs";
import { ArraySubject } from "./ArraySubject";
import { ObjectSubject } from "./ObjectSubject";
import type { ComputedSignal, WritableArraySignal, WritableObjectSignal, WritableSignal } from "./types";

let currentDependencyTracker: ((signal) => void) | null = null;
let currentSubscriptionsTracker: ((subscription) => void) | null = null;

const trackDependency = (signal) => {
    if (currentDependencyTracker) {
        currentDependencyTracker(signal);
    }
};

/**
 * Creates a reactive signal with the given default value.
 * @template T The type of the signal value
 * @param {T} defaultValue The initial value of the signal
 * @returns {WritableSignal<T> | WritableArraySignal<T> | WritableObjectSignal<T>} A writable signal
 */
export function signal<T extends any[]>(defaultValue: T): WritableArraySignal<T>;
export function signal<T extends Record<string, any>>(defaultValue: T): WritableObjectSignal<T>;
export function signal<T>(defaultValue: T): WritableSignal<T>;
export function signal<T = any>(
    defaultValue: T
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
        if (subject instanceof ArraySubject) {
            subject.items = value;
        } else if (subject instanceof ObjectSubject) {
            subject.obj = value;
        } else {
            subject.next(value);
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
 * Creates a computed signal based on a compute function.
 * @template T The type of the computed value
 * @param {() => T} computeFunction The function to compute the value
 * @param {() => void} [disposableFn] Optional function to be called when the computed signal is disposed
 * @returns {ComputedSignal<T>} A computed signal
 */
export function computed<T = any>(computeFunction: () => T, disposableFn?: () => void): ComputedSignal<T> {
    const dependencies: Set<WritableSignal<any>> = new Set();
    let init = true
    let lastComputedValue;

    currentDependencyTracker = (signal) => {
        dependencies.add(signal);
    };

    lastComputedValue = computeFunction();
    if (computeFunction['isEffect']) {
        disposableFn = lastComputedValue as any
    }

    currentDependencyTracker = null;

    const computedObservable = combineLatest([...dependencies].map(signal => signal.observable))
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

    fn.dependencies = dependencies

    currentSubscriptionsTracker?.(fn.subscription);

    init = false

    return fn
}
