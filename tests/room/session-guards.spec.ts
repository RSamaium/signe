import { beforeEach, describe, expect, it, vi } from "vitest";
import { 
  requireSession, 
  requireSessionWithProperties, 
  requireSessionFromRoom, 
  requireFreshSession,
  combineSessionGuards,
  SessionTransferService
} from "../../packages/room/src";

describe('Session Guards - Unit Tests', () => {
  let mockStorage: any;
  let mockRoom: any;
  let mockConn: any;
  let mockCtx: any;

  beforeEach(() => {
    // Mock storage implementation
    mockStorage = {
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

    mockRoom = {
      id: "test-room",
      storage: mockStorage
    };

    mockConn = {
      id: "test-connection-id"
    };

    mockCtx = {
      request: {
        url: "ws://localhost/test-room"
      }
    };
  });

  describe('requireSession', () => {
    it('should allow connection when session exists', async () => {
      // Setup existing session
      await mockStorage.put("session:test-connection-id", {
        publicId: "user123",
        created: Date.now(),
        connected: true
      });

      const guard = requireSession();
      const result = await guard(mockConn, mockCtx, mockRoom);
      
      expect(result).toBe(true);
    });

    it('should deny connection when no session exists and autoCreate is false', async () => {
      const guard = requireSession({ autoCreateSession: false });
      const result = await guard(mockConn, mockCtx, mockRoom);
      
      expect(result).toBe(false);
    });

    it('should allow connection when no session exists and autoCreate is true', async () => {
      const guard = requireSession({ autoCreateSession: true });
      const result = await guard(mockConn, mockCtx, mockRoom);
      
      expect(result).toBe(true);
    });

    it('should use custom validation function', async () => {
      await mockStorage.put("session:test-connection-id", {
        publicId: "user123",
        created: Date.now(),
        connected: true,
        state: { isVerified: false }
      });

      const guard = requireSession({
        validateSession: (sessionData) => sessionData.state?.isVerified === true
      });
      
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(false);
    });

    it('should handle transfer tokens from URL parameters', async () => {
      mockCtx.request.url = "ws://localhost/test-room?transfer_token=test_token_123";

      // Setup transfer data
      await mockStorage.put("session:other-connection-id", {
        publicId: "user123",
        created: Date.now(),
        connected: true,
        transferToken: "test_token_123",
        transferExpiry: Date.now() + 300000
      });

      await mockStorage.put("transfer:test_token_123", {
        sourceRoomId: "source-room",
        targetRoomId: "test-room",
        timestamp: Date.now(),
        transferId: "test_token_123"
      });

      const guard = requireSession();
      const result = await guard(mockConn, mockCtx, mockRoom);
      
      expect(result).toBe(true);
    });

         it('should reject expired transfer tokens', async () => {
       mockCtx.request.url = "ws://localhost/test-room?transfer_token=expired_token";

       // Setup expired transfer data
       await mockStorage.put("session:other-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         transferToken: "expired_token",
         transferExpiry: Date.now() - 1000 // Expired
       });

       await mockStorage.put("transfer:expired_token", {
         sourceRoomId: "source-room",
         targetRoomId: "test-room",
         timestamp: Date.now(),
         transferId: "expired_token"
       });

       const guard = requireSession({ autoCreateSession: false });
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(false);
     });

     it('should handle missing request context gracefully', async () => {
       const mockCtxNoRequest = { request: undefined };

       const guard = requireSession({ autoCreateSession: true });
       const result = await guard(mockConn, mockCtxNoRequest as any, mockRoom);
       
       expect(result).toBe(true); // Should allow auto-creation
     });

     it('should handle missing request URL gracefully', async () => {
       const mockCtxNoUrl = { request: { url: undefined } };

       const guard = requireSession({ autoCreateSession: true });
       const result = await guard(mockConn, mockCtxNoUrl as any, mockRoom);
       
       expect(result).toBe(true); // Should allow auto-creation
     });

     it('should handle invalid URL format gracefully', async () => {
       const mockCtxInvalidUrl = { request: { url: "not-a-valid-url" } };

       const guard = requireSession({ autoCreateSession: true });
       const result = await guard(mockConn, mockCtxInvalidUrl as any, mockRoom);
       
       expect(result).toBe(true); // Should allow auto-creation despite invalid URL
     });
  });

  describe('requireSessionWithProperties', () => {
    it('should allow session with all required properties', async () => {
      await mockStorage.put("session:test-connection-id", {
        publicId: "user123",
        created: Date.now(),
        connected: true,
        state: {
          level: 5,
          score: 1000,
          username: "testuser"
        }
      });

      const guard = requireSessionWithProperties(["level", "score", "username"]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      
      expect(result).toBe(true);
    });

    it('should deny session missing required properties', async () => {
      await mockStorage.put("session:test-connection-id", {
        publicId: "user123",
        created: Date.now(),
        connected: true,
        state: {
          level: 5,
          // Missing score and username
        }
      });

      const guard = requireSessionWithProperties(["level", "score", "username"]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      
      expect(result).toBe(false);
    });

    it('should deny session with no state', async () => {
      await mockStorage.put("session:test-connection-id", {
        publicId: "user123",
        created: Date.now(),
        connected: true
        // No state property
      });

      const guard = requireSessionWithProperties(["level"]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      
      expect(result).toBe(false);
    });

    it('should handle empty required properties array', async () => {
      await mockStorage.put("session:test-connection-id", {
        publicId: "user123",
        created: Date.now(),
        connected: true,
        state: {}
      });

      const guard = requireSessionWithProperties([]);
      const result = await guard(mockConn, mockCtx, mockRoom);
      
      expect(result).toBe(true);
    });
  });

     describe('requireSessionFromRoom', () => {
     it('should allow session from allowed source room', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "lobby"
       });

       const guard = requireSessionFromRoom(["lobby", "tutorial"]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(true);
     });

     it('should deny session from disallowed source room', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "restricted-room"
       });

       const guard = requireSessionFromRoom(["lobby", "tutorial"]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(false);
     });

     it('should allow any room with wildcard "*"', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "any-random-room-name"
       });

       const guard = requireSessionFromRoom(["*"]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(true);
     });

     it('should match rooms with RegExp patterns', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "game-room-123"
       });

       const guard = requireSessionFromRoom([/^game-room-\d+$/, "lobby"]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(true);
     });

     it('should reject rooms that do not match RegExp patterns', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "game-room-abc"
       });

       const guard = requireSessionFromRoom([/^game-room-\d+$/, "lobby"]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(false);
     });

     it('should match rooms with string wildcard patterns', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "tutorial-beginner"
       });

       const guard = requireSessionFromRoom(["tutorial-*", "lobby"]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(true);
     });

     it('should handle complex wildcard patterns', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "level-3-special"
       });

       const guard = requireSessionFromRoom(["level-*-special", "lobby"]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(true);
     });

     it('should reject rooms that do not match wildcard patterns', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "tutorial-advanced-extra"
       });

       const guard = requireSessionFromRoom(["tutorial-*", "lobby"]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(true); // Should match tutorial-*
     });

     it('should handle mixed pattern types', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "custom-room-999"
       });

       const guard = requireSessionFromRoom([
         "lobby",                    // Exact match
         /^game-\d+$/,              // RegExp pattern
         "tutorial-*",              // String wildcard
         "*-special"                // Suffix wildcard
       ]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(false); // Should not match any pattern
     });

     it('should escape special regex characters in string patterns', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "room.with.dots"
       });

       const guard = requireSessionFromRoom(["room.with.dots"]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(true);
     });

     it('should deny session with no lastRoomId', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true
         // No lastRoomId
       });

       const guard = requireSessionFromRoom(["lobby"]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(false);
     });

     it('should handle empty allowed rooms array', async () => {
       await mockStorage.put("session:test-connection-id", {
         publicId: "user123",
         created: Date.now(),
         connected: true,
         lastRoomId: "any-room"
       });

       const guard = requireSessionFromRoom([]);
       const result = await guard(mockConn, mockCtx, mockRoom);
       
       expect(result).toBe(false);
     });
   });

  describe('requireFreshSession', () => {
    it('should create fresh session guard with correct configuration', async () => {
      const guard = requireFreshSession();
      
      // Should allow connection without existing session (auto-create enabled)
      const result = await guard(mockConn, mockCtx, mockRoom);
      expect(result).toBe(true);
    });

    it('should reject transfer tokens', async () => {
      mockCtx.request.url = "ws://localhost/test-room?transfer_token=some_token";

      const guard = requireFreshSession();
      const result = await guard(mockConn, mockCtx, mockRoom);
      
      // Should ignore transfer token and allow fresh session creation
      expect(result).toBe(true);
    });
  });

  describe('combineSessionGuards', () => {
    it('should require all guards to pass', async () => {
      const guard1 = vi.fn().mockResolvedValue(true);
      const guard2 = vi.fn().mockResolvedValue(false);
      const guard3 = vi.fn().mockResolvedValue(true);

      const combinedGuard = combineSessionGuards([guard1, guard2, guard3]);
      const result = await combinedGuard(mockConn, mockCtx, mockRoom);

      expect(result).toBe(false);
      expect(guard1).toHaveBeenCalledWith(mockConn, mockCtx, mockRoom);
      expect(guard2).toHaveBeenCalledWith(mockConn, mockCtx, mockRoom);
      expect(guard3).not.toHaveBeenCalled(); // Should short-circuit on first failure
    });

    it('should return true when all guards pass', async () => {
      const guard1 = vi.fn().mockResolvedValue(true);
      const guard2 = vi.fn().mockResolvedValue(true);
      const guard3 = vi.fn().mockResolvedValue(true);

      const combinedGuard = combineSessionGuards([guard1, guard2, guard3]);
      const result = await combinedGuard(mockConn, mockCtx, mockRoom);

      expect(result).toBe(true);
      expect(guard1).toHaveBeenCalledWith(mockConn, mockCtx, mockRoom);
      expect(guard2).toHaveBeenCalledWith(mockConn, mockCtx, mockRoom);
      expect(guard3).toHaveBeenCalledWith(mockConn, mockCtx, mockRoom);
    });

    it('should handle empty guards array', async () => {
      const combinedGuard = combineSessionGuards([]);
      const result = await combinedGuard(mockConn, mockCtx, mockRoom);

      expect(result).toBe(true);
    });

    it('should handle async guards correctly', async () => {
      const guard1 = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return true;
      });
      
      const guard2 = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return true;
      });

      const combinedGuard = combineSessionGuards([guard1, guard2]);
      const result = await combinedGuard(mockConn, mockCtx, mockRoom);

      expect(result).toBe(true);
      expect(guard1).toHaveBeenCalled();
      expect(guard2).toHaveBeenCalled();
    });
  });

  describe('Complex Guard Combinations', () => {
    it('should handle realistic game scenario guards', async () => {
      // Setup session from lobby with player data
      await mockStorage.put("session:test-connection-id", {
        publicId: "player123",
        created: Date.now(),
        connected: true,
        lastRoomId: "lobby",
        state: {
          level: 10,
          score: 5000,
          hasCompletedTutorial: true
        }
      });

      const gameRoomGuards = combineSessionGuards([
        requireSessionFromRoom(["lobby"]),
        requireSessionWithProperties(["level", "score", "hasCompletedTutorial"]),
        requireSession({
          validateSession: (session) => session.state.level >= 5
        })
      ]);

      const result = await gameRoomGuards(mockConn, mockCtx, mockRoom);
      expect(result).toBe(true);
    });

    it('should reject session failing any combined requirement', async () => {
      // Setup session that fails level requirement
      await mockStorage.put("session:test-connection-id", {
        publicId: "player123",
        created: Date.now(),
        connected: true,
        lastRoomId: "lobby",
        state: {
          level: 3, // Below required level
          score: 5000,
          hasCompletedTutorial: true
        }
      });

      const gameRoomGuards = combineSessionGuards([
        requireSessionFromRoom(["lobby"]),
        requireSessionWithProperties(["level", "score", "hasCompletedTutorial"]),
        requireSession({
          validateSession: (session) => session.state.level >= 5
        })
      ]);

      const result = await gameRoomGuards(mockConn, mockCtx, mockRoom);
      expect(result).toBe(false);
    });
  });
});