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

##### Loading Data into Collections

When loading data into collections, the class instances are automatically created with the data passed to their constructor:

```typescript
class Player {
  @id() id = signal('player-1')
  @sync() name = signal('Player Name')
  @sync() score = signal(0)
  
  constructor(data?: any) {
    // Data is automatically passed when loading from server/persistence
    if (data) {
      console.log('Loading player with data:', data)
      // You can use the data to initialize the instance
      // The load function will also populate the properties automatically
    }
  }
}

class Game {
  @sync(Player) players = signal<Record<string, Player>>({})
}

const game = new Game()

// When loading data, Player instances are created with the data object
load(game, {
  players: {
    'player-1': {
      name: 'Alice',
      score: 100
    },
    'player-2': {
      name: 'Bob',
      score: 200
    }
  }
}, true)

// The constructor receives: { name: 'Alice', score: 100 }
// Then the properties are automatically loaded: name and score signals are updated
```

The `load` function supports multiple formats:

```typescript
// Format 1: Nested object structure
load(game, {
  players: {
    'player-1': {
      name: 'Alice',
      score: 100
    }
  }
}, true)

// Format 2: Path with object value
load(game, {
  'players.player-1': {
    name: 'Alice',
    score: 100
  }
})

// Format 3: Full path notation
load(game, {
  'players.player-1.name': 'Alice',
  'players.player-1.score': 100
})
```

**Important:** The constructor receives the data object first, then the `load` function automatically populates all the properties. This allows you to:
- Initialize the instance with the provided data in the constructor
- Perform custom initialization logic based on the data
- The properties decorated with `@sync()` will still be automatically loaded after construction

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

#### Volatile events with event()
Use `event()` for things that happen once (a hit, a sound, an animation) rather than state. An event has no current value: it is sent to clients, triggers their listeners, and is never stored, persisted or sent to clients that join later.

```typescript
import { signal } from '@signe/reactive'
import { sync, event } from '@signe/sync'

class Player {
  @sync() hp = signal(100)
  @sync() hit = event<{ damage: number; crit: boolean }>()
}

// Server
player.hp.update(v => v - 40)
player.hit.emit({ damage: 40, crit: false })

// Client
player.hit.on(({ damage, crit }) => {
  // player.hp() is already 60 here
  showDamage(damage, crit)
})
```

Behavior:
- Every `emit()` is delivered, even with an identical payload or several in the same tick (in emission order)
- The event travels in the same sync packet as the state changes made with it, and client listeners run after that state is applied
- `on()` returns an unsubscribe function; `off(listener)` removes a listener
- `emit()` also calls listeners registered on the same instance (for example on the server)
- `syncToClient: false` keeps the event local; `transform` is applied to the payload; `persist` is ignored

Sync packets carry events under a separate `events` key, by path:

```json
{ "type": "sync", "value": { "hp": 60 }, "events": { "hit": [{ "damage": 40, "crit": false }] } }
```

`connectionRoom()` dispatches them automatically. If you handle packets yourself, call `loadEvents(instance, packet.events)` after `load()`.

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

#### Compressed messages

When the room enables `compression` (see `@signe/room`), a client can ask for compressed messages:

```typescript
const conn = await connectionRoom({
  host: 'your-server-url',
  room: 'room-id',
  compression: true, // adds ?compression=deflate and reads binary frames as ArrayBuffer
}, room)
```

Large messages then arrive as binary frames (DEFLATE). `connectionRoom` decodes them before `load()` and before calling `on()` listeners. Each message is decoded once, however many listeners there are. Clients that do not ask keep receiving JSON text.

If you read the socket yourself, use `decodeMessage()`: it accepts JSON text frames and compressed binary frames.

```typescript
import { decodeMessage } from '@signe/sync'

socket.binaryType = 'arraybuffer'
socket.addEventListener('message', (event) => {
  const packet = decodeMessage(event.data)
})
```

Compression uses native zlib when the runtime exposes it synchronously through `process.getBuiltinModule` (Node.js 20.16+ / 22.3+, Cloudflare Workers with the `nodejs_compat` flag), and [fflate](https://github.com/101arrowz/fflate) otherwise (browsers, Workers without `nodejs_compat`). Both produce the same format.

### Loading State

`load()` applies all values of a call in one `batch()` (see `@signe/reactive`): a computed signal or an effect that reads several loaded values (for example a sprite reading `x` and `y`) runs once per call, after every value is applied, instead of once per value.

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

#### Loading Collections with Class Instances

When loading data into collections that use class types, the instances are automatically created with the data passed to their constructor:

```typescript
class GameObject {
  @sync() position = { x: signal(0), y: signal(0) }
  @sync() direction = signal(0)
  
  constructor(data?: any) {
    // Data is passed when loading from server/persistence
    if (data) {
      // Use data for initialization if needed
      // Properties will be automatically loaded after construction
    }
  }
}

class Scene {
  @sync(GameObject) objects = signal<Record<string, GameObject>>({})
}

const scene = new Scene()

// Loading creates GameObject instances with data
load(scene, {
  objects: {
    'obj-1': {
      position: { x: 100, y: 200 },
      direction: 45
    }
  }
}, true)

// The GameObject constructor receives: { position: { x: 100, y: 200 }, direction: 45 }
// Then position.x, position.y, and direction signals are automatically updated
```

The `load` function supports three formats for loading collection data:

1. **Nested object structure** (requires `true` as third parameter):
```typescript
load(scene, {
  objects: {
    'obj-1': { position: { x: 100, y: 200 } }
  }
}, true)
```

2. **Path with object value**:
```typescript
load(scene, {
  'objects.obj-1': { position: { x: 100, y: 200 } }
})
```

3. **Full path notation**:
```typescript
load(scene, {
  'objects.obj-1.position.x': 100,
  'objects.obj-1.position.y': 200
})
```

All three formats will create the `GameObject` instance with the available data passed to the constructor, then automatically populate the properties.

## API Reference

### syncClass(instance, options?)
Synchronizes an instance by adding state management methods.

Options:
- `onSync?: (value: Map<string, any>) => void` - Callback for sync events
- `onPersist?: (value: Set<string>) => void` - Callback for persistence events
- `onEvent?: (events: Map<string, any[]>) => void` - Called on each `event()` emission with the pending payloads by path. The consumer clears the map once sent. Without it, events are not collected.

### loadEvents(instance, events)
Dispatches the `events` of a sync packet (`{ [path]: payload[] }`) to the matching `event()` listeners. Unknown paths are ignored.

### Decorator Options

Common options for decorators:
- `classType?: Function` - Specify a class type for complex objects
- `persist?: boolean` - Enable/disable persistence (default: true)
- `syncToClient?: boolean` - Enable/disable client synchronization (default: true)
- `transform?: <T>(value: T) => any` - Transform the value before synchronization. The function receives the original value and should return the transformed value. Useful for type conversions, data normalization, or formatting.

## License

MIT
