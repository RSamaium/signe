# Session Transfer System

This system allows you to transfer user sessions seamlessly between different rooms while maintaining session data and implementing access controls.

## Features

- **Session Transfer**: Move user sessions from one room to another with secure tokens
- **Session Guards**: Control room access based on session requirements
- **Automatic Session Management**: Sessions are preserved and can be validated across rooms
- **Transfer Token Security**: Time-limited tokens (5 minutes) for secure transfers
- **Flexible Guard System**: Multiple guard types for different use cases

## Basic Usage

### 1. Setting up Session Guards

Use guards to control who can connect to your rooms:

```typescript
import { Room, requireSession, requireSessionFromRoom } from "@signe/room";

// Room that auto-creates sessions for new users
@Room({ 
  path: "lobby", 
  guards: [requireSession({ autoCreateSession: true })]
})
export class LobbyRoom {
  // Your room implementation
}

// Room that only allows transfers from specific rooms
@Room({ 
  path: "game-{gameId}", 
  guards: [requireSessionFromRoom(["lobby"])]
})
export class GameRoom {
  // Your room implementation
}
```

### 2. Transferring Sessions Between Rooms

In your room action handler:

```typescript
@Action("joinGame")
async joinGame(user: User, data: { gameRoomId: string }, conn: Party.Connection) {
  const server = new Server(this.room);
  
  // Prepare session for transfer
  const transferToken = await server.prepareSessionTransfer(
    conn.id,
    data.gameRoomId,
    {
      // Additional data to transfer
      playerLevel: user.level(),
      inventory: user.inventory()
    }
  );

  if (transferToken) {
    // Send transfer URL to client
    server.send(conn, {
      type: "redirect",
      url: `/parties/game/${data.gameRoomId}?transfer_token=${transferToken}`
    }, this);
  }
}
```

### 3. Handling Transferred Sessions

Implement the session transfer hook in your target room:

```typescript
export class GameRoom {
  async onSessionTransfer(user: User, conn: Party.Connection, transferData: any) {
    // Handle transferred data
    if (transferData?.playerLevel) {
      user.level.set(transferData.playerLevel);
    }
    if (transferData?.inventory) {
      user.inventory.set(transferData.inventory);
    }
    
    console.log(`Session transferred for ${user.name()}`);
  }
}
```

## Guard Types

### `requireSession(options)`

Basic session requirement guard.

**Options:**
- `allowTransfers?: boolean` - Allow connections with transfer tokens (default: true)
- `validateSession?: (sessionData) => boolean` - Custom session validation
- `autoCreateSession?: boolean` - Auto-create session if none exists (default: false)

```typescript
// Require session, auto-create if needed
requireSession({ autoCreateSession: true })

// Require session with custom validation
requireSession({
  validateSession: (session) => session.state?.isVerified === true
})
```

### `requireSessionWithProperties(properties)`

Require session to have specific properties.

```typescript
// Require session to have user level and score
requireSessionWithProperties(["level", "score"])
```

### `requireSessionFromRoom(allowedRooms)`

Only allow sessions transferred from specific rooms. Supports multiple pattern types:

**Pattern Types:**
- **Exact strings**: `"lobby"` - matches exactly "lobby"
- **RegExp objects**: `/^game-\d+$/` - matches "game-1", "game-42", etc.
- **String wildcards**: `"tutorial-*"` - matches "tutorial-beginner", "tutorial-advanced", etc.
- **Universal wildcard**: `"*"` - matches any room

```typescript
// Exact room names only
requireSessionFromRoom(["lobby", "tutorial"])

// Mixed patterns with regex and wildcards
requireSessionFromRoom([
  "lobby",                    // Exact match
  /^game-level-\d+$/,        // Regex pattern
  "tutorial-*",              // String wildcard
  "*-special"                // Suffix wildcard
])

// Accept sessions from any room
requireSessionFromRoom(["*"])

// Complex VIP room access
requireSessionFromRoom([
  "lobby",
  /^premium-\w+$/,           // Premium rooms
  "vip-*",                   // VIP rooms
  "*-exclusive"              // Any exclusive room
])
```

### `requireFreshSession()`

Require a new session (no transfers allowed).

```typescript
// Force creation of new session
requireFreshSession()
```

### `combineSessionGuards(guards)`

Combine multiple guards (ALL must pass).

```typescript
// Require session from lobby with specific properties
combineSessionGuards([
  requireSessionFromRoom(["lobby"]),
  requireSessionWithProperties(["level", "score"])
])
```

## Client-Side Integration

### Connecting with Transfer Token

When your client receives a transfer URL:

```javascript
// Connect to new room with transfer token
const ws = new WebSocket('ws://localhost/parties/game/room1?transfer_token=transfer_12345');

ws.onopen = () => {
  console.log('Connected to game room with transferred session');
};
```

