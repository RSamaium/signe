import { combineLatest, filter, finalize, map } from "rxjs";
import { ComputedSignal, WritableSignal } from "./types";

let currentSubscriptionsTracker: ((subscription) => void) | null = null;

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

    currentSubscriptionsTracker?.(fn.subscription);

    init = false

    return fn
}