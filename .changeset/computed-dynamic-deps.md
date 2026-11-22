---
"@signe/reactive": patch
---

`computed()`, `effect()` and `linkedSignal()` now collect their dependencies on every run ([#34](https://github.com/RSamaium/signe/issues/34)).

Previously, dependencies were collected only during the first run, so a signal read only in a branch not taken at first was never tracked and the computed went stale. Now signals newly read are subscribed to and signals no longer read are unsubscribed from, and `dependencies` stays up to date (same `Set` instance).

`computed.observable` is now shared: it emits the current value to new subscribers without recomputing, and each change recomputes once regardless of the number of subscribers. Unsubscribing `computed.subscription` stops tracking, completes the observable and calls the dispose function (an effect's cleanup still only runs on dispose).

`linkedSignal()` gets the same changes: an override set with `set()` is dropped when any tracked signal changes, including one first read after the initial run. Its observable is shared too, and now also emits values set with `set()` when the linked signal has dependencies.
