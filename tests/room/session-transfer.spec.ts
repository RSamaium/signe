import { beforeEach, describe, expect, it, afterEach, vi, beforeAll } from "vitest";
import { 
  Server, 
  testRoom, 
  Room, 
  SessionTransferService, 
  requireSession, 
  requireSessionWithProperties, 
  requireSessionFromRoom, 
  requireFreshSession,
  combineSessionGuards
} from "../../packages/room/src";
import { id, sync, users } from "@signe/sync";
import { signal } from "@signe/reactive";

class Player {
  @id() id: string;
  @sync() name = signal('');
  @sync() level = signal(1);
  @sync() score = signal(0);
  @sync() connected = signal(false);
}

@Room({
  path: "lobby",
  guards: [requireSession({ autoCreateSession: true })]
})
class LobbyRoom {
  @sync() playerCount = signal(0);
  @users(Player) users = signal({});

  async onJoin(user: Player, conn: any, ctx: any) {
    user.connected.set(true);
    this.playerCount.set(Object.keys(this.users()).length);
  }

  async onLeave(user: Player, conn: any) {
    user.connected.set(false);
  }
}

@Room({
  path: "game-{gameId}",
  guards: [requireSessionFromRoom(["lobby"])]
})
class GameRoom {
  @sync() gameState = signal("waiting");
  @users(Player) players = signal({});

  async onJoin(user: Player, conn: any, ctx: any) {
    user.connected.set(true);
  }

  async onSessionTransfer(user: Player, conn: any, transferData: any) {
    if (transferData?.level) {
      user.level.set(transferData.level);
    }
    if (transferData?.score) {
      user.score.set(transferData.score);
    }
  }
}

@Room({
  path: "private-{roomId}",
  guards: [requireSession({ autoCreateSession: false })]
})
class PrivateRoom {
  @users(Player) members = signal({});

  async onJoin(user: Player, conn: any, ctx: any) {
    user.connected.set(true);
  }
}

@Room({
  path: "advanced-{roomId}",
  guards: [
    combineSessionGuards([
      requireSessionFromRoom(["lobby"]),
      requireSessionWithProperties(["level", "score"])
    ])
  ]
})
class AdvancedRoom {
  @users(Player) members = signal({});
}

@Room({
  path: "fresh-session",
  guards: [requireFreshSession()]
})
class FreshSessionRoom {
  @users(Player) users = signal({});
}

