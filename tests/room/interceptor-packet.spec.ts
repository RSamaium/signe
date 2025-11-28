import { describe, expect, beforeEach, afterEach, vi, test } from 'vitest';
import { Server, testRoom, tick } from '../../packages/room/src';
import { id, users, sync, connected } from '@signe/sync';
import { signal } from '@signe/reactive';
import { Room } from '../../packages/room/src';

class Player {
  @id() id: string;
  @sync() name = signal('');
  @connected() connected = signal(true);
}

@Room({
  path: 'room-a',
  sessionExpiryTime: 2000,
  throttleSync: 0
})
class SourceRoom {
  @users(Player) users = signal({});

  interceptorPacket = vi.fn();
}

describe('Interceptor packet', () => {
  let server: Server;
  let room: any;
  let client: any;
  let user: any;

  beforeEach(async () => {
    const test = await testRoom(SourceRoom);
    server = test.server as Server;
    room = test.room;
    client= await test.createClient('test');
    user = await test.getServerUser(client);
  });

  afterEach(async () => {
    if (client) client.conn.close();
  });

  test('should intercept packet', async () => {
    user.name.set('Alice')
    await tick()
    expect(room.interceptorPacket).toHaveBeenCalled()
    expect(room.interceptorPacket.mock.calls[1][0].name()).toBe('Alice')
  })
})