---
"@signe/sync": minor
"@signe/room": minor
---

Add volatile sync events with `event()` ([#2](https://github.com/RSamaium/signe/issues/2)).

An `event()` declared with `@sync()` has no stored value: `emit(payload)` sends it once to clients, where `on(listener)` is called after the state of the same packet is applied. Events are never persisted, never kept in `$memoryAll`, and never sent to late joiners.

- `@signe/sync`: new `event()`, `isSyncEvent()` and `loadEvents()`; `syncClass()` accepts an `onEvent` callback; the client dispatches `packet.events` after `load()`.
- `@signe/room`: sync packets carry an `events` key; events emitted with `autoSync` disabled wait in `$pendingEvents` until `$applySync()`; events and state share the same `throttleSync` flush.
