import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Server, ServerIo, testRoom } from '../../packages/room/src';
import { id, users, sync, connected } from '@signe/sync';
import { signal } from '@signe/reactive';

class Player {
  @id() id: string;
  @sync() name = signal('');
  @connected() connected = signal(true);
}

// Source room (origin)
import { Room } from '../../packages/room/src';

@Room({
  path: 'room-a',
  sessionExpiryTime: 2000
})
class SourceRoom {
  @users(Player) users = signal({});
}

// Target room (destination)
@Room({
  path: 'room-b',
  sessionExpiryTime: 2000
})
class TargetRoom {
  @users(Player) users = signal({});
}

describe('Session transfer between rooms', () => {
  let serverA: Server;
  let roomA: any;
  let clientA: any;

  beforeEach(async () => {
    const test = await testRoom(SourceRoom, {
      // Create servers dynamically for any lobby id using the same rooms set
      partyFn: async (lobbyId) => {
        const s = new Server(new ServerIo(lobbyId) as any);
        s.rooms = [SourceRoom, TargetRoom];
        await s.onStart()
        return s;
      }
    });
    serverA = test.server as Server;
    roomA = test.room;
    clientA = await test.createClient();
  });

  afterEach(async () => {
    if (clientA) clientA.conn.close();
  });

  it('should transfer session and user data from room-a to room-b', async () => {
    // Get publicId for client in room-a
    const privateIdA = clientA.conn.id;
    const sessionA = await serverA.getSession(privateIdA);
    expect(sessionA).not.toBeNull();
    const publicId = sessionA!.publicId;

    // Update user state on room-a
    const userA = roomA.users()[publicId];
    expect(userA).toBeDefined();
    userA.name.set('Alice');

    // Request transfer to room-b
    const transferToken = await (serverA as any).subRoom.$sessionTransfer(clientA.conn, 'room-b');
    expect(transferToken).toBeTruthy();

    // Connect to room-b using the transfer token
    const lobbyB = await (serverA as any).room.context.parties.main.get('room-b');
    const room = lobbyB.server.room;
    const serverB = lobbyB.server;
    const clientB = await room.connection(serverB);

    try {
      // Validate that the session in room-b is established under the original privateId
      const sessionB = await serverB.getSession(privateIdA);
      expect(sessionB).not.toBeUndefined();
      expect(sessionB!.publicId).toBe(publicId);

      // Validate that user data has been restored in room-b
      const roomB = (serverB as any).subRoom;
      const userB = roomB.users()[publicId];
      expect(userB).toBeDefined();
      expect(userB.name()).toBe('Alice');

      // Ensure the new connection's private id is different from the session key (we used original privateId)
      expect(clientB.conn.id).not.toBe(privateIdA);
    } finally {
      clientB.conn.close();
    }
  });
});


