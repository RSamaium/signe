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
- 🌐 HTTP request routing with path parameters
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

## Action 

An action is a function that is called when a client sends a message to the server.

Function have to be decorated with the `@Action` decorator and  have 3 parameters:

- The first parameter is the player instance
- The second parameter is the value of the action
- The third parameter is the Party.Connection instance

## HTTP Request Handling

The `@Request` decorator allows you to handle HTTP requests with specific routes and methods:

```ts
import { z } from "zod";
import { Room, Request, RequestGuard } from "@signe/room";

@Room({
  path: "api"
})
class ApiRoom {
  @sync() gameState = signal("waiting");
  @users(Player) players = signal({});
  @sync() scores = signal([]);

  // Handle GET requests
  @Request({ path: "/status" })
  getStatus(req: Party.Request) {
    return {
      status: "online",
      players: Object.keys(this.players()).length,
      gameState: this.gameState(),
    };
  }

  // Handle requests with path parameters
  @Request({ path: "/players/:id" })
  getPlayer(req: Party.Request, body: any, params: { id: string }) {
    const player = this.players()[params.id];
    if (!player) {
      return new Response(JSON.stringify({ error: "Player not found" }), { status: 404 });
    }
    return player;
  }

  // Handle POST requests with body validation
  @Request(
    { path: "/scores", method: "POST" },
    z.object({ 
      playerId: z.string(),
      score: z.number().min(0)
    })
  )
  @RequestGuard([isAuthenticated])
  submitScore(req: Party.Request, body: { playerId: string; score: number }) {
    this.scores.update(scores => [...scores, body]);
    return { success: true };
  }
}
```

Request handler methods receive these parameters:
1. `req`: The original Party.Request object
2. `body`: The validated request body (if validation schema was provided)
3. `params`: An object containing any path parameters
4. `room`: The Party.Room instance

You can return:
- A Response object for complete control
- An object that will be serialized as JSON
- A string that will be returned as text/plain

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
  
  @Request({ path: "/admin/users", method: "DELETE" })
  @RequestGuard([isAdmin]) // Applied only to this request handler
  async deleteUserViaHttp(req: Party.Request) {
    // Only authenticated admins can access this endpoint
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

## Testing

```ts
import { test, vi } from "vitest"
import { testRoom, Room, Action, sync } from "@signe/room"
import { signal } from "@signe/reactive"

test('test', async () => {

    @Room({
        path: "game"
    })
    class GameRoom {
      @sync() count = signal(0);

      @Action('increment')
      increment() {
        this.count.update(c => c + 1)
      }
    }

    const { createClient, room, server } = await testRoom(GameRoom)
    const client1 = await createClient()
    const client2 = await createClient()

    const countFn = vi.fn()

    client1.addEventListener('message', countFn)
    client2.addEventListener('message',countFn)

    await client1.send({
        action: 'increment'
    })

    expect(countFn).toHaveBeenCalledTimes(2)
    expect(countFn).toHaveBeenCalledWith('{"type":"sync","value":{"count":1}}')
    expect(room.count()).toBe(1)
    expect(server.roomStorage.get('.')).toEqual({
      count: 1
    })
})
```

## License

MIT