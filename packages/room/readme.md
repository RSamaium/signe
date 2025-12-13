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
import { Room, Request, RequestGuard, ServerResponse } from "@signe/room";

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
  getPlayer(req: Party.Request, res: ServerResponse) {
    const player = this.players()[req.params.id];
    if (!player) {
      return res.notFound("Player not found");
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
  @Guard([isAuthenticated])
  submitScore(req: Party.Request, res: ServerResponse) {
    this.scores.update(scores => [...scores, req.data]);
    return res.success({ success: true });
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
  @Guard([isAdmin]) // Applied only to this request handler
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

### Manual Synchronization

By default, state changes are automatically synchronized to all clients. However, you can disable automatic synchronization and manually control when to broadcast changes using the `autoSync` option and the `$applySync` method.

This is useful when you want to:
- Batch multiple state changes before broadcasting
- Control synchronization timing for performance optimization
- Implement custom synchronization logic

```ts
@Room({
  path: "game"
})
class GameRoom {
  autoSync = false; // Disable automatic synchronization
  
  @sync() count = signal(0);
  @sync() score = signal(0);
  @sync() level = signal(1);

  @Action("updateGameState")
  updateGameState(player: Player, data: { count: number, score: number, level: number }) {
    // Make multiple changes without triggering sync
    this.count.set(data.count);
    this.score.set(data.score);
    this.level.set(data.level);
    
    // Manually trigger synchronization when ready
    this.$applySync();
  }

  @Action("batchUpdate")
  batchUpdate(player: Player, updates: any[]) {
    // Apply multiple updates
    updates.forEach(update => {
      // ... apply updates
    });
    
    // Sync all changes at once
    this.$applySync();
  }
}
```

You can also toggle `autoSync` at runtime:

```ts
class GameRoom {
  @sync() count = signal(0);

  @Action("startBatchMode")
  startBatchMode() {
    this.$autoSync = false; // Disable auto sync
  }

  @Action("endBatchMode")
  endBatchMode() {
    this.$applySync(); // Sync pending changes
    this.$autoSync = true; // Re-enable auto sync
  }
}
```

**Instance Properties:**
- `$autoSync` (boolean): Controls whether synchronization happens automatically (default: `true`)
- `$pendingSync` (Map): Stores pending synchronization changes when `autoSync` is disabled
- `$applySync()` (method): Manually broadcasts all pending changes to all clients

**Note:** When `autoSync` is disabled, changes are stored in `$pendingSync` until you call `$applySync()`. If you call `$applySync()` with no pending changes, it will broadcast the current state from `$memoryAll`, which is useful for forcing a full state synchronization.

### Connecting to World Service

The World Service provides optimal room and shard assignment for distributed applications. It handles load balancing and allows clients to connect to the most appropriate server.

#### Environment Variables

To use the Signe room system, you need to configure two essential environment variables:

```env
# Required for JWT authentication
AUTH_JWT_SECRET=a-string-secret-at-least-256-bits-long

# Required for secure communication between shards
SHARD_SECRET=your_shard_secret
```

These secrets should be strong, unique values and kept secure.

#### Server Configuration

To use the World service, you need to:

1. Add `WorldRoom` to your server:

```ts
import { Server, WorldRoom } from '@signe/room';

export default class MainServer extends Server {
  rooms = [
    GameRoom,
    WorldRoom // Add WorldRoom to enable World service
  ]
}
```

2. Add `Shard` to your server in `party/shard.ts`:

```ts
import { Shard } from '@signe/room';

export default class ShardServer extends Shard {}
```

3. Configure your `partykit.json` file:

```json
{
  "$schema": "https://www.partykit.io/schema.json",
  "name": "yourapp",
  "main": "party/server.ts",
  "compatibilityDate": "2025-02-04",
  "parties": {
    "shard": "party/shard.ts", // Shard implementation
    "world": "party/server.ts" // World service implementation
  }
}
```

#### Client Connection

On the client side, use the `connectionWorld` function to connect to your room through the World service:

```js
import { connectionWorld } from '@signe/sync/client';

// Initialize your room instance
const room = new YourRoomSchema();

// Connect through the World service
const connection = await connectionWorld({
  host: 'https://your-app-url.com', // Your application URL
  room: 'unique-room-id',             // Room identifier
  worldId: 'your-world-id',             // Optional, defaults to 'world-default'
  autoCreate: true,                     // Auto-create room if it doesn't exist
  retryCount: 3,                        // Number of connection attempts
  retryDelay: 1000                    // Delay between retries in ms
}, room);

// Listen for events
connection.on('customEvent', (data) => {
  console.log('Received custom event:', data);
});

// Send events to the room
connection.emit('increment', { value: 1 });

// Close the connection when done
connection.close();
```

For connecting to a standard room (not through World service), use the `connectionRoom` function:

```js
import { connectionRoom } from '@signe/sync/client';

// Initialize your room instance
const room = new YourRoomSchema();

// Connect directly to a room
const connection = await connectionRoom({
  host: window.location.origin,
  room: 'your-room-name',
  party: 'your-party-name', // Optional, defaults to main party
  query: {} // Optional query parameters
}, room);

// For connecting to a World room with authentication
const worldConnection = await connectionRoom({
  host: window.location.origin,
  room: 'world-default',
  party: 'world',
  query: {
    // Use pre-generated JWT token for authentication
    'world-auth-token': 'your-jwt-token'
  }
}, worldRoom);
```

The `connectionWorld` function:
1. Queries the World service to find the optimal shard for the requested room
2. Establishes a WebSocket connection to the assigned shard
3. Returns a connection object with methods for sending and receiving messages

This approach offers several benefits:
- Automatic load balancing across multiple servers
- Simplified connection management
- Built-in retry logic for reliability
- Room creation on demand

### Packet Interception

You can implement the `interceptorPacket` method in your room to inspect and modify packets before they're sent to users:

```ts
class GameRoom {
  // Intercept packets before they're sent to users
  async interceptorPacket(user: Player, packet: any, conn: Party.Connection) {
    // Modify the packet based on user-specific logic
    if (user.role === 'spectator') {
      delete modifiedPacket.secretData;
      return modifiedPacket;
    }
    
    // Return null to prevent the packet from being sent to this user
    if (user.isBlocked) {
      return null;
    }
    
    // Return the packet as is or with modifications
    return packet;
  }
}
```

The `interceptorPacket` method allows you to:
- Modify packets on a per-user basis before they're sent
- Return a modified packet to change what the user receives
- Return `null` to prevent the packet from being sent to that user
- Implement user-specific filtering or censoring of data

### Lifecycle Hooks

Rooms provide several lifecycle hooks:

```ts
class GameRoom {
  async onJoin(player: Player, conn: Connection, ctx: ConnectionContext) {}
  async onLeave(player: Player, conn: Connection) {}
}
```

## Server Methods

The server provides several methods to help you manage your room:

```ts
import { RoomMethods } from "@signe/room";

export class GameRoom {
  action(name: string, data: any) {
    this.$send(conn, {
      type: 'action',
      name,
      data
    })
  }
  
  broadcast(name: string, data: any) {
    this.$broadcast({
      type: 'action',
      name,
      data
    })
  }
}

export interface GameRoom extends RoomMethods {}


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