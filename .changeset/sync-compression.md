---
"@signe/sync": minor
"@signe/room": minor
---

Optional compression of messages (DEFLATE, binary frames):

- `@signe/room`: new `compression` room option (`true` or `{ threshold, level, intercepted }`). Clients that ask for it receive messages larger than `threshold` (default 512) compressed; other clients keep receiving JSON text. A broadcast is compressed once for all clients. Packets returned by `interceptorPacket` are not compressed unless `intercepted: true`.
- `@signe/sync`: `connectionRoom(..., { compression: true })` asks for compressed messages and decodes them. New `compressMessage()` and `decodeMessage()` helpers. Native zlib is used when available (Node.js 20.16+ / 22.3+), fflate otherwise.
- `@signe/sync/client`: each message is decoded once for all listeners, and `off()` now removes the listener registered by `on()` (it removed nothing before).

With 100 moving players: ~3 KB → ~1.1 KB per tick, ~50 µs of server CPU per tick whatever the number of clients.
