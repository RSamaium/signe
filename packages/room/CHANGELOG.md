# @signe/room

## 3.3.0

### Minor Changes

- 8e48eba: Faster per-client packets:

  - New `copyPacketForInterceptor` room option (default `true`). Set it to `false` when `interceptorPacket` never modifies the packet it receives: the `structuredClone` per client and per packet is skipped.
  - New `syncVisibility(user, conn, patch)` room hook: return the ids each client can see, by collection. For sync packets, entities that stay visible get their changes, entities that become visible get their full state, and entities that leave the view (or are deleted) get `"$delete"`. The initial sync is filtered too. Optional `syncPacketHeader(user, conn, patch)` adds per-client fields. Each entity is serialized once per broadcast and the packet of each client is assembled from these pieces. Sync packets of a room with `syncVisibility` no longer go through `interceptorPacket`.

  With 100 players and 50 clients each seeing 30 players: about 3.4 ms → 0.77 ms per tick without the copy, and 0.12 ms with `syncVisibility`, for the same packet size.

- 379cdfc: Faster synchronization and safer storage batching:

  - **Sync packets are batched by default.** All changes made in the same task are sent as one `sync` packet at the end of the task, instead of one packet per `set()`. `throttleSync` now sets a minimum interval between packets, and the first packet of a burst also groups the changes of its task. Clients receive the same state, in fewer packets.
  - **Broadcasts are serialized once.** Without `interceptorPacket`, a packet is stringified once and the same string is sent to every connection (no more `structuredClone` + `JSON.stringify` per connection). With `interceptorPacket`, each connection still gets its own copy.
  - **Storage writes are batched by default.** Without `throttleStorage`, changes of the same task are written together instead of one write per change.
  - **`throttleStorage` can no longer postpone writes forever.** Writes are still debounced, but they happen at the latest after `throttleStorageMaxWait` (new option, default 10 × `throttleStorage`). Before, a state changing more often than `throttleStorage` was never persisted.
  - `$memoryAll` is no longer rebuilt twice per packet when `getMemoryAll` is used.

  Benchmark (100 players moving, 50 clients, one tick): 73 ms → 0.9 ms with default options, 9.7 ms → 0.9 ms compared to `throttleSync`.

- 7e4ab67: Stream compression for per-client packets: one DEFLATE stream per connection, flushed after each message.

  - `@signe/sync`: new `createMessageCompressor()` and `createMessageDecoder()` (one per connection), and message formats 2 and 3 (stream messages). `connectionRoom(..., { compression: true })` asks for stream messages (`?compressionStream=1`) and decodes them. `decodeMessage()` is unchanged and refuses stream messages.
  - `@signe/room`: packets built for one client (`syncVisibility`, `interceptorPacket` with `compression.intercepted`) are compressed with the connection's stream when the client reads it. New `compression.stream` (default `true`), `windowBits` and `memLevel` options. Older clients keep receiving messages compressed alone.

  On RPG-JS packets (2 KB, 30 players around): about 26 µs per packet instead of 66 µs on the server, and about 370 bytes instead of 700. Uses about 48 KB of memory per connection. Needs the native zlib of Node.js; in other runtimes, each message is compressed alone as before.

- 02de0d1: Optional compression of messages (DEFLATE, binary frames):

  - `@signe/room`: new `compression` room option (`true` or `{ threshold, level, intercepted }`). Clients that ask for it receive messages larger than `threshold` (default 512) compressed; other clients keep receiving JSON text. A broadcast is compressed once for all clients. Packets returned by `interceptorPacket` are not compressed unless `intercepted: true`.
  - `@signe/sync`: `connectionRoom(..., { compression: true })` asks for compressed messages and decodes them. New `compressMessage()` and `decodeMessage()` helpers. Native zlib is used when available (Node.js 20.16+ / 22.3+), fflate otherwise.
  - `@signe/sync/client`: each message is decoded once for all listeners, and `off()` now removes the listener registered by `on()` (it removed nothing before).

  With 100 moving players: ~3 KB → ~1.1 KB per tick, ~50 µs of server CPU per tick whatever the number of clients.

