import { describe, expect, it, beforeEach } from "vitest";
import { SessionTransferService } from "../../packages/room/src/session-transfer";

interface MockStorage {
  data: Map<string, any>;
  get(key: string): Promise<any>;
  put(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<[string, any][]>;
}

describe('SessionTransferService - Core Tests', () => {
  let storage: MockStorage;
  let service: SessionTransferService;

  beforeEach(() => {
    // Create mock storage
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

    service = new SessionTransferService(storage as any, "test-room");
  });

  describe('prepareSessionTransfer', () => {
    it('should create transfer token for existing session', async () => {
      // Setup session
      const sessionData = {
        publicId: "user123",
        created: Date.now(),
        connected: true
      };
      await storage.put("session:private123", sessionData);

      // Prepare transfer
      const token = await service.prepareSessionTransfer(
        "private123", 
        "target-room", 
        { playerLevel: 5 }
      );

      // Verify token was created
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token).toMatch(/^transfer_\d+_[a-z0-9]+$/);

      // Verify session was updated
      const updatedSession = await storage.get("session:private123");
      expect(updatedSession.transferToken).toBe(token);
      expect(updatedSession.transferData).toEqual({ playerLevel: 5 });
      expect(updatedSession.lastRoomId).toBe("test-room");
      expect(updatedSession.transferExpiry).toBeDefined();

      // Verify transfer metadata was stored
      const transferMetadata = await storage.get(`transfer:${token}`);
      expect(transferMetadata).toBeDefined();
      expect(transferMetadata.sourceRoomId).toBe("test-room");
      expect(transferMetadata.targetRoomId).toBe("target-room");
      expect(transferMetadata.transferId).toBe(token);
    });

    it('should return null for non-existent session', async () => {
      const token = await service.prepareSessionTransfer(
        "nonexistent", 
        "target-room"
      );
      expect(token).toBeNull();
    });
  });

  describe('validateTransferToken', () => {
    it('should validate correct transfer token', async () => {
      // Setup session with transfer token
      const now = Date.now();
      const sessionData = {
        publicId: "user123",
        created: now,
        connected: true,
        transferToken: "transfer_123_abc",
        transferExpiry: now + 300000 // 5 minutes from now
      };
      await storage.put("session:private123", sessionData);

      // Setup transfer metadata
      const transferMetadata = {
        sourceRoomId: "source-room",
        targetRoomId: "target-room",
        timestamp: now,
        transferId: "transfer_123_abc"
      };
      await storage.put("transfer:transfer_123_abc", transferMetadata);

      // Validate token
      const result = await service.validateTransferToken(
        "transfer_123_abc", 
        "target-room"
      );

      expect(result).toBeDefined();
      expect(result!.privateId).toBe("private123");
      expect(result!.sessionData.publicId).toBe("user123");
      expect(result!.sessionData.transferToken).toBe("transfer_123_abc");
    });

    it('should return null for wrong target room', async () => {
      const sessionData = {
        publicId: "user123",
        transferToken: "transfer_123_abc",
        transferExpiry: Date.now() + 300000
      };
      await storage.put("session:private123", sessionData);

      const transferMetadata = {
        targetRoomId: "wrong-room",
        transferId: "transfer_123_abc"
      };
      await storage.put("transfer:transfer_123_abc", transferMetadata);

      const result = await service.validateTransferToken(
        "transfer_123_abc", 
        "target-room"
      );
      expect(result).toBeNull();
    });

    it('should return null for expired token', async () => {
      const sessionData = {
        publicId: "user123",
        transferToken: "transfer_123_abc",
        transferExpiry: Date.now() - 1000 // Expired 1 second ago
      };
      await storage.put("session:private123", sessionData);

      const transferMetadata = {
        targetRoomId: "target-room",
        transferId: "transfer_123_abc"
      };
      await storage.put("transfer:transfer_123_abc", transferMetadata);

      const result = await service.validateTransferToken(
        "transfer_123_abc", 
        "target-room"
      );
      expect(result).toBeNull();

      // Verify cleanup happened
      const sessionAfter = await storage.get("session:private123");
      expect(sessionAfter.transferToken).toBeUndefined();
    });

    it('should return null for non-existent transfer metadata', async () => {
      const result = await service.validateTransferToken(
        "nonexistent_token", 
        "target-room"
      );
      expect(result).toBeNull();
    });
  });

  describe('completeSessionTransfer', () => {
    it('should complete transfer and clean up transfer data', async () => {
      const sessionData = {
        publicId: "user123",
        created: Date.now(),
        connected: false,
        transferToken: "transfer_123_abc",
        transferData: { playerLevel: 10 },
        transferExpiry: Date.now() + 300000
      };

      await service.completeSessionTransfer("private123", sessionData);

      const updatedSession = await storage.get("session:private123");
      expect(updatedSession.publicId).toBe("user123");
      expect(updatedSession.connected).toBe(true);
      expect(updatedSession.lastRoomId).toBe("test-room");
      expect(updatedSession.transferToken).toBeUndefined();
      expect(updatedSession.transferData).toEqual({ playerLevel: 10 });
      expect(updatedSession.transferExpiry).toBeUndefined();
    });
  });

  describe('hasValidSession', () => {
    it('should return true for existing session', async () => {
      await storage.put("session:test123", { publicId: "user123" });
      
      const hasSession = await service.hasValidSession("test123");
      expect(hasSession).toBe(true);
    });

    it('should return false for non-existent session', async () => {
      const hasSession = await service.hasValidSession("nonexistent");
      expect(hasSession).toBe(false);
    });
  });

  describe('getSessionForValidation', () => {
    it('should return session data for existing session', async () => {
      const sessionData = {
        publicId: "user123",
        created: Date.now(),
        connected: true,
        state: { level: 5 }
      };
      await storage.put("session:test123", sessionData);

      const result = await service.getSessionForValidation("test123");
      expect(result).toEqual(sessionData);
    });

    it('should return null for non-existent session', async () => {
      const result = await service.getSessionForValidation("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe('Full Transfer Flow', () => {
    it('should handle complete transfer workflow', async () => {
      // 1. Create initial session
      const initialSession = {
        publicId: "player456",
        created: Date.now(),
        connected: true,
        state: { level: 7, score: 2500 }
      };
      await storage.put("session:conn456", initialSession);

      // 2. Prepare transfer
      const transferToken = await service.prepareSessionTransfer(
        "conn456",
        "game-room",
        { currentLevel: 7, achievements: ["tutorial-complete"] }
      );
      expect(transferToken).toBeDefined();

      // 3. Validate in target room service
      const targetService = new SessionTransferService(storage as any, "game-room");
      const validation = await targetService.validateTransferToken(
        transferToken!,
        "game-room"
      );
      expect(validation).toBeDefined();
      expect(validation!.privateId).toBe("conn456");
      expect(validation!.sessionData.transferData).toEqual({
        currentLevel: 7,
        achievements: ["tutorial-complete"]
      });

      // 4. Complete transfer
      await targetService.completeSessionTransfer(
        validation!.privateId,
        validation!.sessionData
      );

      // 5. Verify final state
      const finalSession = await storage.get("session:conn456");
      expect(finalSession.connected).toBe(true);
      expect(finalSession.lastRoomId).toBe("game-room");
      expect(finalSession.transferToken).toBeUndefined();
      expect(finalSession.publicId).toBe("player456");

      // 6. Verify transfer metadata was cleaned up
      const transferMetadata = await storage.get(`transfer:${transferToken}`);
      expect(transferMetadata).toBeUndefined();
    });

    it('should handle multiple concurrent transfers', async () => {
      // Setup multiple sessions
      const sessions = [
        { id: "conn1", publicId: "user1", data: { score: 100 } },
        { id: "conn2", publicId: "user2", data: { score: 200 } },
        { id: "conn3", publicId: "user3", data: { score: 300 } }
      ];

      for (const session of sessions) {
        await storage.put(`session:${session.id}`, {
          publicId: session.publicId,
          created: Date.now(),
          connected: true,
          state: session.data
        });
      }

      // Prepare transfers for all sessions
      const tokens = [];
      for (const session of sessions) {
        const token = await service.prepareSessionTransfer(
          session.id,
          "multi-room",
          session.data
        );
        tokens.push(token);
        expect(token).toBeDefined();
      }

      // Validate all transfers
      const targetService = new SessionTransferService(storage as any, "multi-room");
      for (let i = 0; i < tokens.length; i++) {
        const validation = await targetService.validateTransferToken(
          tokens[i]!,
          "multi-room"
        );
        expect(validation).toBeDefined();
        expect(validation!.privateId).toBe(sessions[i].id);
      }
    });
  });
});