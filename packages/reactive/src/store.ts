import { Observable } from "rxjs";
import type { ArrayChange } from "./ArraySubject";
import type { ObjectChange } from "./ObjectSubject";

type Listener<E> = (event: E) => void;

interface ListenerEntry<E> {
    next: Listener<E>;
    complete?: () => void;
    active: boolean;
}

/** Errors thrown by a listener are reported asynchronously, like rxjs: other listeners still run. */
const reportError = (error: unknown) => {
    setTimeout(() => {
        throw error;
    });
};

/**
 * Holds the last event of a signal and notifies listeners synchronously, without rxjs.
 *
 * - `listen()` is the fast path used by computed, effects and `@signe/sync`: no replay.
 * - `toObservable()` gives a real rxjs Observable that, like the former `BehaviorSubject`,
 *   replays the last event on subscribe. It is only paid for by code that uses it.
 * - Events are not delivered while the owner signal is frozen (`owner._isFrozen`), but the
 *   last event is still recorded.
 * - Listeners added during an emission do not receive it; listeners removed during an
 *   emission are not called afterwards (same as rxjs subjects).
 */
export class SignalStore<E = any> {
    /** Last emitted event (or initial value): replayed to new observable subscribers. */
    last: E;
    /** Signal function that owns this store, read for `_isFrozen`. */
    owner: any = null;
    closed = false;
    // Adding a listener is O(1). emit() iterates a snapshot, copied at most once after each
    // change of the listener list (as rxjs subjects do), so many subscribers stay cheap.
    private listeners: ListenerEntry<E>[] = [];
    private snapshot: ListenerEntry<E>[] | null = null;

    constructor(initial: E) {
        this.last = initial;
    }

    /**
     * Subscribes to the next events (no replay). Returns a function that removes the listener.
     */
    listen(next: Listener<E>, complete?: () => void): () => void {
        if (this.closed) {
            complete?.();
            return noop;
        }
        const entry: ListenerEntry<E> = { next, complete, active: true };
        this.listeners.push(entry);
        this.snapshot = null;
        return () => {
            if (!entry.active) return;
            entry.active = false;
            const index = this.listeners.indexOf(entry);
            if (index !== -1) this.listeners.splice(index, 1);
            this.snapshot = null;
        };
    }

    emit(event: E): void {
        this.last = event;
        if (this.closed || this.owner?._isFrozen) return;
        const listeners = (this.snapshot ??= this.listeners.slice());
        for (let i = 0; i < listeners.length; i++) {
            const entry = listeners[i];
            if (!entry.active) continue;
            try {
                entry.next(event);
            } catch (error) {
                reportError(error);
            }
        }
    }

    /** Ends the stream: observable subscribers receive `complete`, listeners are dropped. */
    complete(): void {
        if (this.closed) return;
        this.closed = true;
        const listeners = this.listeners;
        this.listeners = [];
        this.snapshot = null;
        for (const entry of listeners) {
            if (!entry.active) continue;
            entry.active = false;
            try {
                entry.complete?.();
            } catch (error) {
                reportError(error);
            }
        }
    }

    /**
     * rxjs Observable view: registers the subscriber, then replays the last event
     * (unless the owner is frozen), like `BehaviorSubject`.
     */
    toObservable(): Observable<E> {
        return new Observable<E>((subscriber) => {
            const unsubscribe = this.listen(
                (event) => subscriber.next(event),
                () => subscriber.complete()
            );
            if (!this.closed && !this.owner?._isFrozen) {
                subscriber.next(this.last);
            }
            return unsubscribe;
        });
    }

    // --- Compatibility with the former rxjs subject exposed as `signal._subject` ---

    /** Current value for a primitive signal (last event). */
    get value(): E {
        return this.last;
    }

    next(event: E): void {
        this.emit(event);
    }

    subscribe(observerOrNext?: any) {
        return this.toObservable().subscribe(observerOrNext);
    }

    asObservable(): Observable<E> {
        return this.toObservable();
    }
}

function noop() {}

const MUTATING_ARRAY_METHODS = new Set<PropertyKey>(["push", "pop", "shift", "unshift", "splice"]);

/**
 * Store of an array signal. `items` is a proxy that emits `add` / `remove` / `update` events
 * for push, pop, shift, unshift, splice and index assignments, with the same events as
 * the former `ArraySubject`.
 *
 * Other array methods are not wrapped on every access: they are bound to the underlying
 * array once and cached, so reads like `items.map(...)` stay fast.
 */
export class ArraySignalStore<T = any> extends SignalStore<ArrayChange<T>> {
    _items: T[] = [];