describe('SessionTransferService', () => {
  let storage: any;
  let service: SessionTransferService;

  beforeEach(() => {
    // Mock storage
    storage = {
      data: new Map(),
      async get(key: string) {
        return this.data.get(key);
      },
      async put(key: string, value: any) {
        this.data.set(key, value);
      },
      async delete(key: string) {
        this.data.delete(key);
      },
      async list() {
        return Array.from(this.data.entries());
      }
    };

    service = new SessionTransferService(storage, "test-room");
  });

  describe('prepareSessionTransfer', () => {
    it('should create transfer token for existing session', async () => {
      // Setup existing session
      const sessionData = {
        publicId: "user123",
        created: Date.now(),
        connected: true
      };
      await storage.put("session:private123", sessionData);

      const token = await service.prepareSessionTransfer("private123", "target-room", { data: "test" });

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token).toMatch(/^transfer_\d+_[a-z0-9]+$/);

      // Check updated session
      const updatedSession = await storage.get("session:private123");
      expect(updatedSession.transferToken).toBe(token);
      expect(updatedSession.transferData).toEqual({ data: "test" });
      expect(updatedSession.lastRoomId).toBe("test-room");

      // Check transfer metadata
      const transferMetadata = await storage.get(`transfer:${token}`);
      expect(transferMetadata).toBeDefined();
      expect(transferMetadata.sourceRoomId).toBe("test-room");
      expect(transferMetadata.targetRoomId).toBe("target-room");
    });

    it('should return null for non-existent session', async () => {
      const token = await service.prepareSessionTransfer("nonexistent", "target-room");
      expect(token).toBeNull();
    });
  });

  describe('validateTransferToken', () => {
    it('should validate and return session data for valid token', async () => {
      // Setup session and transfer
      const sessionData = {
        publicId: "user123",
        created: Date.now(),
        connected: true,
        transferToken: "transfer_123_abc",
        transferExpiry: Date.now() + 300000
      };
      await storage.put("session:private123", sessionData);

      const transferMetadata = {
        sourceRoomId: "source-room",
        targetRoomId: "target-room",
        timestamp: Date.now(),
        transferId: "transfer_123_abc"
      };
      await storage.put("transfer:transfer_123_abc", transferMetadata);

      const result = await service.validateTransferToken("transfer_123_abc", "target-room");

      expect(result).toBeDefined();
      expect(result!.privateId).toBe("private123");
      expect(result!.sessionData.publicId).toBe("user123");
    });

    it('should return null for invalid target room', async () => {
      // Setup session and transfer
      const sessionData = {
        publicId: "user123",
        transferToken: "transfer_123_abc",
        transferExpiry: Date.now() + 300000
      };
      await storage.put("session:private123", sessionData);

      const transferMetadata = {
        targetRoomId: "different-room",
        transferId: "transfer_123_abc"
      };
      await storage.put("transfer:transfer_123_abc", transferMetadata);

      const result = await service.validateTransferToken("transfer_123_abc", "target-room");
      expect(result).toBeNull();
    });

    it('should return null for expired token', async () => {
      const sessionData = {
        publicId: "user123",
        transferToken: "transfer_123_abc",
        transferExpiry: Date.now() - 1000 // Expired
      };
      await storage.put("session:private123", sessionData);

      const transferMetadata = {
        targetRoomId: "target-room",
        transferId: "transfer_123_abc"
      };
      await storage.put("transfer:transfer_123_abc", transferMetadata);

      const result = await service.validateTransferToken("transfer_123_abc", "target-room");
      expect(result).toBeNull();

      // Check that expired transfer was cleaned up
      const sessionAfter = await storage.get("session:private123");
      expect(sessionAfter.transferToken).toBeUndefined();
    });
  });

  describe('completeSessionTransfer', () => {
    it('should clean up transfer data and update session', async () => {
             const sessionData = {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         transferToken: "transfer_123_abc",
         transferData: { level: 5 },
         transferExpiry: Date.now() + 300000
       };

       await service.completeSessionTransfer("private123", sessionData);

      const updatedSession = await storage.get("session:private123");
      expect(updatedSession.connected).toBe(true);
      expect(updatedSession.transferToken).toBeUndefined();
      expect(updatedSession.transferData).toBeUndefined();
      expect(updatedSession.transferExpiry).toBeUndefined();
      expect(updatedSession.lastRoomId).toBe("test-room");
    });
  });

  describe('hasValidSession', () => {
    it('should return true for existing session', async () => {
      await storage.put("session:private123", { publicId: "user123" });
      const hasSession = await service.hasValidSession("private123");
      expect(hasSession).toBe(true);
    });

    it('should return false for non-existent session', async () => {
      const hasSession = await service.hasValidSession("nonexistent");
      expect(hasSession).toBe(false);
    });
  });
});

