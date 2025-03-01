import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectionRoom, connectionWorld, WorldConnectionOptions } from "../src/client";
import { load } from "@signe/sync";
import PartySocket from "partysocket";
import { TokenStorage } from "../src/client/storage";

// Mock all dependencies
vi.mock("partysocket");
vi.mock("../src/client/storage", () => ({
  TokenStorage: {
    saveToken: vi.fn(),
    getToken: vi.fn().mockReturnValue(Promise.resolve("default-token"))
  }
}));

vi.mock("@signe/sync", () => ({
  load: vi.fn(),
}));

// Mock location
const mockLocation = { origin: "https://test-origin.com" };
// Utiliser global au lieu de window avec assertion de type pour éviter les erreurs TypeScript
global.location = mockLocation as unknown as Location;

describe("Sync Client", () => {
  // Common test elements
  let mockSocket;
  let eventListeners;
  let originalFetch;
  
  // Sets up common test elements before each test
  beforeEach(() => {
    // Save original fetch
    originalFetch = global.fetch;
    
    // Reset mocks
    vi.clearAllMocks();
    
    // Set up event listeners collection
    eventListeners = new Map();
    
    // Mock PartySocket instance
    mockSocket = {
      addEventListener: vi.fn((event, callback) => {
        if (!eventListeners.has(event)) {
          eventListeners.set(event, []);
        }
        eventListeners.get(event).push(callback);
      }),
      removeEventListener: vi.fn((event, callback) => {
        const listeners = eventListeners.get(event) || [];
        const index = listeners.indexOf(callback);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }),
      send: vi.fn(),
      close: vi.fn(),
    };
    
    // Configure mock implementation
    vi.mocked(PartySocket).mockImplementation((options) => {
      if (options.query && typeof options.query === 'function') {
        void options.query();
      }
      return mockSocket;
    });
    
    // Mock fetch par défaut
    global.fetch = vi.fn().mockImplementation(() => 
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        statusText: "OK",
        type: "basic" as ResponseType,
        url: "",
        redirected: false,
        body: null,
        bodyUsed: false,
        clone: () => ({} as Response),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({
          shardId: "test-shard-1",
          url: "wss://test-shard-1.example.com"
        })
      } as Response)
    );
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  /**
   * Tests for the standard connection function
   */
  describe("connection", () => {
    const defaultOptions = { host: "test-host" };
    
    it("should create a connection with PartySocket using provided options", async () => {
      const options = { ...defaultOptions, url: "test-url" };
      const roomInstance = {};
      
      const conn = await connectionRoom(options, roomInstance);
      
      expect(PartySocket).toHaveBeenCalledWith(options);
      expect(conn.conn).toBe(mockSocket);
    });

    it("should set up message handling for sync messages", async () => {
      const roomInstance = {};
      await connectionRoom(defaultOptions, roomInstance);
      
      // Simulate receiving a sync message
      const messageData = {
        type: "sync",
        value: { data: "test-data" },
      };
      
      const messageEvent = new MessageEvent("message", {
        data: JSON.stringify(messageData),
      });
      
      // Call the message event handler
      eventListeners.get("message")[0](messageEvent);
      
      // Verify the load function was called with correct parameters
      expect(load).toHaveBeenCalledWith(roomInstance, messageData.value, true);
    });

    it("should ignore non-sync messages in the default handler", async () => {
      const roomInstance = {};
      await connectionRoom(defaultOptions, roomInstance);
      
      // Simulate receiving a non-sync message
      const messageData = {
        type: "not-sync",
        value: { data: "test-data" },
      };
      
      const messageEvent = new MessageEvent("message", {
        data: JSON.stringify(messageData),
      });
      
      // Call the message event handler
      eventListeners.get("message")[0](messageEvent);
      
      // Verify the load function was not called
      expect(load).not.toHaveBeenCalled();
    });

    it("should emit messages with correct format", async () => {
      const conn = await connectionRoom(defaultOptions, {});
      
      // Emit a test message
      conn.emit("test-action", { data: "test" });
      
      // Verify the send method was called with correctly formatted JSON
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          action: "test-action",
          value: { data: "test" },
        })
      );
    });

    it("should register event listeners properly", async () => {
      const conn = await connectionRoom(defaultOptions, {});
      const callback = vi.fn();
      
      // Register a callback
      conn.on("custom-event", callback);
      
      // Verify an event listener was added
      expect(mockSocket.addEventListener).toHaveBeenCalledTimes(2); // Initial + our new one
      
      // Simulate receiving a matching event
      const messageData = {
        type: "custom-event",
        value: { data: "test" },
      };
      
      const messageEvent = new MessageEvent("message", {
        data: JSON.stringify(messageData),
      });
      
      // Call all message handlers
      eventListeners.get("message").forEach(listener => listener(messageEvent));
      
      // Verify our callback was called with the correct data
      expect(callback).toHaveBeenCalledWith(messageData.value);
    });

    it("should not trigger listeners for non-matching events", async () => {
      const conn = await connectionRoom(defaultOptions, {});
      const callback = vi.fn();
      
      // Register a callback
      conn.on("custom-event", callback);
      
      // Simulate receiving a non-matching event
      const messageData = {
        type: "different-event",
        value: { data: "test" },
      };
      
      const messageEvent = new MessageEvent("message", {
        data: JSON.stringify(messageData),
      });
      
      // Call all message handlers
      eventListeners.get("message").forEach(listener => listener(messageEvent));
      
      // Verify our callback was not called
      expect(callback).not.toHaveBeenCalled();
    });

    it("should remove event listeners correctly", async () => {
      const conn = await connectionRoom(defaultOptions, {});
      const callback = vi.fn();
      
      // Register and then remove a callback
      conn.on("custom-event", callback);
      conn.off("custom-event", callback);
      
      // Verify removeEventListener was called
      expect(mockSocket.removeEventListener).toHaveBeenCalled();
    });

    it("should close the connection", async () => {
      const conn = await connectionRoom(defaultOptions, {});
      
      // Close the connection
      conn.close();
      
      // Verify the close method was called
      expect(mockSocket.close).toHaveBeenCalled();
    });
  });

  /**
   * Tests for the World-based connection function
   */
  describe("connectionWorld", () => {
    const worldOptions: WorldConnectionOptions = {
      worldUrl: "https://world.example.com",
      roomId: "test-room",
      worldId: "test-world",
      autoCreate: true,
      // Utiliser un délai court pour accélérer les tests
      retryDelay: 1
    };

    it("should get shard info and create connection", async () => {
      const roomInstance = {};
      
      const conn = await connectionWorld(worldOptions, roomInstance);
      
      // Verify fetch was called with correct URL and parameters
      expect(fetch).toHaveBeenCalledWith(
        "https://world.example.com/parties/world/test-world/connect",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            roomId: "test-room",
            autoCreate: true
          })
        })
      );
      
      // Verify PartySocket was created with correct options
      expect(PartySocket).toHaveBeenCalledWith(expect.objectContaining({
        host: "https://test-origin.com",
        party: "shard",
        room: "wss://test-shard-1.example.com"
      }));
      
      // Verify connection result has shard info
      expect(conn.shardInfo).toEqual({
        shardId: "test-shard-1",
        url: "wss://test-shard-1.example.com"
      });
    });

    it("should apply custom socket options", async () => {
      const roomInstance = {};
      const customOptions: WorldConnectionOptions = {
        ...worldOptions,
        socketOptions: {
          protocols: ["custom-protocol"],
          query: () => ({ token: "custom-token" })
        }
      };
      
      await connectionWorld(customOptions, roomInstance);
      
      // Verify PartySocket was created with merged options
      expect(PartySocket).toHaveBeenCalledWith(expect.objectContaining({
        host: "https://test-origin.com",
        party: "shard",
        room: "wss://test-shard-1.example.com",
        protocols: ["custom-protocol"]
      }));
      
      // Verify query function was called
      expect(PartySocket).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(Function)
        })
      );
    });

    it("should handle server errors during shard retrieval", async () => {
      // Mock global fetch pour ce test spécifique avec une erreur 500
      global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({ error: "Server error" }),
        headers: new Headers(),
        type: "basic" as ResponseType,
        url: "",
        redirected: false,
        body: null,
        bodyUsed: false,
        clone: () => ({} as Response),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        text: () => Promise.resolve("")
      } as Response));
      
      const roomInstance = {};
      
      // Attempt to connect should fail
      await expect(() => connectionWorld({
        ...worldOptions,
        retryCount: 1  // Réduire le nombre de tentatives pour accélérer le test
      }, roomInstance)).rejects.toThrow("World service returned 500: Server error");
    });

    it("should handle invalid server responses", async () => {
      // Mock global fetch pour ce test spécifique avec une réponse invalide
      global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ status: "OK" }), // Missing url and shardId
        headers: new Headers(),
        type: "basic" as ResponseType,
        url: "",
        redirected: false,
        body: null,
        bodyUsed: false,
        clone: () => ({} as Response),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        text: () => Promise.resolve("")
      } as Response));
      
      const roomInstance = {};
      
      // Attempt to connect should fail
      await expect(() => connectionWorld({
        ...worldOptions,
        retryCount: 1  // Réduire le nombre de tentatives pour accélérer le test
      }, roomInstance)).rejects.toThrow("Invalid response from World service: missing url or shardId");
    });

    it("should retry failed connections according to configuration", async () => {
      // First attempt fails with network error, second succeeds
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockImplementationOnce(() => Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({
            shardId: "test-shard-1",
            url: "wss://test-shard-1.example.com"
          }),
          headers: new Headers(),
          type: "basic" as ResponseType,
          url: "",
          redirected: false,
          body: null,
          bodyUsed: false,
          clone: () => ({} as Response),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          blob: () => Promise.resolve(new Blob()),
          formData: () => Promise.resolve(new FormData()),
          text: () => Promise.resolve("")
        } as Response));
      
      // Configure retry options
      const retryOptions: WorldConnectionOptions = {
        ...worldOptions,
        retryCount: 2,
        retryDelay: 1 // 1ms for fast tests
      };
      
      const roomInstance = {};
      
      // Connect should eventually succeed
      const conn = await connectionWorld(retryOptions, roomInstance);
      
      // Verify fetch was called twice
      expect(fetch).toHaveBeenCalledTimes(2);
      
      // Verify we got a valid connection
      expect(conn.shardInfo).toEqual({
        shardId: "test-shard-1",
        url: "wss://test-shard-1.example.com"
      });
    });

    it("should fail after exhausting retry attempts", async () => {
      // All attempts fail with network error
      const networkError = new Error("Persistent network error");
      global.fetch = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError);
      
      // Configure retry options
      const retryOptions: WorldConnectionOptions = {
        ...worldOptions,
        retryCount: 2,
        retryDelay: 1 // 1ms for fast tests
      };
      
      const roomInstance = {};
      
      // Wait for the connection to fail
      await expect(connectionWorld(retryOptions, roomInstance))
        .rejects.toThrow("Persistent network error");
      
      // Verify fetch was called the expected number of times
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("should use default world ID if not specified", async () => {
      const optionsWithoutWorldId: WorldConnectionOptions = {
        worldUrl: "https://world.example.com",
        roomId: "test-room",
        retryDelay: 1, // 1ms pour accélérer les tests
        // No worldId specified
      };
      
      const roomInstance = {};
      
      await connectionWorld(optionsWithoutWorldId, roomInstance);
      
      // Verify fetch was called with the default worldId
      expect(fetch).toHaveBeenCalledWith(
        "https://world.example.com/parties/world/world-default/connect",
        expect.anything()
      );
    });

    it("should handle missing required options", async () => {
      const incompleteOptions = {
        // Missing worldUrl
        roomId: "test-room"
      } as WorldConnectionOptions;
      
      const roomInstance = {};
      
      // Attempt to connect should fail
      await expect(connectionWorld(incompleteOptions, roomInstance))
        .rejects.toThrow("Missing required World connection options");
    });
  });
  
  /**
   * Tests for TokenStorage
   */
  describe("TokenStorage", () => {
    it("should save tokens", async () => {
      await TokenStorage.saveToken("new-token");
      
      expect(TokenStorage.saveToken).toHaveBeenCalledWith("new-token");
    });
    
    it("should retrieve tokens", async () => {
      const mockToken = "default-token";
      vi.mocked(TokenStorage.getToken).mockResolvedValueOnce(mockToken);
      
      const token = await TokenStorage.getToken();
      
      expect(TokenStorage.getToken).toHaveBeenCalled();
      expect(token).toBe(mockToken);
    });
  });
});
