---
"@signe/sync": patch
"@signe/room": patch
---

Lower the server cost of each synchronized change:

- `@signe/sync`: the full path of a synchronized signal is built once and reused while the instance path does not change (it was rebuilt on every change, and the change maps had to hash a new string each time). The signal kind is resolved once. Persisted changes are no longer collected when `syncClass()` has no `onPersist` callback.
- `@signe/room`: `buildObject` splits each path once for the packet and `$memoryAll`, and keeps split paths in a bounded cache.

Benchmark (100 players moving, one tick): 0.44 ms → 0.28 ms; `buildObject` alone 115 µs → 47 µs.
