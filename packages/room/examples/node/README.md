# `@signe/room` Node Adapter Example

This example runs a `@signe/room` server in a plain Node.js HTTP server with
WebSocket upgrades handled by `ws`.

```bash
pnpm install
pnpm --filter @signe/room-node-example dev
```

Open http://localhost:3000.

- HTTP: `GET /parties/main/demo/count`
- HTTP: `POST /parties/main/demo/reset`
- WebSocket: `ws://localhost:3000/parties/main/demo`

## SQLite storage

The default example uses `createMemoryNodeRoomStorage()`. To run the same room
with the package's SQLite-backed `room.storage`, use:

```bash
pnpm --filter @signe/room-node-example dev:sqlite
```

The SQLite example uses `createSqliteNodeRoomStorage()` from `@signe/room/node`
and Node's built-in `node:sqlite` module. It stores room state in
`packages/room/examples/node/rooms.sqlite`.

The storage provider is passed to `createNodeRoomTransport`:

```ts
const transport = createNodeRoomTransport(CounterServer, {
  partiesPath: "/parties/main",
  storage: createSqliteNodeRoomStorage({
    databasePath: "./rooms.sqlite",
  }),
});
```
