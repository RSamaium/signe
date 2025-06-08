import { describe, it, expect, beforeEach } from "vitest";
import { Room, Server, ServerIo, request, WorldRoom } from "../../packages/room/src";
import { signal } from "@signe/reactive";
import { id, users } from "@signe/sync";
import { JWTAuth } from "../../packages/room/src/jwt";

class Player {
  @id() id: string;
}

@Room({ path: 'game', sessionExpiryTime: 1000 })
class GameRoom {
  @users(Player) users = signal({});
}

const AUTH_JWT_SECRET = 'test-secret';
const SHARD_SECRET = 'shard-secret';
const baseUrl = '/parties/world/world-default';

describe('transfer-user-session', () => {
  let worldServer: Server;
  let fromServer: Server;
  let toServer: Server;
  let worldIo: any;
  let jwtToken: string;

  beforeEach(async () => {
    const createGame = () => {
      const io = new ServerIo('game');
      const server = new Server(io as any);
      server.rooms = [GameRoom];
      return server;
    };

    worldIo = new ServerIo('world-default', {
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

    jwtToken = await new JWTAuth(AUTH_JWT_SECRET).sign({ worlds: ['world-default'] });
  });

  it('rejects unauthorized session transfers', async () => {
    const response = await request(worldServer, `${baseUrl}/transfer-user-session`, {
      method: 'POST',
      body: JSON.stringify({ fromRoomId: 'fromRoom', toRoomId: 'toRoom', sessionId: 's1' })
    });
    expect(response.status).toBe(403);
  });

  it('transfers session when authorized', async () => {
    const client = await worldIo.connection(fromServer, 's1');
    const session = await fromServer.getSession(client.id);
    const publicId = session!.publicId;

    const response = await request(worldServer, `${baseUrl}/transfer-user-session`, {
      method: 'POST',
      headers: { Authorization: jwtToken },
      body: JSON.stringify({ fromRoomId: 'fromRoom', toRoomId: 'toRoom', sessionId: client.id })
    });
    expect(response.status).toBe(200);

    const transferredSession = await toServer.getSession(client.id);
    expect(transferredSession).not.toBeNull();
    expect(transferredSession!.publicId).toBe(publicId);

    const toRoom = toServer.subRoom as GameRoom;
    expect(toRoom.users()[publicId]).toBeDefined();
  });
});
