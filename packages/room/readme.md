# @signe/room

A real-time multiplayer room system for Signe applications, providing seamless state synchronization and user management.

## Installation

```bash
npm install @signe/room @signe/reactive @signe/sync
```

## Features

- 🔄 Automatic state synchronization across clients
- 👥 Built-in user management with customizable player classes
- 🎮 Action-based message handling with type safety
- 🔐 Flexible authentication and authorization system
- 🛡️ Guard system for room and action-level security
- 🎯 Full TypeScript support
- 🔌 WebSocket-based real-time communication
- 💾 Automatic state persistence
- 🚀 Optimized for performance with throttling support

## Basic Usage

Here's a simple example of a multiplayer game room:

```ts
import { signal } from "@signe/reactive";
import { Room, Server, Action } from "@signe/room";
import { id, sync, users } from "@signe/sync";

// Define a Player class
class Player {
  @id() id: string;
  @sync() x = signal(0);
  @sync() y = signal(0);
  @sync() score = signal(0);
}

// Create your room
@Room({
  path: "game",
})
class GameRoom {
  @users(Player) players = signal({});
  @sync() gameState = signal("waiting");

  @Action("move")
  move(player: Player, position: { x: number, y: number }) {
    player.x.set(position.x);
    player.y.set(position.y);
  }
}

// Create your server
export default class GameServer extends Server {
  rooms = [GameRoom];
}
```

## Action 

An action is a function that is called when a client sends a message to the server.

Function have to be decorated with the `@Action` decorator and  have 3 parameters:

- The first parameter is the player instance
- The second parameter is the value of the action
- The third parameter is the Party.Connection instance

## Advanced Features

### Room Configuration

The `@Room` decorator accepts various configuration options:

```ts
@Room({
  path: "game-{id}",     // Dynamic path with parameters
  maxUsers: 4,           // Limit number of users
  throttleStorage: 1000, // Throttle storage updates (ms)
  throttleSync: 100,     // Throttle sync updates (ms)
  hibernate: false,      // Enable/disable hibernation
  guards: [isAuthenticated], // Room-level guards
})
```

### Authentication & Authorization

You can implement authentication and authorization using guards:

```ts
// Authentication guard
function isAuthenticated(conn: Connection, ctx: ConnectionContext) {
  const token = ctx.request.headers.get("authorization");
  return validateToken(token); // Returns boolean or Promise<boolean>
}

// Role-based guard
function isAdmin(conn: Connection, value: any) {
  return conn.state.role === "admin";
}

@Room({
  path: "admin-panel",
  guards: [isAuthenticated], // Applied to all connections and messages
})
class AdminRoom {
  @Action("deleteUser")
  @Guard([isAdmin]) // Applied only to this action
  async deleteUser(admin: Player, userId: string) {
    // Only authenticated admins can execute this
  }
}
```

### Action Validation with Zod

You can validate action input data using Zod schemas:

```ts
import { z } from "zod";

class GameRoom {
  @Action("move", z.object({
    x: z.number().min(0).max(1000),
    y: z.number().min(0).max(1000)
  }))
  move(player: Player, position: { x: number, y: number }) {
    player.x.set(position.x);
    player.y.set(position.y);
  }

  @Action("setName", z.object({
    name: z.string().min(3).max(20)
  }))
  setName(player: Player, data: { name: string }) {
    player.name.set(data.name);
  }
}
```

Actions with invalid data will be automatically rejected if they don't match the validation schema.

### State Management

The room system provides several ways to manage state:

```ts
class GameRoom {
  // Synchronized signals
  @sync() score = signal(0);
  @sync() gameState = signal<"waiting" | "playing" | "ended">("waiting");
  
  // User management
  @users(Player) players = signal({});
  
  // Complex state
  @sync() 
  gameConfig = signal({
    maxPlayers: 4,
    timeLimit: 300,
    mapSize: { width: 1000, height: 1000 }
  });

  // Methods to update state
  @Action("updateConfig")
  updateConfig(player: Player, config: Partial<GameConfig>) {
    if (player.isHost) {
      this.gameConfig.update(current => ({
        ...current,
        ...config
      }));
    }
  }
}
```

### Lifecycle Hooks

Rooms provide several lifecycle hooks:

```ts
class GameRoom {
  async onCreate()
  async onJoin(player: Player, conn: Connection, ctx: ConnectionContext) {}
  async onLeave(player: Player, conn: Connection) {}
}
```

## Party.Connection

Wraps a standard WebSocket, with a few additional PartyKit-specific properties.

```ts
connection.send("Good-bye!");
connection.close();
```

> https://docs.partykit.io/reference/partyserver-api/#partyconnection

## License

MIT