import { beforeEach, describe, expect, it, vi } from "vitest";
import { Server, testRoom, Room, Request, Action, Guard } from "../../packages/room/src";
import { sync } from "@signe/sync";
import { signal } from "@signe/reactive";
import { z } from "zod";

// Mock guard function for testing
const mockGuard = vi.fn().mockReturnValue(true);
const mockRejectGuard = vi.fn().mockReturnValue(false);

// Define test room with request handlers
@Room({
    path: "api"
})
class ApiRoom {
  @sync() count = signal(0);
  @sync() users = signal<Record<string, { name: string; score: number }>>({
    "user1": { name: "User One", score: 100 },
    "user2": { name: "User Two", score: 200 },
  });
  
  // Basic GET request
  @Request({ path: "/status" })
  getStatus(req: any) {
    return {
      status: "online",
      count: this.count(),
      usersCount: Object.keys(this.users()).length
    };
  }
  
  // Request with path parameters
  @Request({ path: "/users/:id" })
  getUser(req: any, body: any, params: { id: string }) {
    const user = this.users()[params.id];
    if (!user) {
      return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
    }
    return user;
  }
  
  // POST request with body validation
  @Request(
    { path: "/increment", method: "POST" },
    z.object({ amount: z.number().min(1).max(10) })
  )
  increment(req: any, body: { amount: number }) {
    this.count.update(c => c + body.amount);
    return { success: true, newCount: this.count() };
  }
  
  // Request with guard
  @Request({ path: "/protected" })
  @Guard([mockGuard])
  protected(req: any) {
    return { access: "granted" };
  }
  
  // Request with rejecting guard
  @Request({ path: "/rejected" })
  @Guard([mockRejectGuard])
  rejected(req: any) {
    return { access: "granted" }; // This should never be reached
  }
  
  // Request returning plain text
  @Request({ path: "/text" })
  getText() {
    return "This is plain text";
  }
  
  // Request returning a custom Response
  @Request({ path: "/custom-response" })
  getCustomResponse() {
    return new Response("Custom response body", {
      status: 201,
      headers: {
        "Content-Type": "text/plain",
        "X-Custom-Header": "test-value"
      }
    });
  }
}

// Create mock request for testing
function createMockRequest(path: string, options?: any): any {
  const fullUrl = `http://localhost/parties/world/default${path}`;
  
  const req = {
    // This is the critical part - we need a full URL string that can be parsed with new URL()
    url: fullUrl,
    method: options?.method || 'GET',
    headers: new Headers(options?.headers || {}),
    json: async () => {
      if (options?.body) {
        return JSON.parse(options.body);
      }
      return undefined;
    },
    clone: function() {
      return createMockRequest(path, options);
    },
    text: async () => {
      return options?.body || '';
    }
  };
  
  return req;
}

describe('Request Decorator', () => {
  let server: any;
  let room: ApiRoom;
  
  beforeEach(async () => {
    const test = await testRoom(ApiRoom);
    room = test.room;
    server = test.server;
    
    // Reset mock functions
    mockGuard.mockClear();
    mockRejectGuard.mockClear();
  });
  
  it('should route basic GET request correctly', async () => {
    // Create mock request
    const mockReq = createMockRequest("/status");
    
    // Process the request
    const response = await server.onRequest(mockReq);
    
    // Verify response
    expect(response.status).toBe(200);
    const responseData = await response.json();
    expect(responseData).toEqual({
      status: "online",
      count: 0,
      usersCount: 2
    });
  });
  
  it('should handle path parameters correctly', async () => {
    // Test existing user
    const userReq = createMockRequest("/users/user1");
    const userResponse = await server.onRequest(userReq);
    expect(userResponse.status).toBe(200);
    const userData = await userResponse.json();
    expect(userData).toEqual({ name: "User One", score: 100 });
    
    // Test non-existing user
    const notFoundReq = createMockRequest("/users/nonexistent");
    const notFoundResponse = await server.onRequest(notFoundReq);
    expect(notFoundResponse.status).toBe(404);
    const errorData = await notFoundResponse.json();
    expect(errorData).toEqual({ error: "User not found" });
  });
  
  it('should validate request body with Zod schema', async () => {
    // Valid request
    const validReq = createMockRequest("/increment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 5 })
    });
    
    const validResponse = await server.onRequest(validReq);
    expect(validResponse.status).toBe(200);
    const validData = await validResponse.json();
    expect(validData).toEqual({ success: true, newCount: 5 });
    expect(room.count()).toBe(5);
    
    // Invalid request - amount too high
    const invalidReq = createMockRequest("/increment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 20 })
    });
    
    const invalidResponse = await server.onRequest(invalidReq);
    expect(invalidResponse.status).toBe(400);
    const invalidData = await invalidResponse.json();
    expect(invalidData.error).toBe("Invalid request body");
  });
  
  it('should respect request guards', async () => {
    // Protected route with successful guard
    const protectedReq = createMockRequest("/protected");
    const protectedResponse = await server.onRequest(protectedReq);
    
    expect(mockGuard).toHaveBeenCalled();
    expect(protectedResponse.status).toBe(200);
    const protectedData = await protectedResponse.json();
    expect(protectedData).toEqual({ access: "granted" });
    
    // Route with rejecting guard
    const rejectedReq = createMockRequest("/rejected");
    const rejectedResponse = await server.onRequest(rejectedReq);
    
    expect(mockRejectGuard).toHaveBeenCalled();
    expect(rejectedResponse.status).toBe(403);
    const rejectedData = await rejectedResponse.json();
    expect(rejectedData).toEqual({ error: "Unauthorized" });
  });
  
  it('should handle different content types correctly', async () => {
    // Text response
    const textReq = createMockRequest("/text");
    const textResponse = await server.onRequest(textReq);
    
    expect(textResponse.status).toBe(200);
    expect(textResponse.headers.get("Content-Type")).toBe("text/plain");
    const textData = await textResponse.text();
    expect(textData).toBe("This is plain text");
    
    // Custom response
    const customReq = createMockRequest("/custom-response");
    const customResponse = await server.onRequest(customReq);
    
    expect(customResponse.status).toBe(201);
    expect(customResponse.headers.get("Content-Type")).toBe("text/plain");
    expect(customResponse.headers.get("X-Custom-Header")).toBe("test-value");
    const customData = await customResponse.text();
    expect(customData).toBe("Custom response body");
  });
  
  it('should return 404 for non-existing routes', async () => {
    const notFoundReq = createMockRequest("/non-existing-route");
    const notFoundResponse = await server.onRequest(notFoundReq);
    
    expect(notFoundResponse.status).toBe(404);
    const notFoundData = await notFoundResponse.json();
    expect(notFoundData).toEqual({ error: "Not found" });
  });
});
