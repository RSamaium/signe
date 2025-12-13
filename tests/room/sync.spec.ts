import { beforeEach, describe, expect, it, afterEach, vi } from "vitest";
import { Server, testRoom, Room, tick } from "../../packages/room/src";
import { sync } from "@signe/sync";
import { signal } from "@signe/reactive";

@Room({
  path: "sync-test",
  throttleSync: 0
})
class AutoSyncRoom {
  @sync() count = signal(0);
  @sync() text = signal('');
}

@Room({
  path: "manual-sync-test",
  throttleSync: 0
})
class ManualSyncRoom {
  autoSync = false; // Disable automatic synchronization
  
  @sync() count = signal(0);
  @sync() text = signal('');
  @sync() score = signal(0);
}

describe('Manual Synchronization', () => {
  describe('Automatic synchronization (default behavior)', () => {
    let test: any;
    let client1: any;
    let client2: any;
    let room: AutoSyncRoom;
    let server: Server;
    
    beforeEach(async () => {
      test = await testRoom(AutoSyncRoom);
      client1 = await test.createClient();
      client2 = await test.createClient();
      room = test.room;
      server = test.server;
    });
    
    afterEach(async () => {
      if (client1 && client1.conn) client1.conn.close();
      if (client2 && client2.conn) client2.conn.close();
    });

    it('should automatically sync changes to all clients', async () => {
      const messages1: string[] = [];
      const messages2: string[] = [];
      
      client1.addEventListener('message', (msg: string) => {
        if (msg.includes('"type":"sync"')) {
          messages1.push(msg);
        }
      });
      
      client2.addEventListener('message', (msg: string) => {
        if (msg.includes('"type":"sync"')) {
          messages2.push(msg);
        }
      });

      // Make a change
      room.count.set(10);
      await tick();

      // Both clients should receive the sync message
      expect(messages1.length).toBeGreaterThan(0);
      expect(messages2.length).toBeGreaterThan(0);
      
      const sync1 = JSON.parse(messages1[messages1.length - 1]);
      const sync2 = JSON.parse(messages2[messages2.length - 1]);
      
      expect(sync1.type).toBe('sync');
      expect(sync1.value.count).toBe(10);
      expect(sync2.type).toBe('sync');
      expect(sync2.value.count).toBe(10);
    });

    it('should have autoSync enabled by default', () => {
      expect((room as any).$autoSync).toBe(true);
    });

    it('should have empty pendingSync by default', () => {
      expect((room as any).$pendingSync.size).toBe(0);
    });
  });

  describe('Manual synchronization with autoSync disabled', () => {
    let test: any;
    let client1: any;
    let client2: any;
    let room: ManualSyncRoom;
    let server: Server;
    
    beforeEach(async () => {
      test = await testRoom(ManualSyncRoom);
      client1 = await test.createClient();
      client2 = await test.createClient();
      room = test.room;
      server = test.server;
    });
    
    afterEach(async () => {
      if (client1 && client1.conn) client1.conn.close();
      if (client2 && client2.conn) client2.conn.close();
    });

    it('should not automatically sync changes when autoSync is disabled', async () => {
      const messages1: string[] = [];
      const messages2: string[] = [];
      
      client1.addEventListener('message', (msg: string) => {
        if (msg.includes('"type":"sync"')) {
          messages1.push(msg);
        }
      });
      
      client2.addEventListener('message', (msg: string) => {
        if (msg.includes('"type":"sync"')) {
          messages2.push(msg);
        }
      });

      // Clear initial sync messages
      messages1.length = 0;
      messages2.length = 0;

      // Make changes - should not trigger sync
      room.count.set(10);
      room.text.set('hello');
      await tick();

      // Clients should not receive sync messages automatically
      expect(messages1.length).toBe(0);
      expect(messages2.length).toBe(0);
    });

    it('should store changes in pendingSync when autoSync is disabled', async () => {
      expect((room as any).$autoSync).toBe(false);
      
      room.count.set(10);
      room.text.set('hello');
      await tick();

      // Changes should be stored in pendingSync
      expect((room as any).$pendingSync.size).toBeGreaterThan(0);
    });

    it('should broadcast pending changes when $applySync is called', async () => {
      const messages1: string[] = [];
      const messages2: string[] = [];
      
      client1.addEventListener('message', (msg: string) => {
        if (msg.includes('"type":"sync"')) {
          messages1.push(msg);
        }
      });
      
      client2.addEventListener('message', (msg: string) => {
        if (msg.includes('"type":"sync"')) {
          messages2.push(msg);
        }
      });

      // Clear initial sync messages
      messages1.length = 0;
      messages2.length = 0;

      // Make changes
      room.count.set(10);
      room.text.set('hello');
      room.score.set(100);
      await tick();

      // Manually trigger sync
      (room as any).$applySync();
      await tick();

      // Both clients should receive the sync message
      expect(messages1.length).toBeGreaterThan(0);
      expect(messages2.length).toBeGreaterThan(0);
      
      const sync1 = JSON.parse(messages1[messages1.length - 1]);
      const sync2 = JSON.parse(messages2[messages2.length - 1]);
      
      expect(sync1.type).toBe('sync');
      expect(sync1.value.count).toBe(10);
      expect(sync1.value.text).toBe('hello');
      expect(sync1.value.score).toBe(100);
      expect(sync2.type).toBe('sync');
      expect(sync2.value.count).toBe(10);
      expect(sync2.value.text).toBe('hello');
      expect(sync2.value.score).toBe(100);
    });

    it('should clear pendingSync after $applySync is called', async () => {
      room.count.set(10);
      room.text.set('hello');
      await tick();

      expect((room as any).$pendingSync.size).toBeGreaterThan(0);
      
      (room as any).$applySync();
      
      // pendingSync should be cleared
      expect((room as any).$pendingSync.size).toBe(0);
    });

    it('should batch multiple changes before syncing', async () => {
      const messages1: string[] = [];
      
      client1.addEventListener('message', (msg: string) => {
        if (msg.includes('"type":"sync"')) {
          messages1.push(msg);
        }
      });

      // Clear initial sync messages
      messages1.length = 0;

      // Make multiple changes
      room.count.set(1);
      await tick();
      room.count.set(2);
      await tick();
      room.count.set(3);
      await tick();
      room.text.set('final');
      await tick();

      // No sync should have happened yet
      expect(messages1.length).toBe(0);

      // Apply sync once
      (room as any).$applySync();
      await tick();

      // Should receive only one sync message with final values
      expect(messages1.length).toBe(1);
      const sync = JSON.parse(messages1[0]);
      expect(sync.value.count).toBe(3);
      expect(sync.value.text).toBe('final');
    });
  });

  describe('Runtime toggle of autoSync', () => {
    let test: any;
    let client1: any;
    let room: AutoSyncRoom;
    let server: Server;
    
    beforeEach(async () => {
      test = await testRoom(AutoSyncRoom);
      client1 = await test.createClient();
      room = test.room;
      server = test.server;
    });
    
    afterEach(async () => {
      if (client1 && client1.conn) client1.conn.close();
    });

    it('should allow toggling autoSync at runtime', async () => {
      const messages1: string[] = [];
      
      client1.addEventListener('message', (msg: string) => {
        if (msg.includes('"type":"sync"')) {
          messages1.push(msg);
        }
      });

      // Clear initial sync messages
      messages1.length = 0;

      // Initially autoSync is enabled
      expect((room as any).$autoSync).toBe(true);
      
      // Change should trigger sync
      room.count.set(10);
      await tick();
      expect(messages1.length).toBeGreaterThan(0);
      
      // Disable autoSync
      (room as any).$autoSync = false;
      messages1.length = 0;
      
      // Change should not trigger sync
      room.count.set(20);
      await tick();
      expect(messages1.length).toBe(0);
      
      // Re-enable autoSync
      (room as any).$autoSync = true;
      
      // Change should trigger sync again
      room.count.set(30);
      await tick();
      expect(messages1.length).toBeGreaterThan(0);
    });

    it('should sync pending changes when re-enabling autoSync', async () => {
      // Disable autoSync
      (room as any).$autoSync = false;
      
      // Make changes
      room.count.set(10);
      room.text.set('hello');
      await tick();
      
      expect((room as any).$pendingSync.size).toBeGreaterThan(0);
      
      // Re-enable autoSync
      (room as any).$autoSync = true;
      
      // Next change should trigger sync and include pending changes
      const messages1: string[] = [];
      client1.addEventListener('message', (msg: string) => {
        if (msg.includes('"type":"sync"')) {
          messages1.push(msg);
        }
      });
      
      room.count.set(20);
      await tick();
      
      // Should receive sync with latest value
      expect(messages1.length).toBeGreaterThan(0);
    });
  });

  describe('$applySync with no pending changes', () => {
    let test: any;
    let client1: any;
    let client2: any;
    let room: ManualSyncRoom;
    let server: Server;
    
    beforeEach(async () => {
      test = await testRoom(ManualSyncRoom);
      client1 = await test.createClient();
      client2 = await test.createClient();
      room = test.room;
      server = test.server;
    });
    
    afterEach(async () => {
      if (client1 && client1.conn) client1.conn.close();
      if (client2 && client2.conn) client2.conn.close();
    });

    it('should broadcast current state when $applySync is called with no pending changes', async () => {
      // Set some initial state
      room.count.set(5);
      room.text.set('initial');
      await tick();
      
      // Apply sync to set initial state
      (room as any).$applySync();
      await tick();
      
      // Clear pending changes
      (room as any).$pendingSync.clear();
      
      const messages1: string[] = [];
      client1.addEventListener('message', (msg: string) => {
        if (msg.includes('"type":"sync"')) {
          messages1.push(msg);
        }
      });
      
      // Call $applySync with no pending changes
      (room as any).$applySync();
      await tick();
      
      // Should still broadcast current state from memory
      expect(messages1.length).toBeGreaterThan(0);
      const sync = JSON.parse(messages1[messages1.length - 1]);
      expect(sync.type).toBe('sync');
      expect(sync.value.count).toBe(5);
      expect(sync.value.text).toBe('initial');
    });
  });
});
