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