    constructor(items: T[] = []) {
        super({ type: "init", items });
        this.createProxy(items);
    }

    private createProxy(items: T[]) {
        const methods = new Map<PropertyKey, Function>();
        this._items = new Proxy(items, {
            get: (target, prop, receiver) => {
                const value = Reflect.get(target, prop, receiver);
                if (typeof value !== "function") return value;
                let method = methods.get(prop);
                if (!method || (method as any).__original !== value) {
                    method = MUTATING_ARRAY_METHODS.has(prop)
                        ? this.wrapMutation(target, prop, value)
                        : value.bind(target);
                    (method as any).__original = value;
                    methods.set(prop, method);
                }
                return method;
            },
            set: (target, prop, value) => {
                const index = !isNaN(Number(prop)) ? Number(prop) : undefined;
                (target as any)[prop] = value;
                this.emit({ type: "update", index, items: [value] });
                return true;
            },
        });
    }

    private wrapMutation(target: T[], prop: PropertyKey, original: Function) {
        return (...args: any[]) => {
            let type: "add" | "remove" | "update" = "update";
            let index: number | undefined;
            let items: T[] = args;
            let emit = true;
            switch (prop) {
                case "push":
                    index = target.length;
                    type = "add";
                    break;
                case "pop":
                    index = target.length - 1;
                    type = "remove";
                    break;
                case "unshift":
                    index = 0;
                    type = "add";
                    break;
                case "shift":
                    index = 0;
                    type = "remove";
                    break;
                case "splice": {
                    index = args[0];
                    const deleteCount = args[1];
                    items = args.slice(2);
                    if (deleteCount > 0 && items.length === 0) type = "remove";
                    else if (deleteCount === 0 && items.length > 0) type = "add";
                    else if (deleteCount === 0 && items.length === 0) emit = false;
                    else type = "update";
                    break;
                }
            }
            const result = original.apply(target, args);
            if (emit) {
                this.emit({ type, index, items });
            }
            return result;
        };
    }

    get items(): T[] {
        return this._items;
    }

    set items(newItems: T[]) {
        this.createProxy(newItems);
        this.emit({ type: "reset", items: newItems });
    }
}

/**
 * Store of an object signal. `obj` is a proxy that emits `add` / `update` / `remove` events
 * for property assignments and deletions, with the same events as the former `ObjectSubject`.
 */
export class ObjectSignalStore<T extends Record<string, any> = any> extends SignalStore<ObjectChange<T>> {
    _obj!: T;

    constructor(obj: T = {} as T) {
        super({ type: "init", value: obj });
        this.createProxy(obj);
    }

    private createProxy(obj: T) {
        this._obj = new Proxy(obj, {
            set: (target, prop, value) => {
                const key = prop as keyof T;
                const type = key in target ? "update" : "add";
                target[key] = value;
                this.emit({ type, key, value });
                return true;
            },
            deleteProperty: (target, prop) => {
                const key = prop as keyof T;
                if (key in target) {
                    const value = target[key];
                    delete target[key];
                    this.emit({ type: "remove", key, value });
                    return true;
                }
                return false;
            },
        });
    }

    get obj(): T {
        return this._obj;
    }

    set obj(newObj: T) {
        this.createProxy(newObj);
        this.emit({ type: "reset", value: newObj });
    }
}

const LISTEN = Symbol.for("signe.reactive.listen");

/**
 * Subscribes to the changes of a signal (no replay of the current value) and returns a
 * function that unsubscribes.
 *
 * Uses the fast path of signals created by this version, and falls back to `signal.observable`
 * for other signals (for example `@signe/reactive` 2.x, loaded at the same time by CanvasEngine),
 * skipping the value it replays on subscribe.
 *
 * @example
 * const stop = subscribeToSignal(count, (value) => console.log(value));
 * count.set(1); // logs 1
 * stop();
 */
export function subscribeToSignal(signal: any, listener: (event: any) => void): () => void {
    const store: SignalStore | undefined = signal?.[LISTEN];
    if (store) {
        return store.listen(listener);
    }
    let replaying = true;
    const subscription = signal.observable.subscribe((event: any) => {
        if (replaying) return;
        listener(event);
    });
    replaying = false;
    return () => subscription.unsubscribe();
}

/**
 * Attaches a store to a signal function: fast-path marker, `observable`, and `_subject` for
 * writable signals (`load()` in `@signe/sync` uses `_subject` to recognize them).
 */
export function attachStore(fn: any, store: SignalStore, exposeSubject = true): void {
    store.owner = fn;
    fn[LISTEN] = store;
    fn.observable = store.toObservable();
    if (exposeSubject) {
        fn._subject = store;
    }
}
