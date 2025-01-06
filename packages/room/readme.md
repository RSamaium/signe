# @signe/room

A real-time multiplayer room system for Signe applications, providing seamless state synchronization and user management.

## Installation

```bash
npm install @signe/room @signe/reactive @signe/sync
```

## Features

- 🔄 Automatic state synchronization
- 👥 Built-in user management
- 🎮 Action-based message handling
- 🔐 Authentication support
- 🎯 TypeScript support

## Usage

Here's a complete example of how to create a multiplayer room:

```ts
import { signal } from "@signe/reactive";
import { Room, Server, action } from "@signe/room";
import { id, sync, users } from "@signe/sync";

// Define a Player class to represent connected users
export class Player {
  @id() id = signal("");
  @sync() x = signal(0);
  @sync() y = signal(0);
  @sync() color = signal("#000000");

  constructor() {
    const randomColor = Math.floor(Math.random() * 16777215).toString(16);
    this.color.set("#" + randomColor);
  }
}

// Define your room's state schema
export class RoomSchema {
  @sync() count = signal(0);
  @users(Player) players = signal({});
}

// Create your room with custom logic
@Room({
  path: "chess-{id}",  // Dynamic room path with parameters
  maxUsers: 2,         // Limit number of users per room
})
export class MyRoom extends RoomSchema {
  // Authentication hook
  static onAuth() {
    // Add your authentication logic here
  }

  constructor(readonly room, readonly params: { id: string }) {
    super();
  }

  // Room lifecycle hooks
  onCreate() {
    // Called when the room is created
  }

  onJoin(player: Player) {
    console.log(player.id(), "joined");
    // Handle player joining
  }

  onLeave() {
    // Handle player leaving
  }

  // Custom actions
  @action("move")
  move(player: Player, data: any) {
    player.x.set(data.x);
    player.y.set(data.y);
  }
}

// Create your server with room definitions
export default class MyServer extends Server {
  rooms = [MyRoom];
}
```

## Decorators

- `@Room(options)`: Defines a room with configuration options
- `@sync()`: Marks a property for automatic synchronization
- `@id()`: Marks a property as the unique identifier
- `@users(PlayerClass)`: Creates a synchronized collection of users
- `@action(name)`: Defines a method as a callable action from clients

## Lifecycle Hooks

- `onAuth()`: Called during authentication
- `onCreate()`: Called when the room is created
- `onJoin(player)`: Called when a player joins
- `onLeave()`: Called when a player leaves

## Best Practices

1. Always define proper types for your actions' data parameters
2. Implement proper authentication in the `onAuth` hook
3. Clean up resources in the `onLeave` hook
4. Use TypeScript for better type safety and development experience

## License

MIT