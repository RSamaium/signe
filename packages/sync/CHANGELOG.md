# @signe/sync

## 3.2.0

### Minor Changes

- 4a21285: Faster client updates:

  - `@signe/reactive`: new `batch(fn)`. Computed signals and effects that depend on several signals written in the batch update once, when the batch ends. Change events (`observable`, `subscribeToSignal`) are still delivered at each write; reading a computed inside a batch applies pending updates first, so values are never stale; nested batches flush at the outermost one, also when `fn` throws.
  - `@signe/sync`: `load()` walks the values and the instance together instead of building and splitting a path string for every value and walking it from the root (same rules, checked against the previous implementation by a differential test). Each `load()` call runs in one `batch()`, so effects reading several loaded values run once per packet.

  With 100 moving players: `load()` 191 µs → 81 µs per tick; with one effect per player reading `x` and `y`, 224 µs → 121 µs and 200 → 100 effect runs per tick.

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

- dac5737: Add `@sync({ precision })` to round the numbers sent to clients.

  - Numbers are rounded to `precision` decimals after `transform` (negative values round to tens, hundreds...), including numbers inside plain objects and arrays.
  - Only what is sent is rounded: the server value and the persisted value stay exact.
  - For a numeric signal, a change that keeps the same rounded value is not sent.
  - New `roundToPrecision(value, precision)` helper.

  With 100 moving players, rounding positions to integers reduced packets by 24 to 39% and server time per tick by 8 to 17%.

- c26a8fe: Add volatile sync events with `event()` ([#2](https://github.com/RSamaium/signe/issues/2)).

  An `event()` declared with `@sync()` has no stored value: `emit(payload)` sends it once to clients, where `on(listener)` is called after the state of the same packet is applied. Events are never persisted, never kept in `$memoryAll`, and never sent to late joiners.

  - `@signe/sync`: new `event()`, `isSyncEvent()` and `loadEvents()`; `syncClass()` accepts an `onEvent` callback; the client dispatches `packet.events` after `load()`.
  - `@signe/room`: sync packets carry an `events` key; events emitted with `autoSync` disabled wait in `$pendingEvents` until `$applySync()`; events and state share the same `throttleSync` flush.

### Patch Changes

- 7dc34ed: Signals no longer use rxjs subjects to notify computed signals, effects and `@signe/sync`.

  - Each signal keeps its last event in a light store (`SignalStore`, `ArraySignalStore`, `ObjectSignalStore`) and notifies listeners synchronously. Listeners added or removed during a notification, and errors thrown by a listener (reported asynchronously, other listeners still run), behave as with rxjs subjects.
  - `signal.observable` is still a real rxjs `Observable` with the same events and the same replay on subscribe, so `pipe`, `combineLatest` and `Subscription` keep working. `freeze` / `unfreeze`, detached methods and `computed.subscription` are unchanged.
  - `signal._subject` is now the store. It keeps `value`, `items` / `_items`, `obj` / `_obj`, `next()`, `subscribe()` and `asObservable()`; its TypeScript type changes from `ArraySubject` / `ObjectSubject` to `ArraySignalStore` / `ObjectSignalStore`. `ArraySubject` and `ObjectSubject` are still exported.
  - Non-mutating array methods are bound once instead of being wrapped on every access.
  - New `subscribeToSignal(signal, listener)`: subscribes without rxjs and without replay; falls back to `observable` for signals of `@signe/reactive` 2.x. `@signe/sync` uses it.

  Measured against the previous version (median of alternating runs): one write through a computed and an effect 2.1x faster, diamond 1.9x, fan-out of 1000 computed 2.0x, dynamic dependencies 3.4x; memory per signal 1,026 → 754 bytes. With the sync optimizations of #37, a 100-player server tick goes from ~0.28 ms to ~0.21 ms (Colyseus: ~0.15 ms).

- a62e883: Lower the server cost of each synchronized change:

  - `@signe/sync`: the full path of a synchronized signal is built once and reused while the instance path does not change (it was rebuilt on every change, and the change maps had to hash a new string each time). The signal kind is resolved once. Persisted changes are no longer collected when `syncClass()` has no `onPersist` callback.
  - `@signe/room`: `buildObject` splits each path once for the packet and `$memoryAll`, and keeps split paths in a bounded cache.

  Benchmark (100 players moving, one tick): 0.44 ms → 0.28 ms; `buildObject` alone 115 µs → 47 µs.

- Updated dependencies [4a21285]
- Updated dependencies [238da23]
- Updated dependencies [7dc34ed]
- Updated dependencies [8b725c1]
  - @signe/reactive@3.2.0

## 3.1.1

### Patch Changes

- 50a6459: Use signal mutations when loading or deleting nested object and array values.

## 3.0.0

### Major Changes

- Release the Signe 3.0 package line for the room and sync runtime updates.

## 2.10.0

### Minor Changes

- Reset `load()` and sync client behavior to the 2.9.0 runtime baseline, removing the typed collection hydration changes introduced after 2.9.0.

## 2.9.4

### Patch Changes

- 35643c0: Restore empty constructor calls for typed collection items before hydration.

## 2.9.3

### Patch Changes

- 785e260: Preserve typed collection hydration semantics when loading object payloads.

## 2.9.2

### Patch Changes

- e9907e0: Harden public package usage with clearer package metadata, reliable typechecking, safer sync client listener removal, stronger room request routing, and aligned load behavior for typed collections.
- Updated dependencies [e9907e0]
  - @signe/reactive@2.9.2
