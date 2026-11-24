---
"@signe/room": minor
---

Faster per-client packets:

- New `copyPacketForInterceptor` room option (default `true`). Set it to `false` when `interceptorPacket` never modifies the packet it receives: the `structuredClone` per client and per packet is skipped.
- New `syncVisibility(user, conn, patch)` room hook: return the ids each client can see, by collection. For sync packets, entities that stay visible get their changes, entities that become visible get their full state, and entities that leave the view (or are deleted) get `"$delete"`. The initial sync is filtered too. Optional `syncPacketHeader(user, conn, patch)` adds per-client fields. Each entity is serialized once per broadcast and the packet of each client is assembled from these pieces. Sync packets of a room with `syncVisibility` no longer go through `interceptorPacket`.

With 100 players and 50 clients each seeing 30 players: about 3.4 ms → 0.77 ms per tick without the copy, and 0.12 ms with `syncVisibility`, for the same packet size.
