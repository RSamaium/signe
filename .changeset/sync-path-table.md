---
"@signe/sync": minor
"@signe/room": minor
---

Optional path table format for sync packets: a flat list of path ids and values instead of nested objects, faster to parse and to apply on the client.

- `@signe/sync`: new `PathTable` (encoder) and `PathTableDecoder`. The decoder keeps the signal of each path and writes values to it directly; it looks signals up again after a change of the state's structure. `connectionRoom(..., { pathFormat: true })` asks for this format.
- `@signe/room`: clients that ask for it (`?format=paths`) receive sync packets in this format, also with `compression`, `interceptorPacket` and `syncVisibility`. A broadcast is encoded once. New `pathTableLimit` room option (default 65536).
- `load()` counts the changes of a state's structure (`getStructureVersion()`), used by the decoder.

With 100 moving players and an effect per player: parsing and applying a tick on the client is about 2 times faster (about 155 µs → 75 µs), with about 30 % fewer bytes without compression (8 % with it). Encoding costs about 30 µs per broadcast on the server (12 µs for `JSON.stringify`).

`connectionRoom` now keeps its `compression` and `pathFormat` query flags when the application replaces the query with `conn.updateProperties({ query })` (as RPG-JS does when the player changes room). Before, the next room connection lost them.
