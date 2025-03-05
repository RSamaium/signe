import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { Server, testRoom, Room } from "../../packages/room/src";
import { id, sync, users } from "@signe/sync";
import { signal } from "@signe/reactive";

class Player {
  @id() id: string;
  name = signal('');
}

@Room({
    path: "game",
    sessionExpiryTime: 1000
})
class MyRoom  {
  @sync() count = signal(0);
  @users(Player) users = signal({});
}

describe('Session', () => {
  describe('Basic session functionality', () => {
    let client: any;
    let room: MyRoom;
    let server: Server;
    let test: any;

    beforeEach(async () => {
      test = await testRoom(MyRoom);
      client = await test.createClient();
      room = test.room;
      server = test.server;
    })

    afterEach(async () => {
      client.conn.close();
    });

    it('should create a session when manually saved', async () => {
      const privateId = client.conn.id;
      const sessionExists = await server.getSession(privateId);
      expect(sessionExists).not.toBeNull();
    });

    it('should maintain session when reconnecting with the same privateId', async () => {
      const privateId = client.conn.id;
      const sessionBefore = await server.getSession(privateId);
      expect(sessionBefore).not.toBeNull();
      
      client.conn.close();

      const sessionAfter = await server.getSession(privateId);
      expect(sessionAfter).not.toBeNull();
      expect(sessionAfter?.connected).toBe(true);
    });
  });

  describe('Session expiration', () => {
    let test: any;
    let client: any;
    let room: MyRoom;
    let server: Server;
    let privateId: string;
    
    beforeEach(async () => {
      test = await testRoom(MyRoom);
      client = await test.createClient();
      room = test.room;
      server = test.server;
      privateId = client.conn.id;
    });
    
    afterEach(async () => {
      if (client && client.conn) {
        client.conn.close();
      }
    });

    it('should be able to delete session manually', async () => {
      client.conn.close();
      await server.deleteSession(privateId);
      const sessionExists = await server.getSession(privateId);
      expect(sessionExists).toBeUndefined();
    });
    
    it('should not expire session if client is still connected', async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
      const sessionExists = await server.getSession(privateId);
      expect(sessionExists).not.toBeNull();
      expect(sessionExists?.connected).toBe(true);
    });
    
    it('should not expire recently disconnected sessions', async () => {
      client.conn.close();
      await new Promise(resolve => setTimeout(resolve, 500));
      const sessionExists = await server.getSession(privateId);
      expect(sessionExists).not.toBeNull();
      expect(sessionExists?.connected).toBe(false);
    });
  });

  describe('Multi-client session behavior', () => {
    let test: any;
    let client1: any;
    let client2: any;
    let room: MyRoom;
    let server: any;
    
    beforeEach(async () => {
      test = await testRoom(MyRoom);
      client1 = await test.createClient();
      client2 = await test.createClient();
      room = test.room;
      server = test.server;
    });
    
    afterEach(async () => {
      client1.conn.close();
      client2.conn.close();
    });
    
    it('should assign different connection IDs to different clients', async () => {
      expect(client1.conn.id).not.toBe(client2.conn.id);
    });
    
    it('should create and store users in the users collection', async () => {
      const usersCount = Object.keys(room.users()).length;
      expect(usersCount).toBe(2);
    });
  });
  
  describe('User creation and restoration - observation via onJoin', () => {
    let test: any;
    let room: MyRoom;
    let server: Server;
    let onJoinCalls: any[] = [];
    
    beforeEach(async () => {
      onJoinCalls = [];
      
      class TestRoom extends MyRoom {
        async onJoin(user: Player, conn: any, ctx: any) {
          onJoinCalls.push({
            user,
            conn,
            timestamp: Date.now()
          });
        }
      }
      
      test = await testRoom(TestRoom);
      room = test.room;
      server = test.server;
    });
    
    it('should observe user parameter in onJoin when a client connects', async () => {
      const client = await test.createClient();
      
      expect(onJoinCalls.length).toBe(1);
      
      const joinInfo = onJoinCalls[0];
      expect(joinInfo.user).toBeDefined();
      expect(joinInfo.conn.id).toBe(client.conn.id);
      
      client.conn.close();
    });

    it('should observe user parameter in onJoin when a client connects and have session', async () => {
        server.subRoom.users.set({ 'testId': { id: 'testId', name: 'testName' } });
        await server['saveSession']('testId', { publicId: 'testId', connected: true });
        const client = await test.createClient('testId');
        expect(onJoinCalls.length).toBe(1);
        
        const joinInfo = onJoinCalls[0];
        expect(joinInfo.user).toBeDefined();
        expect(joinInfo.conn.id).toBe(client.conn.id);
        client.conn.close();
      });
  });
  
  describe('User state persistence', () => {
    let test: any;
    let room: MyRoom;
    let server: any;
    
    beforeEach(async () => {
      test = await testRoom(MyRoom);
      room = test.room;
      server = test.server;
    });
    
    it('should preserve user data across reconnection', async () => {
      const client = await test.createClient();
      
      const privateId = client.conn.id;
      const session = await server.getSession(privateId);
      expect(session).not.toBeNull();
      const publicId = session.publicId;
      
      const usersObj = room.users();
      const user = usersObj[publicId];
      expect(user).toBeDefined();
      
      const testName = "Test Name";
      user.name.set(testName);
      
      client.conn.close();
      
      const reconnectedClient = await test.createClient();
      reconnectedClient.conn.id = privateId;
      
      const usersObjAfter = room.users();
      expect(Object.keys(usersObjAfter)).toContain(publicId);
      
      const userAfter = usersObjAfter[publicId];
      expect(userAfter.name()).toBe(testName);
      
      reconnectedClient.conn.close();
    });
  });
});