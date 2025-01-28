import { describe, expect, it, vi } from 'vitest';
import { signal } from '../../packages/reactive/src';

describe('ObjectSubject', () => {
  it('should create an object signal', () => {
    const objectSignal = signal({ a: 1, b: 2 });
    objectSignal.observable.subscribe((change) => {
      expect(change).toEqual({ type: 'init', value: { a: 1, b: 2 } });
    });
  });

  it('should notify subscribers on property add', () => {
    const objectSignal = signal<any>({ a: 1 });
    const mockFn = vi.fn();

    objectSignal.observable.subscribe(mockFn);

    objectSignal.mutate(obj => obj.b = 2);

    expect(mockFn).toHaveBeenCalledWith({ type: 'add', key: 'b', value: 2 });
  });

  it('should notify subscribers on property update', () => {
    const objectSignal = signal({ a: 1 });
    const mockFn = vi.fn();

    objectSignal.observable.subscribe(mockFn);

    objectSignal.mutate(obj => obj.a = 2);

    expect(mockFn).toHaveBeenCalledWith({ type: 'update', key: 'a', value: 2 });
  });

  it('should notify subscribers on property delete', () => {
    const objectSignal = signal({ a: 1, b: 2 });
    const mockFn = vi.fn();

    objectSignal.observable.subscribe(mockFn);

    objectSignal.mutate(obj => delete obj.b);

    expect(mockFn).toHaveBeenCalledWith({ type: 'remove', key: 'b', value: 2 });
  });

  it('should notify subscribers on reset', () => {
    const objectSignal = signal<any>({ a: 1 });
    const mockFn = vi.fn();

    objectSignal.observable.subscribe(mockFn);

    objectSignal.set({ b: 2 });

    expect(mockFn).toHaveBeenCalledWith({ type: 'reset', value: { b: 2 } });
  });

  it('should freeze the signal', () => {
    const objectSignal = signal({ a: 1 });
    const mockFn = vi.fn();
    objectSignal.freeze();
    objectSignal.observable.subscribe(mockFn);
    objectSignal.mutate(obj => obj.a = 2);
    expect(mockFn).not.toHaveBeenCalled();
  });

  it('should unfreeze the signal', () => {
    const objectSignal = signal({ a: 1 });
    const mockFn = vi.fn();
    objectSignal.freeze();
    objectSignal.observable.subscribe(mockFn);
    objectSignal.unfreeze();
    expect(mockFn).toHaveBeenCalled();
  });
});
