# `@signe/room` Node Adapter Example

This example runs a `@signe/room` server in a plain Node.js HTTP server with
WebSocket upgrades handled by `ws`.

```bash
pnpm install
pnpm --filter @signe/room-node-example dev
```

Open http://localhost:3000, choose a room id and a display name, then enter the
room. The browser URL changes to `/rooms/:roomId`; refreshing that URL serves
the same app and reconnects to the matching room.

- App URL: `http://localhost:3000/rooms/demo`
- HTTP: `GET /parties/main/demo/count`
- HTTP: `POST /parties/main/demo/reset`
- WebSocket: `ws://localhost:3000/parties/main/demo?name=Sam&id=browser-session-id`

The room uses `@users()` and `@connected()` from `@signe/sync`, so the right
panel shows every known user and whether they are currently connected.

The browser example stores a session id in `localStorage` and sends it as the
WebSocket `id` query parameter. That id is the private session id used by the
room server, so refreshing or reconnecting brings the same user back online. If
you click "New session" or clear local storage, the next connection gets a new
session and the previous user remains visible as offline until normal session
cleanup removes it. Multiple tabs with the same stored session id stay attached
to the same user and receive room broadcasts independently. Server handlers
receive a unique `conn.id` for each WebSocket and the shared private session id
as `conn.sessionId`.

## SQLite storage

The default example uses `createMemoryNodeRoomStorage()`. To run the same room
with the package's SQLite-backed `room.storage`, use:

```bash
pnpm --filter @signe/room-node-example dev:sqlite
```

The SQLite example uses `createSqliteNodeRoomStorage()` from `@signe/room/node`
and Node's built-in `node:sqlite` module. It stores room state in
`packages/room/examples/node/rooms.sqlite`.
Because the users collection is persisted, reopening the SQLite example can show
previous users as offline until they reconnect with the same session id.

The storage provider is passed to `createNodeRoomTransport`:

```ts
const transport = createNodeRoomTransport(CounterServer, {
  partiesPath: "/parties/main",
  storage: createSqliteNodeRoomStorage({
    databasePath: "./rooms.sqlite",
  }),
});
```
