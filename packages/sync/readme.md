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

  // Sync with custom class type and persistence options
  @sync({ 
    classType: MyClass,
    persist: false,
    syncToClient: true 
  })
  customProp = signal({})
}
```

#### @id()
Marks a property as an identifier:

```typescript
class MyClass {
  @id()
  myId = signal(0)
}
```

#### @users()
Marks a property for user synchronization:

```typescript
class MyClass {
  @users(UserClass)
  myUsers = signal({})
}
```

#### @persist()
Marks a property for persistence only (no client sync):

```typescript
class MyClass {
  @persist()
  myPersistentProp = signal(0)
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
import { connection } from '@signe/sync/client'

const room = new Room()
const conn = connection({
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

## License

MIT
