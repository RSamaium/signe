# `@signe/room` Node Game Example

This example runs a small multiplayer arena game on a plain Node.js HTTP server
with WebSocket upgrades handled by `ws`.

```bash
pnpm install
pnpm --filter @signe/room-node-game-example dev
```

Open http://localhost:3000, choose a room id and a display name, then enter the
arena. Open the same room in another browser tab with a different session to see
both players move and score in real time.

Set `PORT=3001` before the command if port `3000` is already in use.

- App URL: `http://localhost:3000/rooms/demo`
- HTTP: `GET /parties/main/demo/state`
- HTTP: `POST /parties/main/demo/reset`
- WebSocket: `ws://localhost:3000/parties/main/demo?name=Sam&id=browser-session-id`

The room uses `@users()` and `@connected()` from `@signe/sync`, so the players
panel shows every known player and whether they are currently connected.

The browser stores a session id in `localStorage` and sends it as the WebSocket
`id` query parameter. That id is the private session id used by the room server,
so refreshing or reconnecting brings the same player back online. Use "New
session" to create another player from the same browser.

## Game room

The game demonstrates a server-authoritative flow:

- `move` updates a player's bounded position in the arena.
- `collect` checks the player's distance from the star on the server before
  awarding a point.
- `reset` clears scores and respawns the star.

Client messages use the same shape as the counter example:

```json
{ "action": "move", "value": { "x": 120, "y": 180 } }
```

```json
{ "action": "collect", "value": {} }
```

## SQLite storage

The default example uses `createMemoryNodeRoomStorage()`. To run the same room
with the package's SQLite-backed `room.storage`, use:

```bash
pnpm --filter @signe/room-node-game-example dev:sqlite
```

The SQLite example uses `createSqliteNodeRoomStorage()` from `@signe/room/node`
and Node's built-in `node:sqlite` module. It stores room state in
`packages/room/examples/node-game/rooms.sqlite`.

The game room also throttles storage writes, so movement can stay responsive
without persisting every single position update immediately.
