# @signe/reactive

## 3.2.0

### Minor Changes

- 4a21285: Faster client updates:

  - `@signe/reactive`: new `batch(fn)`. Computed signals and effects that depend on several signals written in the batch update once, when the batch ends. Change events (`observable`, `subscribeToSignal`) are still delivered at each write; reading a computed inside a batch applies pending updates first, so values are never stale; nested batches flush at the outermost one, also when `fn` throws.
  - `@signe/sync`: `load()` walks the values and the instance together instead of building and splitting a path string for every value and walking it from the root (same rules, checked against the previous implementation by a differential test). Each `load()` call runs in one `batch()`, so effects reading several loaded values run once per packet.

  With 100 moving players: `load()` 191 µs → 81 µs per tick; with one effect per player reading `x` and `y`, 224 µs → 121 µs and 200 → 100 effect runs per tick.

- 7dc34ed: Signals no longer use rxjs subjects to notify computed signals, effects and `@signe/sync`.

  - Each signal keeps its last event in a light store (`SignalStore`, `ArraySignalStore`, `ObjectSignalStore`) and notifies listeners synchronously. Listeners added or removed during a notification, and errors thrown by a listener (reported asynchronously, other listeners still run), behave as with rxjs subjects.
  - `signal.observable` is still a real rxjs `Observable` with the same events and the same replay on subscribe, so `pipe`, `combineLatest` and `Subscription` keep working. `freeze` / `unfreeze`, detached methods and `computed.subscription` are unchanged.
  - `signal._subject` is now the store. It keeps `value`, `items` / `_items`, `obj` / `_obj`, `next()`, `subscribe()` and `asObservable()`; its TypeScript type changes from `ArraySubject` / `ObjectSubject` to `ArraySignalStore` / `ObjectSignalStore`. `ArraySubject` and `ObjectSubject` are still exported.
  - Non-mutating array methods are bound once instead of being wrapped on every access.
  - New `subscribeToSignal(signal, listener)`: subscribes without rxjs and without replay; falls back to `observable` for signals of `@signe/reactive` 2.x. `@signe/sync` uses it.

  Measured against the previous version (median of alternating runs): one write through a computed and an effect 2.1x faster, diamond 1.9x, fan-out of 1000 computed 2.0x, dynamic dependencies 3.4x; memory per signal 1,026 → 754 bytes. With the sync optimizations of #37, a 100-player server tick goes from ~0.28 ms to ~0.21 ms (Colyseus: ~0.15 ms).

- 8b725c1: Signals and computed signals use much less memory and propagate faster.

  - A signal is now a function bound to its store, whose prototype is shared by all signals. `set`, `update`, `mutate`, `freeze`, `unfreeze`, `observable`, `_subject` and `_isFrozen` are accessors on that prototype: methods are created on first access, bound to their signal, then reused (`signal.set === signal.set`). Detached use (`const { set } = signal`, `other.freeze = signal.freeze`) keeps working, and assigning a method (`signal.set = fn`) still defines an own property on that signal.
  - `signal.observable` and `computed.subscription` are created on first access. `isSignal()` recognizes signals of this version without creating their observable.
  - Computed signals keep their state in a store object instead of closures; the dependency tracker is a class; dependencies are released through their listener entry instead of a closure.
  - Visible change: these are no longer own properties (`Object.keys(signal)` is `[]`), but they are enumerable on the prototype, so `for (const key in signal)` still lists them (CanvasEngine copies signals that way).

  Memory per signal: 754 → 217 bytes (1,026 bytes before the rxjs-free engine). Signal + computed: 2,558 → 1,358 bytes. Propagation through computed signals and effects is about 2× faster; creating signals costs about the same.

### Patch Changes

- 238da23: `computed()`, `effect()` and `linkedSignal()` now collect their dependencies on every run ([#34](https://github.com/RSamaium/signe/issues/34)).

  Previously, dependencies were collected only during the first run, so a signal read only in a branch not taken at first was never tracked and the computed went stale. Now signals newly read are subscribed to and signals no longer read are unsubscribed from, and `dependencies` stays up to date (same `Set` instance).

  `computed.observable` is now shared: it emits the current value to new subscribers without recomputing, and each change recomputes once regardless of the number of subscribers. Unsubscribing `computed.subscription` stops tracking, completes the observable and calls the dispose function (an effect's cleanup still only runs on dispose).

  `linkedSignal()` gets the same changes: an override set with `set()` is dropped when any tracked signal changes, including one first read after the initial run. Its observable is shared too, and now also emits values set with `set()` when the linked signal has dependencies.

## 3.0.0

### Major Changes

- Release the Signe 3.0 package line.

## 2.10.0

### Minor Changes

- Reset the package line to the 2.9.0 runtime baseline for the 2.10 release.

## 2.9.2

### Patch Changes

- e9907e0: Harden public package usage with clearer package metadata, reliable typechecking, safer sync client listener removal, stronger room request routing, and aligned load behavior for typed collections.
