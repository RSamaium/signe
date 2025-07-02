import { 
  Room, 
  Server, 
  Action, 
  RoomGuard,
  requireSession,
  requireSessionWithProperties,
  requireSessionFromRoom,
  combineSessionGuards
} from "../src/index";
import { signal } from "@signe/reactive";
import { sync, persist, id } from "@signe/sync";
import type * as Party from "../src/types/party";

// User class that will be stored in sessions
class User {
  @id() id: string;
  @sync() name = signal("");
  @sync() level = signal(1);
  @sync() connected = signal(false);
  @persist() score = signal(0);
}

// Game lobby room that requires a fresh session
@Room({ 
  path: "lobby", 
  guards: [requireSession({ autoCreateSession: true })]
})
export class LobbyRoom {
  @sync(User) users = signal<Record<string, User>>({});

  constructor(private room: Party.Room) {}

  async onJoin(user: User, conn: Party.Connection) {
    user.connected.set(true);
    console.log(`User ${user.name()} joined the lobby`);
  }

  async onLeave(user: User, conn: Party.Connection) {
    user.connected.set(false);
    console.log(`User ${user.name()} left the lobby`);
  }

  @Action("joinGame")
  async joinGame(user: User, data: { gameRoomId: string }, conn: Party.Connection) {
    // Prepare session transfer to game room
    const server = new Server(this.room);
    const transferToken = await server.prepareSessionTransfer(
      conn.id,
      data.gameRoomId,
      {
        playerLevel: user.level(),
        playerScore: user.score()
      }
    );

    if (transferToken) {
      // Send the transfer URL to the client
      server.send(conn, {
        type: "gameTransfer",
        transferUrl: `/parties/game/${data.gameRoomId}?transfer_token=${transferToken}`
      }, this);
    }
  }
}

// Game room that requires session transferred from lobby
@Room({ 
  path: "game-{gameId}", 
  guards: [
    combineSessionGuards([
      requireSession({ allowTransfers: true }),
      requireSessionFromRoom(["lobby"]),
      requireSessionWithProperties(["level", "score"])
    ])
  ]
})
export class GameRoom {
  @sync(User) players = signal<Record<string, User>>({});
  @sync() gameState = signal("waiting");
  @sync() maxPlayers = signal(4);

  constructor(private room: Party.Room) {}

  async onJoin(user: User, conn: Party.Connection) {
    user.connected.set(true);
    console.log(`Player ${user.name()} joined game ${this.room.id}`);
    
    // Check if we have enough players to start
    const connectedPlayers = Object.values(this.players()).filter(p => p.connected());
    if (connectedPlayers.length >= 2 && this.gameState() === "waiting") {
      this.gameState.set("playing");
      console.log("Game started!");
    }
  }

  async onSessionTransfer(user: User, conn: Party.Connection, transferData: any) {
    // Handle the transferred session data
    if (transferData?.playerLevel) {
      user.level.set(transferData.playerLevel);
    }
    if (transferData?.playerScore) {
      user.score.set(transferData.playerScore);
    }
    
    console.log(`Session transferred for ${user.name()} with level ${user.level()} and score ${user.score()}`);
  }

  @Action("leaveGame")
  async leaveGame(user: User, data: any, conn: Party.Connection) {
    // Prepare session transfer back to lobby
    const server = new Server(this.room);
    const transferToken = await server.prepareSessionTransfer(
      conn.id,
      "lobby",
      {
        playerLevel: user.level(),
        playerScore: user.score()
      }
    );

    if (transferToken) {
      server.send(conn, {
        type: "lobbyTransfer",
        transferUrl: `/parties/lobby?transfer_token=${transferToken}`
      }, this);
    }
  }
}

// Private room that requires session but no auto-creation
@Room({ 
  path: "private-{roomId}", 
  guards: [requireSession({ autoCreateSession: false })]
})
export class PrivateRoom {
  @sync(User) members = signal<Record<string, User>>({});

  constructor(private room: Party.Room) {}

  async onJoin(user: User, conn: Party.Connection) {
    user.connected.set(true);
    console.log(`User ${user.name()} joined private room ${this.room.id}`);
  }
}

// Example server implementation
export class GameServer extends Server {
  rooms = [LobbyRoom, GameRoom, PrivateRoom];
}

// Usage example:
// 1. Connect to lobby: ws://localhost/parties/lobby
// 2. The lobby will auto-create a session
// 3. Use the "joinGame" action to get a transfer token
// 4. Connect to game room with: ws://localhost/parties/game/room1?transfer_token=<token>
// 5. The game room validates the session came from the lobby
// 6. Use "leaveGame" action to transfer back to lobby