---
"@signe/reactive": minor
"@signe/sync": patch
---

Signals no longer use rxjs subjects to notify computed signals, effects and `@signe/sync`.

- Each signal keeps its last event in a light store (`SignalStore`, `ArraySignalStore`, `ObjectSignalStore`) and notifies listeners synchronously. Listeners added or removed during a notification, and errors thrown by a listener (reported asynchronously, other listeners still run), behave as with rxjs subjects.
- `signal.observable` is still a real rxjs `Observable` with the same events and the same replay on subscribe, so `pipe`, `combineLatest` and `Subscription` keep working. `freeze` / `unfreeze`, detached methods and `computed.subscription` are unchanged.
- `signal._subject` is now the store. It keeps `value`, `items` / `_items`, `obj` / `_obj`, `next()`, `subscribe()` and `asObservable()`; its TypeScript type changes from `ArraySubject` / `ObjectSubject` to `ArraySignalStore` / `ObjectSignalStore`. `ArraySubject` and `ObjectSubject` are still exported.
- Non-mutating array methods are bound once instead of being wrapped on every access.
- New `subscribeToSignal(signal, listener)`: subscribes without rxjs and without replay; falls back to `observable` for signals of `@signe/reactive` 2.x. `@signe/sync` uses it.

Measured against the previous version (median of alternating runs): one write through a computed and an effect 2.1x faster, diamond 1.9x, fan-out of 1000 computed 2.0x, dynamic dependencies 3.4x; memory per signal 1,026 → 754 bytes. With the sync optimizations of #37, a 100-player server tick goes from ~0.28 ms to ~0.21 ms (Colyseus: ~0.15 ms).
