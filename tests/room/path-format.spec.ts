import { afterEach, describe, expect, it } from "vitest";
import { Room, testRoom, tick } from "../../packages/room/src";
import { MockConnection } from "../../packages/room/src/mock";
import { decodeMessage, event, id, load, sync, users, PathTableDecoder } from "@signe/sync";
import { signal } from "@signe/reactive";

// Record what each connection receives from its very first message (the initial sync is
// sent while the client is connecting).
const sentTo = new Map<string, any[]>();
const originalSend = MockConnection.prototype.send;
MockConnection.prototype.send = function (data: any) {
  const list = sentTo.get(this.id) ?? [];
  list.push(data);
  sentTo.set(this.id, list);
  return originalSend.call(this, data);
};

class Player {
  @id() id = signal("");
  @sync() x = signal(0);
  @sync() name = signal("");
}

@Room({ path: "paths-broadcast" })
class BroadcastRoom {
  @users(Player) players = signal<Record<string, Player>>({});
  @sync() score = signal(0);
  @sync() meta = signal<Record<string, any>>({});
  @sync() hit = event<{ damage: number }>();
}

@Room({ path: "paths-compressed", compression: { threshold: 1 } })
class CompressedRoom {
  @users(Player) players = signal<Record<string, Player>>({});
  @sync() score = signal(0);
}

@Room({ path: "paths-intercept" })
class InterceptRoom {
  @users(Player) players = signal<Record<string, Player>>({});
  @sync() score = signal(0);
  interceptorPacket(_user: any, packet: any, conn: any) {
    if (packet.type !== "sync") return packet;
    return { ...packet, value: { ...packet.value, me: conn.state?.publicId } };
  }
}

let visibleOnlySelf = false;
@Room({ path: "paths-visibility" })
class VisibilityRoom {
  @users(Player) players = signal<Record<string, Player>>({});
  @sync() score = signal(0);
  frame = 0;
  syncVisibility(_user: any, conn: any) {
    const me = conn.state?.publicId;
    return { players: visibleOnlySelf ? [me] : Object.keys(this.players()) };
  }
  syncPacketHeader(_user: any, conn: any) {
    return { ack: { frame: this.frame } };
  }
}

/** Client side state, like the room's synced properties. */
class ClientState {
  @sync(Player) players = signal<Record<string, Player>>({});
  @sync() score = signal(0);
  @sync() meta = signal<Record<string, any>>({});
  @sync() me = signal("");
  @sync() ack = signal<any>({});
  @sync() pId = signal("");
}

const snapshot = (value: any): any => {
  if (typeof value === "function" && value.observable) return snapshot(value());
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(snapshot);
  const out: Record<string, any> = {};
  for (const key of Object.keys(value)) {
    if (key.startsWith("$")) continue;
    out[key.startsWith("__") ? key.slice(2) : key] = snapshot(value[key]);
  }
  return out;
};

/** Applies every sync packet received by a connection, in the format it asked for. */
const replay = (connId: string) => {
  const state = new ClientState();
  const decoder = new PathTableDecoder();
  const events: any[] = [];
  for (const frame of sentTo.get(connId) ?? []) {
    const packet = decodeMessage(frame);
    if (packet.type !== "sync") continue;
    if (PathTableDecoder.isPathPacket(packet)) decoder.apply(state, packet);
    else load(state, packet.value, true);
    if (packet.events) events.push(packet.events);
  }
  return { state: snapshot(state), events };
};

describe("path table format", () => {
  const clients: any[] = [];
  afterEach(() => {
    for (const c of clients.splice(0)) c.conn?.close();
    visibleOnlySelf = false;
  });
  const connect = async (test: any, paths: boolean, extra: Record<string, string> = {}) => {
    const query = { ...extra, ...(paths ? { format: "paths" } : {}) };
    const client = await test.createClient(undefined, { query });
    clients.push(client);
    const session = await test.server.getSession(client.conn.sessionId);
    return { client, connId: client.conn.id as string, publicId: session.publicId as string };
  };

  /** Changes made to a room while two clients (paths and JSON) watch it. */
  const play = async (test: any) => {
    const room = test.room as any;
    room.score.set(1);
    await tick();
    for (const p of Object.values(room.players()) as any[]) p.x.set(p.x() + 5);
    room.meta?.set({ a: { b: 1 }, list: [1, 2] });
    await tick();
    room.score.set(2);
    for (const p of Object.values(room.players()) as any[]) p.x.set(p.x() + 1);
    await tick();
  };

  it("gives the same client state as JSON packets (broadcast)", async () => {
    const test = await testRoom(BroadcastRoom);
    const a = await connect(test, true);
    const b = await connect(test, false);
    await play(test);
    const late = await connect(test, true); // joins after paths were defined
    (test.room as any).score.set(3);
    await tick();

    const pathState = replay(a.connId).state;
    expect(pathState).toEqual({ ...replay(b.connId).state, pId: pathState.pId });
    expect(replay(late.connId).state.score).toBe(3);
    expect(replay(late.connId).state.players).toEqual(pathState.players);

    const frames = (sentTo.get(a.connId) ?? []).map((f) => decodeMessage(f)).filter((p) => p.type === "sync");
    expect(frames.every((p) => Array.isArray(p.p) && p.value === undefined)).toBe(true);
    // Definitions are sent once: the last packet only uses known paths
    expect(frames.at(-1).d).toBeUndefined();
  });

  it("keeps volatile events in path packets", async () => {
    const test = await testRoom(BroadcastRoom);
    const a = await connect(test, true);
    (test.room as any).hit.emit({ damage: 7 });
    await tick();
    expect(replay(a.connId).events.at(-1)).toEqual({ hit: [{ damage: 7 }] });
  });

  it("compresses path packets", async () => {
    const test = await testRoom(CompressedRoom);
    const a = await connect(test, true, { compression: "deflate" });
    const b = await connect(test, false);
    await play(test);
    const frames = sentTo.get(a.connId) ?? [];
    expect(frames.some((f) => f instanceof Uint8Array)).toBe(true);
    const pathState = replay(a.connId).state;
    expect(pathState).toEqual({ ...replay(b.connId).state, pId: pathState.pId });
  });

  it("encodes the packet returned by interceptorPacket", async () => {
    const test = await testRoom(InterceptRoom);
    const a = await connect(test, true);
    const b = await connect(test, false);
    await play(test);
    expect(replay(a.connId).state.me).toBe(a.publicId);
    expect(replay(b.connId).state.me).toBe(b.publicId);
    const { me: _a, pId: _pa, ...pathState } = replay(a.connId).state;
    const { me: _b, pId: _pb, ...jsonState } = replay(b.connId).state;
    expect(pathState).toEqual(jsonState);
  });

  it("works with syncVisibility, entering and leaving entities", async () => {
    const test = await testRoom(VisibilityRoom);
    const a = await connect(test, true);
    const b = await connect(test, false);
    await play(test);
    (test.room as any).frame = 4;
    visibleOnlySelf = true;
    (test.room as any).score.set(9);
    await tick();

    const pathState = replay(a.connId).state;
    expect(Object.keys(pathState.players)).toEqual([a.publicId]);
    expect(pathState.ack).toEqual({ frame: 4 });
    expect(pathState.score).toBe(9);

    visibleOnlySelf = false;
    (test.room as any).score.set(10);
    await tick();
    const again = replay(a.connId).state;
    const json = replay(b.connId).state;
    expect(again.players).toEqual(json.players);
    expect(again.score).toBe(10);
  });
});
