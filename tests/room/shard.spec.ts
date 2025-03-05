import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Server, testRoom, Room, request, Request } from "../../packages/room/src";
import { sync } from "@signe/sync";
import { signal } from "@signe/reactive";
import { Shard } from "../../packages/room/src/shard";

// Replace updateWorldStats method with a mock to avoid errors
const originalUpdateWorldStats = Shard.prototype.updateWorldStats;
beforeEach(() => {
  Shard.prototype.updateWorldStats = vi.fn().mockResolvedValue(true);
});

afterEach(() => {
  Shard.prototype.updateWorldStats = originalUpdateWorldStats;
});

@Room({
    path: "game"
})
class MyRoom {
  @sync() count = signal(0);

  onJoin(user: any, connection: any) {
    // Method called when a client joins
  }

  onMessage(message: any, sender: any) {
    // Method called for messages
    if (message.type === "increment") {
      this.count.update(val => val + 1);
    } else if (message.type === "reset") {
      this.count.set(0);
    }
  }

  // HTTP endpoint
  @Request({
    path: '/count',
    method: 'GET'
  })
  getCount(req: any) {
    return { count: this.count() };
  }
}

describe('ShardTests', () => {
  describe('Shard Message Forwarding to MainServerStub', () => {
    let server: Shard;
    let client: any;
    let mainServerStub: any;

    beforeEach(async () => {
      const test = await testRoom(MyRoom, { 
        shard: true,
        env: { SHARD_SECRET: 'test-secret' }
      });
      server = test.server as Shard;
      client = await test.createClient();
      
      // Access the mainServerStub from the shard
      mainServerStub = server.mainServerStub;
      
      // Ensure mainServerStub exists
      expect(mainServerStub).toBeDefined();
    });

    it('should forward client messages to mainServerStub', async () => {
      // Spy on the socket.send method of the mainServerStub
      const wsSendSpy = vi.spyOn(server.ws, 'send');
      
      // Send a message from client to shard
      const message = { type: "test-message", data: "hello" };
      await client.send(message);
      
      // Verify the message was forwarded to mainServerStub (via WebSocket)
      expect(wsSendSpy).toHaveBeenCalled();
      
      // Verify the forwarded message format
      const forwardedMessage = JSON.parse(wsSendSpy.mock.calls[0][0] as string);
      
      // Check that the message follows the correct structure
      expect(forwardedMessage).toHaveProperty('type');
      expect(forwardedMessage.type).toBe('shard.clientMessage');
      expect(forwardedMessage).toHaveProperty('privateId');
      expect(forwardedMessage).toHaveProperty('payload');
      
      // Verify the original message is preserved in the payload
      expect(forwardedMessage.payload).toEqual(message);
    });

    it('should correctly handle HTTP requests through shard to main server', async () => {
      const response = await request(server, '/parties/shard/default/count', { method: 'GET' });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.count).toBe(0);
    });
  });
});