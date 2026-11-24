---
"@signe/room": minor
---

Faster synchronization and safer storage batching:

- **Sync packets are batched by default.** All changes made in the same task are sent as one `sync` packet at the end of the task, instead of one packet per `set()`. `throttleSync` now sets a minimum interval between packets, and the first packet of a burst also groups the changes of its task. Clients receive the same state, in fewer packets.
- **Broadcasts are serialized once.** Without `interceptorPacket`, a packet is stringified once and the same string is sent to every connection (no more `structuredClone` + `JSON.stringify` per connection). With `interceptorPacket`, each connection still gets its own copy.
- **Storage writes are batched by default.** Without `throttleStorage`, changes of the same task are written together instead of one write per change.
- **`throttleStorage` can no longer postpone writes forever.** Writes are still debounced, but they happen at the latest after `throttleStorageMaxWait` (new option, default 10 × `throttleStorage`). Before, a state changing more often than `throttleStorage` was never persisted.
- `$memoryAll` is no longer rebuilt twice per packet when `getMemoryAll` is used.

Benchmark (100 players moving, 50 clients, one tick): 73 ms → 0.9 ms with default options, 9.7 ms → 0.9 ms compared to `throttleSync`.
