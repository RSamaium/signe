---
"@signe/reactive": minor
"@signe/sync": minor
---

Faster client updates:

- `@signe/reactive`: new `batch(fn)`. Computed signals and effects that depend on several signals written in the batch update once, when the batch ends. Change events (`observable`, `subscribeToSignal`) are still delivered at each write; reading a computed inside a batch applies pending updates first, so values are never stale; nested batches flush at the outermost one, also when `fn` throws.
- `@signe/sync`: `load()` walks the values and the instance together instead of building and splitting a path string for every value and walking it from the root (same rules, checked against the previous implementation by a differential test). Each `load()` call runs in one `batch()`, so effects reading several loaded values run once per packet.

With 100 moving players: `load()` 191 µs → 81 µs per tick; with one effect per player reading `x` and `y`, 224 µs → 121 µs and 200 → 100 effect runs per tick.
