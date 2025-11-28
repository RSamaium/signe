# @signe/sync

A powerful synchronization library for real-time state management and persistence in TypeScript applications. This package is part of the Signe framework and provides decorators and utilities for seamless state synchronization between client and server.

## Features

- 🔄 Real-time state synchronization
- 💾 State persistence
- 🎯 Selective synchronization with fine-grained control
- 🔌 WebSocket integration with PartySocket
- 🎨 Decorator-based API for easy implementation
- 🔍 Path-based value loading and retrieval
- 📦 TypeScript support out of the box

## Installation

```bash
npm install @signe/sync
```

## Usage

### Basic Synchronization

```typescript
import { signal } from '@signe/reactive'
import { sync, syncClass } from '@signe/sync'

class MyClass {
  @sync()
  count = signal(0)

  @sync()
  text = signal('hello')
}

const instance = new MyClass()
syncClass(instance, {
  onSync: (cache) => console.log('Sync cache:', cache),
  onPersist: (cache) => console.log('Persist cache:', cache)
})
```

### Property Decorators

#### @sync()

Synchronizes a property with optional settings:

```typescript
class MyClass {
  // Basic sync with default options
  @sync()
  basicProp = signal(0)
}
```

##### Value Transformation

You can transform values during synchronization using the `transform` option:

```typescript
class MyClass {
  // Transform string to number during sync
  @sync({
    transform: (val) => +val
  })
  value = signal(1)
  
  // Transform to uppercase
  @sync({
    transform: (val) => val.toUpperCase()
  })
  text = signal('hello')
  
  // Custom transformation logic
  @sync({
    transform: (val) => {
      if (typeof val === 'string') {
        return val.trim()
      }
      return val
    }
  })
  data = signal('  spaced  ')
}
```

The `transform` function receives the value before it's synchronized and should return the transformed value. This is useful for:
- Type conversions (string to number, etc.)
- Data normalization
- Formatting values before sync
- Sanitizing input

**Note:** The transformation is applied during synchronization, but the original value stored in the signal remains unchanged.

##### Syncing Collections

You can synchronize collections of objects by specifying the class type:

```typescript
class Player {
  @id() id = signal('player-1')
  @sync() name = signal('Player Name')
}

class MyClass {
  // Synchronize a collection of Player objects
  @sync(Player) players = signal<Record<string, Player>>({})
  
  addPlayer(playerId: string) {
    // Dynamic key synchronization
    // The Player instance automatically gets the id from the key
    this.players()[playerId] = new Player()
  }
}
```

In the example above, when you add a player with `players.value['player-123'] = new Player()`, the `@id()` decorator ensures the Player instance automatically takes 'player-123' as its ID.

##### Object Synchronization Options

There are two ways to synchronize objects:

1. **Entire object synchronization**:
```typescript
class MyClass {
  // The entire object is synchronized as one unit
  @sync() myObj = signal({ val: 1, count: 2 })
}
```

2. **Granular property synchronization**:
```typescript
class MyClass {
  // Individual properties with signals are synchronized separately
  @sync() myObject = { 
    val: signal(1), 
    count: signal(2) 
  }
}
```

The key difference:
- In the first approach, changing any property triggers synchronization of the entire object
- In the second approach, only the changed property is synchronized, providing finer-grained control

#### @id()

Marks a property as the unique identifier for an instance:

```typescript
class Player {
  // Will automatically receive the key value when added to a collection
  @id() id = signal('')
  @sync() name = signal('Player Name')
}
```

The `@id()` decorator is especially useful for dynamic collections where the key in the collection should be reflected in the object's ID property.

#### @users()

Marks a property for special user collection synchronization:

```typescript
class User {
  @id() id = signal('')
  @sync() name = signal('')
  @connected() isConnected = signal(false)
}

class Room {
  // Special collection that automatically populates based on user connections
  @users(User) connectedUsers = signal<Record<string, User>>({})
}
```

The `@users()` decorator creates a special collection that:
- Automatically populates with user instances when they connect to the room
- Automatically removes users when they disconnect
- Links to the user's session information
- Updates all clients in real-time with connection status

This is ideal for building features like user presence indicators, online user lists, or real-time collaboration tools.

#### @persist()
Marks a property for persistence only (no client sync):

```typescript
class MyClass {
  @persist() myPersistentProp = signal(0)
}
```

#### @connected()
Marks a property for tracking user connection status:

```typescript
class User {
  @id() id = signal('user-1')
  @connected() isConnected = signal(false)
  name = signal('User Name')
}
```

This decorator automatically tracks and synchronizes a user's connection state. When a user connects to a room, the property is automatically set to `true`. When they disconnect, it's set to `false`. This state is synchronized with all clients, allowing real-time connection status updates without manual management.

Benefits:
- Automatically updated when users connect/disconnect
- Synchronized to all clients in real-time
- Can be used in UI to show online/offline indicators
- No need to manually track connection status with custom events

### Client Connection

Set up a WebSocket connection for real-time synchronization:

```typescript
import { connectionRoom } from '@signe/sync/client'

const room = new Room()
const conn = connectionRoom({
  host: 'your-server-url',
  room: 'room-id'
}, room)

// Emit events
conn.emit('event-name', { data: 'value' })

// Listen for events
conn.on('event-name', (data) => {
  console.log('Received:', data)
})
```

### Loading State

Load state from paths or objects:

```typescript
import { load } from '@signe/sync'

// Load using paths
load(instance, {
  'position.x': 10,
  'position.y': 20
})

// Load using object
load(instance, {
  position: { x: 10, y: 20 }
}, true)
```

## API Reference

### syncClass(instance, options?)
Synchronizes an instance by adding state management methods.

Options:
- `onSync?: (value: Map<string, any>) => void` - Callback for sync events
- `onPersist?: (value: Set<string>) => void` - Callback for persistence events

### Decorator Options

Common options for decorators:
- `classType?: Function` - Specify a class type for complex objects
- `persist?: boolean` - Enable/disable persistence (default: true)
- `syncToClient?: boolean` - Enable/disable client synchronization (default: true)
- `transform?: <T>(value: T) => any` - Transform the value before synchronization. The function receives the original value and should return the transformed value. Useful for type conversions, data normalization, or formatting.

## License

MIT
