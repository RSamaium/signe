# @signe/room

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