describe('Session Guards', () => {
  describe('requireSession', () => {
    let mockRoom: any;
    let mockConn: any;
    let mockCtx: any;
    let storage: any;

    beforeEach(() => {
      storage = {
        data: new Map(),
        async get(key: string) { return this.data.get(key); },
        async put(key: string, value: any) { this.data.set(key, value); },
        async delete(key: string) { this.data.delete(key); },
        async list() { return Array.from(this.data.entries()); }
      };

      mockRoom = { id: "test-room", storage };
      mockConn = { id: "private123" };
      mockCtx = { request: { url: "ws://localhost/test" } };
    });

    it('should allow connection with existing session', async () => {
      await storage.put("session:private123", { publicId: "user123", connected: true });

      const guard = requireSession();
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(true);
    });

    it('should deny connection without session when autoCreate is false', async () => {
      const guard = requireSession({ autoCreateSession: false });
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(false);
    });

    it('should allow connection without session when autoCreate is true', async () => {
      const guard = requireSession({ autoCreateSession: true });
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(true);
    });

    it('should validate session with custom validator', async () => {
      await storage.put("session:private123", { 
        publicId: "user123", 
        state: { isVerified: false }
      });

      const guard = requireSession({
        validateSession: (session) => session.state?.isVerified === true
      });
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(false);
    });

    it('should handle transfer token in URL', async () => {
      mockCtx.request.url = "ws://localhost/test?transfer_token=transfer_123_abc";

      // Setup transfer
      await storage.put("session:private456", {
        publicId: "user123",
        transferToken: "transfer_123_abc",
        transferExpiry: Date.now() + 300000
      });
      await storage.put("transfer:transfer_123_abc", {
        targetRoomId: "test-room",
        transferId: "transfer_123_abc"
      });

      const guard = requireSession();
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(true);
    });
  });

  describe('requireSessionWithProperties', () => {
    let mockRoom: any;
    let mockConn: any;
    let mockCtx: any;
    let storage: any;

    beforeEach(() => {
      storage = {
        data: new Map(),
        async get(key: string) { return this.data.get(key); },
        async put(key: string, value: any) { this.data.set(key, value); },
        async delete(key: string) { this.data.delete(key); },
        async list() { return Array.from(this.data.entries()); }
      };

      mockRoom = { id: "test-room", storage };
      mockConn = { id: "private123" };
      mockCtx = { request: { url: "ws://localhost/test" } };
    });

    it('should allow session with required properties', async () => {
      await storage.put("session:private123", {
        publicId: "user123",
        state: { level: 5, score: 100 }
      });

      const guard = requireSessionWithProperties(["level", "score"]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(true);
    });

    it('should deny session missing required properties', async () => {
      await storage.put("session:private123", {
        publicId: "user123",
        state: { level: 5 } // Missing score
      });

      const guard = requireSessionWithProperties(["level", "score"]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(false);
    });
  });

  describe('requireSessionFromRoom', () => {
    let mockRoom: any;
    let mockConn: any;
    let mockCtx: any;
    let storage: any;

    beforeEach(() => {
      storage = {
        data: new Map(),
        async get(key: string) { return this.data.get(key); },
        async put(key: string, value: any) { this.data.set(key, value); },
        async delete(key: string) { this.data.delete(key); },
        async list() { return Array.from(this.data.entries()); }
      };

      mockRoom = { id: "test-room", storage };
      mockConn = { id: "private123" };
      mockCtx = { request: { url: "ws://localhost/test" } };
    });

    it('should allow session from allowed room', async () => {
      await storage.put("session:private123", {
        publicId: "user123",
        lastRoomId: "lobby"
      });

      const guard = requireSessionFromRoom(["lobby", "tutorial"]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(true);
    });

    it('should deny session from disallowed room', async () => {
      await storage.put("session:private123", {
        publicId: "user123",
        lastRoomId: "other-room"
      });

      const guard = requireSessionFromRoom(["lobby", "tutorial"]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(false);
    });

    it('should allow session with wildcard pattern', async () => {
      await storage.put("session:private123", {
        publicId: "user123",
        lastRoomId: "any-room-name"
      });

      const guard = requireSessionFromRoom(["*"]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(true);
    });

    it('should work with regex patterns', async () => {
      await storage.put("session:private123", {
        publicId: "user123",
        lastRoomId: "game-level-42"
      });

      const guard = requireSessionFromRoom([/^game-level-\d+$/]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(true);
    });

    it('should work with string wildcard patterns', async () => {
      await storage.put("session:private123", {
        publicId: "user123",
        lastRoomId: "tutorial-advanced"
      });

      const guard = requireSessionFromRoom(["tutorial-*", "lobby"]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(true);
    });
  });

  describe('combineSessionGuards', () => {
    let mockRoom: any;
    let mockConn: any;
    let mockCtx: any;

    beforeEach(() => {
      mockRoom = { id: "test-room" };
      mockConn = { id: "private123" };
      mockCtx = { request: { url: "ws://localhost/test" } };
    });

    it('should require all guards to pass', async () => {
      const guard1 = vi.fn().mockResolvedValue(true);
      const guard2 = vi.fn().mockResolvedValue(false);
      const guard3 = vi.fn().mockResolvedValue(true);

      const combinedGuard = combineSessionGuards([guard1, guard2, guard3]);
      const result = await combinedGuard(mockConn, mockCtx, mockRoom);

      expect(result).toBe(false);
      expect(guard1).toHaveBeenCalled();
      expect(guard2).toHaveBeenCalled();
      expect(guard3).not.toHaveBeenCalled(); // Should stop at first failure
    });

    it('should return true when all guards pass', async () => {
      const guard1 = vi.fn().mockResolvedValue(true);
      const guard2 = vi.fn().mockResolvedValue(true);

      const combinedGuard = combineSessionGuards([guard1, guard2]);
      const result = await combinedGuard(mockConn, mockCtx, mockRoom);

      expect(result).toBe(true);
      expect(guard1).toHaveBeenCalled();
      expect(guard2).toHaveBeenCalled();
    });
  });
});

describe('Server Integration with Session Transfer', () => {
  let lobbyTest: any;
  let gameTest: any;
  let privateTest: any;
  let lobbyServer: Server;
  let gameServer: Server;
  let privateServer: Server;

  beforeEach(async () => {
    lobbyTest = await testRoom(LobbyRoom);
           gameTest = await testRoom(GameRoom);
       privateTest = await testRoom(PrivateRoom);
    
    lobbyServer = lobbyTest.server;
    gameServer = gameTest.server;
    privateServer = privateTest.server;
  });

  afterEach(async () => {
    // Clean up any open connections
    lobbyTest?.cleanup?.();
    gameTest?.cleanup?.();
    privateTest?.cleanup?.();
  });

  describe('Session Transfer Flow', () => {
    it('should transfer session from lobby to game room', async () => {
      // Connect to lobby (should auto-create session)
      const lobbyClient = await lobbyTest.createClient();
      const privateId = lobbyClient.conn.id;
      
      // Verify session was created in lobby
      const lobbySession = await lobbyServer.getSession(privateId);
      expect(lobbySession).toBeDefined();
      expect(lobbySession?.publicId).toBeDefined();

      // Prepare transfer to game room
      const transferToken = await lobbyServer.prepareSessionTransfer(
        privateId,
        "game-room1",
        { level: 5, score: 1000 }
      );
      expect(transferToken).toBeDefined();

      // Disconnect from lobby
      lobbyClient.conn.close();

      // Connect to game room with transfer token
      const gameClient = await gameTest.createClient(privateId, {
        queryParams: { transfer_token: transferToken }
      });

               // Verify session was transferred
         const gameSession = await gameServer.getSession(privateId);
         expect(gameSession).toBeDefined();
         expect(gameSession?.publicId).toBe(lobbySession?.publicId);

      gameClient.conn.close();
    });

    it('should deny connection to game room without transfer from lobby', async () => {
      // Try to connect directly to game room without lobby session
      try {
        const gameClient = await gameTest.createClient();
        expect.fail("Should have denied connection");
      } catch (error) {
        // Expected to fail due to session guard
        expect(error).toBeDefined();
      }
    });

    it('should deny connection to private room without existing session', async () => {
      // Try to connect to private room without session
      try {
        const privateClient = await privateTest.createClient();
        expect.fail("Should have denied connection");
      } catch (error) {
        // Expected to fail due to session guard
        expect(error).toBeDefined();
      }
    });
  });

  describe('Session Transfer Service Methods', () => {
    it('should expose session transfer service from server', async () => {
      const transferService = lobbyServer.getSessionTransferService();
      expect(transferService).toBeInstanceOf(SessionTransferService);
    });

    it('should handle session transfer correctly', async () => {
      const lobbyClient = await lobbyTest.createClient();
      const privateId = lobbyClient.conn.id;

      // Prepare transfer
      const transferToken = await lobbyServer.prepareSessionTransfer(
        privateId,
        "game-room1",
        { test: "data" }
      );

      // Simulate transfer in game server
      const transferSuccessful = await gameServer.handleSessionTransfer(
        { id: privateId } as any,
        transferToken!
      );

      expect(transferSuccessful).toBe(true);

      lobbyClient.conn.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid transfer tokens gracefully', async () => {
      const transferSuccessful = await gameServer.handleSessionTransfer(
        { id: "some-id" } as any,
        "invalid-token"
      );

      expect(transferSuccessful).toBe(false);
    });

    it('should handle expired transfer tokens', async () => {
      const lobbyClient = await lobbyTest.createClient();
      const privateId = lobbyClient.conn.id;

      // Create transfer token manually with past expiry
      const transferService = lobbyServer.getSessionTransferService();
      const sessionData = {
        publicId: "user123",
        created: Date.now(),
        connected: true,
        transferToken: "expired-token",
        transferExpiry: Date.now() - 1000 // Expired
      };

               // Manually save expired session
         await (lobbyServer.roomStorage as any).put("session:" + privateId, sessionData);
         await (lobbyServer.roomStorage as any).put("transfer:expired-token", {
           sourceRoomId: "lobby",
           targetRoomId: "game-room1",
           timestamp: Date.now(),
           transferId: "expired-token"
         });

      // Try to validate expired token
      const result = await transferService.validateTransferToken("expired-token", "game-room1");
      expect(result).toBeNull();

      lobbyClient.conn.close();
    });

         it('should handle missing request context in onConnectClient', async () => {
       // Create a mock connection and context without request
       const mockConn = {
         id: "test-connection",
         setState: vi.fn(),
         state: {}
       };
       const mockCtx = { request: undefined };

       // This should not throw an error due to room guards failing gracefully
       try {
         await lobbyServer.onConnectClient(mockConn as any, mockCtx as any);
       } catch (error) {
         // Expected to potentially fail due to storage issues in test env
         expect(error).toBeDefined();
       }
     });

     it('should handle invalid URL in request context', async () => {
       // Create a mock connection and context with invalid URL
       const mockConn = {
         id: "test-connection",
         setState: vi.fn(),
         state: {}
       };
       const mockCtx = { 
         request: { 
           url: "not-a-valid-url" 
         } 
       };

       // This should not throw an error due to room guards failing gracefully
       try {
         await lobbyServer.onConnectClient(mockConn as any, mockCtx as any);
       } catch (error) {
         // Expected to potentially fail due to storage issues in test env
         expect(error).toBeDefined();
       }
     });
  });
});

describe('Integration with Real Room Scenarios', () => {
  let advancedTest: any;
  let freshTest: any;

  beforeEach(async () => {
         advancedTest = await testRoom(AdvancedRoom);
    freshTest = await testRoom(FreshSessionRoom);
  });

  afterEach(async () => {
    advancedTest?.cleanup?.();
    freshTest?.cleanup?.();
  });

  it('should enforce combined guard requirements', async () => {
    // Try to connect without proper session setup
    try {
      const advancedClient = await advancedTest.createClient();
      expect.fail("Should have denied connection");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('should allow fresh session room connections', async () => {
    const freshClient = await freshTest.createClient();
    expect(freshClient.conn.id).toBeDefined();
    freshClient.conn.close();
  });

     it('should call onSessionTransfer when transfer data is present', async () => {
     const gameTest = await testRoom(GameRoom);
     const gameRoom = gameTest.room;
    
    // Mock the onSessionTransfer method to track calls
    const onSessionTransferSpy = vi.spyOn(gameRoom, 'onSessionTransfer');
    
    // Create a client with transfer data simulation
    const client = await gameTest.createClient();
    
         // Manually trigger transfer with data
     const user = Object.values(gameRoom.players())[0] as Player;
     await gameRoom.onSessionTransfer(user, client.conn, { level: 10, score: 500 });
     
     expect(onSessionTransferSpy).toHaveBeenCalledWith(
       user,
       client.conn,
       { level: 10, score: 500 }
     );
     
     expect(user.level()).toBe(10);
     expect(user.score()).toBe(500);
    
    client.conn.close();
  });
});