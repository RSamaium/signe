# Signe

Signe is a TypeScript toolkit for reactive and real-time applications.

It is published as small packages that can be used independently, or together for
PartyKit/Cloudflare room-based applications.

## Packages

| Package | Use it for |
| --- | --- |
| `@signe/reactive` | Signals, computed values, effects, and observable object/array mutations. |
| `@signe/sync` | Decorator-based state snapshots, persistence flags, and loading remote state into classes. |
| `@signe/room` | PartyKit rooms with synchronized state, actions, guards, sessions, and HTTP handlers. |
| `@signe/di` | Lightweight dependency injection for application services. |
| `@signe/schema-to-zod` | JSON Schema to Zod conversion. |

## Installation

Install only the packages you need:

```bash
pnpm add @signe/reactive
pnpm add @signe/reactive @signe/sync
pnpm add @signe/room @signe/reactive @signe/sync
```

## Quick Start

### Reactive State

```ts
import { computed, effect, signal } from "@signe/reactive";

const count = signal(0);
const doubled = computed(() => count() * 2);

effect(() => {
  console.log(doubled());
});

count.set(2);
```

### Synchronized Classes

```ts
import { signal } from "@signe/reactive";
import { load, sync, syncClass } from "@signe/sync";

class CounterState {
  @sync() count = signal(0);
}

const state = new CounterState();

syncClass(state, {
  onSync(changes) {
    console.log(Object.fromEntries(changes));
  },
});

state.count.set(1);
load(state, { count: 2 }, true);
```

### Realtime Rooms

```ts
import { signal } from "@signe/reactive";
import { Action, Room, Server } from "@signe/room";
import { id, sync, users } from "@signe/sync";

class Player {
  @id() id = signal("");
  @sync() x = signal(0);
  @sync() y = signal(0);
}

@Room({ path: "game-{id}" })
class GameRoom {
  @users(Player) players = signal<Record<string, Player>>({});

  @Action("move")
  move(player: Player, position: { x: number; y: number }) {
    player.x.set(position.x);
    player.y.set(position.y);
  }
}

export default class GameServer extends Server {
  rooms = [GameRoom];
}
```

## Development

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm run build
```

The repository is a pnpm workspace. The root package is private; publishable
packages live under `packages/*`.

## Current Stability Notes

- `@signe/reactive`, `@signe/sync`, `@signe/di`, and `@signe/schema-to-zod` are
  small and directly usable.
- `@signe/room` is usable for PartyKit-style rooms, but `WorldRoom` and `Shard`
  should be treated as advanced infrastructure APIs and validated against your
  deployment topology before production use.

## License

MIT
