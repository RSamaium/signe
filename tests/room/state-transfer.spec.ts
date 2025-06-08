import { describe, it, expect, beforeEach } from "vitest";
import { Room, Server, ServerIo, request, WorldRoom } from "../../packages/room/src";
import { signal } from "@signe/reactive";
import { sync, id } from "@signe/sync";
import { JWTAuth } from "../../packages/room/src/jwt";

class Player {
  @id() id: string;
}

@Room({ path: 'game' })
class GameRoom {
  @sync() count = signal(0);
}

const AUTH_JWT_SECRET = 'test-secret';
const SHARD_SECRET = 'shard-secret';
const baseUrl = '/parties/world/world-default';

describe('transfer-room-state', () => {
  let worldServer: Server;
  let worldRoom: WorldRoom;
  let fromServer: Server;
  let toServer: Server;
  let fromRoom: GameRoom;
  let toRoom: GameRoom;
  let jwtToken: string;

  beforeEach(async () => {
    const createGame = () => {
      const io = new ServerIo('game');
      const server = new Server(io as any);
      server.rooms = [GameRoom];
      return server;
    };

    const worldIo = new ServerIo('world-default', {
      parties: {
        fromRoom: () => createGame(),
        toRoom: () => createGame()
      },
      env: { AUTH_JWT_SECRET, SHARD_SECRET }
    });

    worldServer = new Server(worldIo as any);
    worldServer.rooms = [WorldRoom];
    await worldServer.onStart();

    fromServer = worldIo.context.parties.main.get('fromRoom').server;
    toServer = worldIo.context.parties.main.get('toRoom').server;
    await fromServer.onStart();
    await toServer.onStart();

    worldRoom = worldServer.subRoom as WorldRoom;
    fromRoom = fromServer.subRoom as GameRoom;
    toRoom = toServer.subRoom as GameRoom;

    jwtToken = await new JWTAuth(AUTH_JWT_SECRET).sign({ worlds: ['world-default'] });
  });

  it('rejects unauthorized transfers', async () => {
    const response = await request(worldServer, `${baseUrl}/transfer-room-state`, {
      method: 'POST',
      body: JSON.stringify({ fromRoomId: 'fromRoom', toRoomId: 'toRoom', state: { count: 1 } })
    });
    expect(response.status).toBe(403);
  });

  it('transfers state when authorized', async () => {
    fromRoom.count.set(2);
    const response = await request(worldServer, `${baseUrl}/transfer-room-state`, {
      method: 'POST',
      headers: { Authorization: jwtToken },
      body: JSON.stringify({ fromRoomId: 'fromRoom', toRoomId: 'toRoom', state: { count: 5 } })
    });
    expect(response.status).toBe(200);
    expect(toRoom.count()).toBe(5);
  });
});