### Handling Transfer Messages

Listen for transfer messages from the server:

```javascript
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'gameTransfer') {
    // Redirect to game room
    window.location.href = message.transferUrl;
  }
};
```

## Advanced Usage

### Advanced Pattern Matching Examples

The pattern matching system allows for sophisticated room access control:

```typescript
// Game progression system
@Room({
  path: "final-boss",
  guards: [requireSessionFromRoom([
    /^level-[5-9]$/,           // Only from levels 5-9
    /^level-1[0-9]$/,          // Or levels 10-19
    "secret-level-*"           // Or any secret level
  ])]
})
class FinalBossRoom {}

// Event system with flexible access
@Room({
  path: "seasonal-event",
  guards: [requireSessionFromRoom([
    "*-premium",               // Any premium room
    "lobby",                   // Main lobby
    /^event-\d{4}-\d{2}$/     // Previous events (YYYY-MM format)
  ])]
})
class SeasonalEventRoom {}

// Hierarchical room system
@Room({
  path: "admin-panel",
  guards: [
    combineSessionGuards([
      requireSessionFromRoom([
        /^admin-/,             // Any admin room
        "moderator-*",         // Moderator rooms
        "*-management"         // Management rooms
      ]),
      requireSessionWithProperties(["adminLevel", "permissions"])
    ])
  ]
})
class AdminPanelRoom {}

// Tournament system
@Room({
  path: "tournament-final",
  guards: [requireSessionFromRoom([
    /^tournament-semi-\d+$/,   // Semi-final rooms
    /^tournament-quarter-\d+$/ // Quarter-final rooms (backup)
  ])]
})
class TournamentFinalRoom {}
```

### Pattern Performance Notes

- **Exact strings** are fastest (O(1) lookup)
- **Simple wildcards** (`*`) are converted to regex internally
- **Complex regex** patterns may have performance implications with many rooms
- **Universal wildcard** `"*"` always matches first (short-circuits other patterns)

### Pattern Security Considerations

```typescript
// ✅ Good: Specific patterns
requireSessionFromRoom([
  "lobby",
  /^tutorial-level-[1-5]$/,
  "training-basic"
])

// ⚠️ Caution: Too permissive
requireSessionFromRoom(["*"])

// ✅ Good: Controlled wildcard
requireSessionFromRoom([
  "verified-*",              // Only verified rooms
  /^premium-\w{3,}$/        // Premium rooms with min length
])

// ❌ Avoid: Overly complex regex that could cause performance issues
requireSessionFromRoom([
  /^(?:(?!bad-room).)*$/    // Negative lookahead - can be slow
])
```

### Manual Session Transfer Service

For advanced use cases, access the session transfer service directly:

```typescript
export class MyRoom {
  constructor(private room: Party.Room) {}

  async customTransferLogic() {
    const server = new Server(this.room);
    const transferService = server.getSessionTransferService();
    
    // Check if session exists
    const hasSession = await transferService.hasValidSession("privateId");
    
    // Get session for validation
    const session = await transferService.getSessionForValidation("privateId");
    
    // Prepare custom transfer
    const token = await transferService.prepareSessionTransfer(
      "privateId",
      "targetRoom",
      { customData: "value" }
    );
  }
}
```

### Custom Session Validation

Create complex validation logic:

```typescript
const customGuard = requireSession({
  validateSession: async (sessionData) => {
    // Check user permissions
    if (!sessionData.state?.permissions?.includes('GAME_ACCESS')) {
      return false;
    }
    
    // Check account status with external service
    const accountStatus = await checkAccountStatus(sessionData.publicId);
    return accountStatus === 'active';
  }
});
```

## Session Data Structure

Sessions contain the following data:

```typescript
interface SessionData {
  publicId: string;           // User's public identifier
  state?: any;               // User's room state
  created: number;           // Session creation timestamp
  connected: boolean;        // Current connection status
  transferData?: any;        // Data transferred between rooms
  lastRoomId?: string;       // Previous room ID
  transferToken?: string;    // Current transfer token (if any)
  transferExpiry?: number;   // Token expiration time
}
```

## Security Considerations

1. **Token Expiration**: Transfer tokens expire after 5 minutes
2. **Single Use**: Tokens are consumed after successful transfer
3. **Room Validation**: Tokens are validated against target room ID
4. **Session Cleanup**: Expired tokens and sessions are automatically cleaned up

## Error Handling

Sessions transfers can fail for several reasons:

- Invalid or expired transfer token
- Session doesn't exist
- Target room doesn't match
- Guard validation fails

Always check for transfer success and provide fallback logic:

```typescript
const transferSuccessful = await server.handleSessionTransfer(conn, transferToken);
if (!transferSuccessful) {
  // Handle failed transfer
  conn.close();
  return;
}
```