- 1b2a267: Optional path table format for sync packets: a flat list of path ids and values instead of nested objects, faster to parse and to apply on the client.

  - `@signe/sync`: new `PathTable` (encoder) and `PathTableDecoder`. The decoder keeps the signal of each path and writes values to it directly; it looks signals up again after a change of the state's structure. `connectionRoom(..., { pathFormat: true })` asks for this format.
  - `@signe/room`: clients that ask for it (`?format=paths`) receive sync packets in this format, also with `compression`, `interceptorPacket` and `syncVisibility`. A broadcast is encoded once. New `pathTableLimit` room option (default 65536).
  - `load()` counts the changes of a state's structure (`getStructureVersion()`), used by the decoder.

  With 100 moving players and an effect per player: parsing and applying a tick on the client is about 2 times faster (about 155 µs → 75 µs), with about 30 % fewer bytes without compression (8 % with it). Encoding costs about 30 µs per broadcast on the server (12 µs for `JSON.stringify`).

  `connectionRoom` now keeps its `compression` and `pathFormat` query flags when the application replaces the query with `conn.updateProperties({ query })` (as RPG-JS does when the player changes room). Before, the next room connection lost them.

- c26a8fe: Add volatile sync events with `event()` ([#2](https://github.com/RSamaium/signe/issues/2)).

  An `event()` declared with `@sync()` has no stored value: `emit(payload)` sends it once to clients, where `on(listener)` is called after the state of the same packet is applied. Events are never persisted, never kept in `$memoryAll`, and never sent to late joiners.

  - `@signe/sync`: new `event()`, `isSyncEvent()` and `loadEvents()`; `syncClass()` accepts an `onEvent` callback; the client dispatches `packet.events` after `load()`.
  - `@signe/room`: sync packets carry an `events` key; events emitted with `autoSync` disabled wait in `$pendingEvents` until `$applySync()`; events and state share the same `throttleSync` flush.

### Patch Changes

- 2beee7d: Fix `$applySync()` with `autoSync = false`:

  - Changes made in the same task as `$applySync()` (`room.count.set(1); room.$applySync()`) are sent by this call. Since sync packets are batched per task, they were otherwise sent by the next `$applySync()` only.
  - Clients waiting for their initial sync now receive the whole state. When changes were pending, they only received those changes.

- 28e9bbc: Bump `dset` to 3.1.4.
- a62e883: Lower the server cost of each synchronized change:

  - `@signe/sync`: the full path of a synchronized signal is built once and reused while the instance path does not change (it was rebuilt on every change, and the change maps had to hash a new string each time). The signal kind is resolved once. Persisted changes are no longer collected when `syncClass()` has no `onPersist` callback.
  - `@signe/room`: `buildObject` splits each path once for the packet and `$memoryAll`, and keeps split paths in a bounded cache.

  Benchmark (100 players moving, one tick): 0.44 ms → 0.28 ms; `buildObject` alone 115 µs → 47 µs.

- Updated dependencies [4a21285]
- Updated dependencies [7dc34ed]
- Updated dependencies [7e4ab67]
- Updated dependencies [02de0d1]
- Updated dependencies [a62e883]
- Updated dependencies [1b2a267]
- Updated dependencies [dac5737]
- Updated dependencies [c26a8fe]
  - @signe/sync@3.2.0

## 3.2.1

### Patch Changes

- 19d5119: Improve connection typings so rooms can be used through typed contracts:

  - `NodeConnection.state` and `setState()` are typed as `Party.ConnectionState<TState>`, like a party connection, instead of `TState | ConnectionState<TState> | null` (which collapsed to `unknown`).
  - `Party.Connection` is now an interface extending `WebSocket` instead of an intersection type. TypeScript can then infer the state type when `room.getConnection<TState>()` is checked against a contract that also declares `send()` or `close()`.

## 3.2.0

### Minor Changes

- 78dad08: Add Cloudflare Durable Object WebSocket hibernation, namespace-isolated room
  identities, and alarm restoration after isolate eviction.

## 3.0.0

### Major Changes

- Add multi-world room support, shard authorization, enhanced world stats, and stable session handling across reconnects and multiple tabs.
- Add Cloudflare Durable Object, Node shard, and Node game examples for the 3.0 room runtime.

## 2.10.0

### Minor Changes

- Reset the package line to the 2.9.0 runtime baseline for the 2.10 release.

## 2.9.4

### Patch Changes

- Updated dependencies [35643c0]
  - @signe/sync@2.9.4

## 2.9.3

### Patch Changes

- Updated dependencies [785e260]
  - @signe/sync@2.9.3

## 2.9.2

### Patch Changes

- e9907e0: Harden public package usage with clearer package metadata, reliable typechecking, safer sync client listener removal, stronger room request routing, and aligned load behavior for typed collections.
- Updated dependencies [e9907e0]
  - @signe/sync@2.9.2
