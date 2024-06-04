
import { Observable, Subscription } from 'rxjs';
import { ArrayChange, ArraySubject } from './ArraySubject';
import { ObjectChange, ObjectSubject } from "./ObjectSubject";

interface BaseWritableSignal<T = any> {
    (): T;
    set(value: T): void;
    mutate(mutateFn: (value: T) => void): void;
    update(updateFn: (value: T) => T): void;
    animate(value: T | ((currentValue: T) => T), options?: any): any;
}

export interface WritableSignal<T = any> extends BaseWritableSignal<T> {
    observable: Observable<T>;
}

export interface WritableArraySignal<T = any> extends BaseWritableSignal<T> {
    observable: Observable<ArrayChange<T>>;
    _subject: ArraySubject<T>;
}

export interface WritableObjectSignal<T = any> extends BaseWritableSignal<T> {
    observable: Observable<ObjectChange<T>>;
    _subject: ObjectSubject<any>;
}

export interface ComputedSignal<T = any> {
    (): T;
    observable: Observable<T>;
    subscription: Subscription;
}

export type Signal<T = any> = WritableSignal<T> | WritableArraySignal<T> | WritableObjectSignal<T> | ComputedSignal<T>;
export type Effect = ComputedSignal<void>;