import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { Server, testRoom, Room } from "../../packages/room/src";
import { id, sync, users, connected } from "@signe/sync";
import { signal } from "@signe/reactive";

class ConnectedPlayer {
  @id() id = signal('');
  @connected() isConnected = signal(false);
  name = signal('');
}
 
@Room({
  path: "users-test",
  sessionExpiryTime: 1000
})
class ConnectedRoom {
  @sync() count = signal(0);
  @users(ConnectedPlayer) users = signal({});
}

describe('Users Connection State', () => {
  describe('Connection status tracking', () => {
    let test: any;
    let client: any;
    let room: ConnectedRoom;
    let server: Server;
    
    beforeEach(async () => {
      test = await testRoom(ConnectedRoom);
      client = await test.createClient();
      room = test.room;
      server = test.server;
    });
    
    afterEach(async () => {
      if (client && client.conn) {
        client.conn.close();
      }
    });

    it('should mark user as connected when they join', async () => {
      // Get the user's public ID
      const privateId = client.conn.id;
      const session = await server.getSession(privateId);
      expect(session).not.toBeNull();
      
      const publicId = session!.publicId;
      const user = room.users()[publicId];
  
      // Check if the user is marked as connected
      expect(user).toBeDefined();
      expect(user.isConnected()).toBe(true);
    });
    
    it('should mark user as disconnected when they leave', async () => {
      // Get the user's public ID
      const privateId = client.conn.id;
      const session = await server.getSession(privateId);
      const publicId = session!.publicId;
      
      // Check initial state
      expect(room.users()[publicId].isConnected()).toBe(true);
      
      // Disconnect the client
      client.conn.close();
      
      // Wait for disconnection to be processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if the user is marked as disconnected
      expect(room.users()[publicId].isConnected()).toBe(false);
    });
  });
  
  describe('Multiple users connection state', () => {
    let test: any;
    let client1: any;
    let client2: any;
    let room: ConnectedRoom;
    let server: Server;
    
    beforeEach(async () => {
      test = await testRoom(ConnectedRoom);
      client1 = await test.createClient();
      client2 = await test.createClient();
      room = test.room;
      server = test.server;
    });
    
    afterEach(async () => {
      if (client1 && client1.conn) client1.conn.close();
      if (client2 && client2.conn) client2.conn.close();
    });
    
    it('should track connection state independently for each user', async () => {
      // Get users' public IDs
      const session1 = await server.getSession(client1.conn.id);
      const session2 = await server.getSession(client2.conn.id);
      
      const publicId1 = session1!.publicId;
      const publicId2 = session2!.publicId;
      
      // Check initial states
      expect(room.users()[publicId1].isConnected()).toBe(true);
      expect(room.users()[publicId2].isConnected()).toBe(true);
      
      // Disconnect one client
      client1.conn.close();
      
      // Wait for disconnection to be processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check that only the disconnected client changed state
      expect(room.users()[publicId1].isConnected()).toBe(false);
      expect(room.users()[publicId2].isConnected()).toBe(true);
    });
  });
  
  describe('Connection state lifecycle hooks', () => {
    let test: any;
    let room: ConnectedRoom;
    let server: Server;
    let onJoinCalls: any[] = [];
    let onLeaveCalls: any[] = [];
    
    beforeEach(async () => {
      onJoinCalls = [];
      onLeaveCalls = [];
      
      class TestConnectedRoom extends ConnectedRoom {
        async onJoin(user: ConnectedPlayer, conn: any, ctx: any) {
          onJoinCalls.push({
            user,
            conn,
            isConnected: user.isConnected(),
            timestamp: Date.now()
          });
        }
        
        async onLeave(user: ConnectedPlayer, conn: any) {
          onLeaveCalls.push({
            user,
            conn,
            isConnected: user.isConnected(),
            timestamp: Date.now()
          });
        }
      }
      
      test = await testRoom(TestConnectedRoom);
      room = test.room;
      server = test.server;
    });
    
    it('should have correct connection state in lifecycle hooks', async () => {
      // Connect a client
      const client = await test.createClient();
      
      // Check onJoin call
      expect(onJoinCalls.length).toBe(1);
      expect(onJoinCalls[0].isConnected).toBe(true);
      
      // Disconnect the client
      client.conn.close();
      
      // Wait for disconnection to be processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check onLeave call
      expect(onLeaveCalls.length).toBe(1);
      expect(onLeaveCalls[0].isConnected).toBe(false);
    });
  });
  
  describe('Reconnection behavior', () => {
    let test: any;
    let room: ConnectedRoom;
    let server: Server;
    
    beforeEach(async () => {
      test = await testRoom(ConnectedRoom);
      room = test.room;
      server = test.server;
    });
    
    it('should update connection state when user reconnects', async () => {
      // Connect a client
      const client = await test.createClient();
      const privateId = client.conn.id;
      
      // Get public ID
      const session = await server.getSession(privateId);
      const publicId = session!.publicId;
      
      // Check initial state
      expect(room.users()[publicId].isConnected()).toBe(true);
      
      // Disconnect the client
      client.conn.close();
      
      // Wait for disconnection to be processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check disconnected state
      expect(room.users()[publicId].isConnected()).toBe(false);
      
      // Reconnect with same session ID
      const reconnectedClient = await test.createClient(privateId);
      
      // Wait for reconnection to be processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check reconnected state
      expect(room.users()[publicId].isConnected()).toBe(true);
      
      // Clean up
      reconnectedClient.conn.close();
    });
  });
});
