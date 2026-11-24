---
"@signe/sync": minor
"@signe/room": minor
---

Stream compression for per-client packets: one DEFLATE stream per connection, flushed after each message.

- `@signe/sync`: new `createMessageCompressor()` and `createMessageDecoder()` (one per connection), and message formats 2 and 3 (stream messages). `connectionRoom(..., { compression: true })` asks for stream messages (`?compressionStream=1`) and decodes them. `decodeMessage()` is unchanged and refuses stream messages.
- `@signe/room`: packets built for one client (`syncVisibility`, `interceptorPacket` with `compression.intercepted`) are compressed with the connection's stream when the client reads it. New `compression.stream` (default `true`), `windowBits` and `memLevel` options. Older clients keep receiving messages compressed alone.

On RPG-JS packets (2 KB, 30 players around): about 26 µs per packet instead of 66 µs on the server, and about 370 bytes instead of 700. Uses about 48 KB of memory per connection. Needs the native zlib of Node.js; in other runtimes, each message is compressed alone as before.
