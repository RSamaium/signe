# Signe Node Shard Example

This example runs two local Node processes with three Party-style namespaces:

- World process on `http://localhost:3002`: the world registry, shard balancer, and dashboard.
- Room process on `http://localhost:3003`: the authoritative `main` room server and `shard` proxies.

The browser UI lets you inspect one world, create or scale room shards, change shard status, and then enter the room through the selected world.

## Run

```bash
pnpm install
pnpm --dir packages/room/examples/node-shard dev
```

Open:

```txt
http://localhost:3002
```

## Useful URLs

```txt
World dashboard: http://localhost:3002
World connect:   POST http://localhost:3002/api/world/world-default/connect
Main HTTP:       http://localhost:3003/parties/main/demo/state
Shard WS:        ws://localhost:3003/parties/shard/{shardId}
```

This is a local development dashboard. Management requests are proxied by the world process so the browser does not need to know `SHARD_SECRET`.
