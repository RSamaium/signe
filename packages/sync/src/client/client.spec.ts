import { describe, it, expect, vi, beforeEach } from "vitest";
import { connection } from ".";
import { load } from "@signe/sync";
import PartySocket from "partysocket";
import { TokenStorage } from "./storage";

vi.mock("partysocket");
vi.mock("./storage", () => ({
  TokenStorage: {
    saveToken: vi.fn(),
    getToken: vi.fn().mockImplementation(() => Promise.resolve("default-token"))
  }
}));

vi.mock("@signe/sync", () => ({
  load: vi.fn(),
}));

const MockPartySocket = vi.fn();
vi.mocked(PartySocket).mockImplementation((options) => {
  if (options.query && typeof options.query === 'function') {
    void options.query();
  }
  return MockPartySocket(options);
});

describe("connection", () => {
  let mockSocket;
  let eventListeners; 
  const defaultOptions = { host: "test-host" };
  
  beforeEach(() => {
    eventListeners = new Map();
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
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }),
      send: vi.fn(),
      close: vi.fn(),
    };
    
    MockPartySocket.mockReturnValue(mockSocket);
    vi.clearAllMocks();
  });

  it("should save token when receiving sync message with privateId", () => {
    const conn = connection(defaultOptions, {});
    
    const messageData = {
      type: "sync",
      value: { privateId: "test-token" }
    };
    
    const messageEvent = new MessageEvent("message", {
      data: JSON.stringify(messageData)
    });
    
    eventListeners.get("message")[0](messageEvent);
    
    expect(TokenStorage.saveToken).toHaveBeenCalledWith("test-token");
  });

  it("should create a connection with PartySocket", () => {
    const options = { ...defaultOptions, url: "test-url" };
    const roomInstance = {};
    
    const conn = connection(options, roomInstance);
    
    expect(PartySocket).toHaveBeenCalledWith(options);
    expect(conn.conn).toBe(mockSocket);
  });

  it("should handle sync messages and load data", () => {
    const roomInstance = {};
    const conn = connection(defaultOptions, roomInstance);
    
    const messageData = {
      type: "sync",
      value: { data: "test" },
    };
    
    const messageEvent = new MessageEvent("message", {
      data: JSON.stringify(messageData),
    });
    
    eventListeners.get("message")[0](messageEvent);
    
    expect(load).toHaveBeenCalledWith(roomInstance, messageData.value, true);
  });

  it("should emit messages correctly", () => {
    const conn = connection(defaultOptions, {});
    
    conn.emit("test-action", { data: "test" });
    
    expect(mockSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        action: "test-action",
        value: { data: "test" },
      })
    );
  });

  it("should register and handle custom event listeners", () => {
    const conn = connection(defaultOptions, {});
    const callback = vi.fn();
    
    conn.on("custom-event", callback);
    
    const messageData = {
      type: "custom-event",
      value: { data: "test" },
    };
    
    const messageEvent = new MessageEvent("message", {
      data: JSON.stringify(messageData),
    });
    
    eventListeners.get("message").forEach(listener => listener(messageEvent));
    
    expect(callback).toHaveBeenCalledWith(messageData.value);
  });

  it("should remove event listeners correctly", () => {
    const conn = connection(defaultOptions, {});
    const callback = vi.fn();
    
    conn.on("custom-event", callback);
    conn.off("custom-event", callback);
    
    expect(mockSocket.removeEventListener).toHaveBeenCalled();
  });

  it("should close the connection", () => {
    const conn = connection(defaultOptions, {});
    
    conn.close();
    
    expect(mockSocket.close).toHaveBeenCalled();
  });
});
