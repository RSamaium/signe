# `@signe/room` Durable Object Example

This example runs a `@signe/room` server on Cloudflare Workers with one Durable
Object instance per room id.

```bash
pnpm install
pnpm --filter @signe/room build
pnpm --filter @signe/room-cloudflare-example dev
```

Open http://localhost:8787, choose a room id and a display name, then enter the
room. The browser URL changes to `/rooms/:roomId`; refreshing that URL serves
the same app and reconnects to the matching Durable Object room.

- App URL: `http://localhost:8787/rooms/demo`
- HTTP: `GET /parties/main/demo/count`
- HTTP: `POST /parties/main/demo/reset`
- WebSocket: `ws://localhost:8787/parties/main/demo?name=Sam&id=browser-session-id`

The example pins Wrangler 3.99 because its `workerd` binary still runs on
systems with GLIBC 2.31. Newer Wrangler 4 releases can be used on newer systems.

The Worker entry point exports the generic Durable Object class and installs the
room server with the `ROOMS` binding:

```ts
import { createCloudflareRoomWorker, SigneRoomDurableObject } from "@signe/room/cloudflare";
import { CounterServer } from "./room";

export { SigneRoomDurableObject };

export default createCloudflareRoomWorker(CounterServer, {
  binding: "ROOMS",
  partiesPath: "/parties/main",
});
```

This example wraps that worker so non-room requests are served by the `ASSETS`
binding from `public/`.

The Durable Object binding is configured in `wrangler.jsonc`:

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "ROOMS", "class_name": "SigneRoomDurableObject" }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["SigneRoomDurableObject"]
    }
  ]
}
```

The room uses Durable Object storage through the KV-compatible `room.storage`
API, so synchronized state and sessions are scoped to each Durable Object
instance.
