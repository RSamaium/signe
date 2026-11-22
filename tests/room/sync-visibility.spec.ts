import { afterEach, describe, expect, it, vi } from "vitest";
import { Room, testRoom, tick } from "../../packages/room/src";
import { MockConnection } from "../../packages/room/src/mock";

// Record what each connection receives from its very first message (the initial sync is
// sent while the client is connecting, before a listener could be attached).
const sentTo = new Map<string, any[]>();
const binaryFrames = new Map<string, number>();
const originalSend = MockConnection.prototype.send;
MockConnection.prototype.send = function (data: any) {
  const list = sentTo.get(this.id) ?? [];
  list.push(decodeMessage(data));
  sentTo.set(this.id, list);
  if (typeof data !== "string") binaryFrames.set(this.id, (binaryFrames.get(this.id) ?? 0) + 1);
  return originalSend.call(this, data);
};
import { decodeMessage, event, id, load, sync, users } from "@signe/sync";
import { signal } from "@signe/reactive";

class Player {
  @id() id = signal("");
  @sync() x = signal(0);
  @sync() name = signal("");
}

/** Ids visible by each client (public id); undefined = `defaultVisibility`. */
const visibleFor: Record<string, string[] | undefined> = {};
let defaultVisibility: "all" | "self" = "all";

@Room({ path: "visibility-test" })
class VisibilityRoom {
  @users(Player) players = signal<Record<string, Player>>({});
  @sync() score = signal(0);
  frame = 0;

  syncVisibility(_user: Player, conn: any) {
    const me = conn.state?.publicId;
    const ids = visibleFor[me] ?? (defaultVisibility === "self" ? [me] : Object.keys(this.players()));
    return { players: ids };
  }

  syncPacketHeader(_user: Player, conn: any) {
    return { ack: { for: conn.state?.publicId, frame: this.frame } };
  }

  interceptorPacket(_user: Player, packet: any, conn: any) {
    if (packet.type === "custom") return { ...packet, value: { ...packet.value, seenBy: conn.state?.publicId } };
    return packet;
  }
}

@Room({ path: "no-copy-test", copyPacketForInterceptor: false })
class NoCopyRoom {
  @sync() count = signal(0);
  received: any[] = [];
  interceptorPacket(_user: any, packet: any) {
    this.received.push(packet);
    return packet;
  }
}

@Room({ path: "copy-test" })
class CopyRoom {
  @sync() count = signal(0);
  received: any[] = [];
  interceptorPacket(_user: any, packet: any) {
    this.received.push(packet);
    return packet;
  }
}

const connect = async (test: any, clients: any[]) => {
  const client = await test.createClient();
  clients.push(client);
  const packets = sentTo.get(client.conn.id) ?? [];
  sentTo.set(client.conn.id, packets);
  const session = await test.server.getSession(client.conn.sessionId);
  return { client, packets, id: session.publicId as string };
};
const lastSync = (packets: any[]) => packets.filter((p) => p.type === "sync").at(-1);

describe("syncVisibility", () => {
  const clients: any[] = [];
  afterEach(() => {
    for (const c of clients.splice(0)) c.conn?.close();
    for (const key of Object.keys(visibleFor)) delete visibleFor[key];
    defaultVisibility = "all";
  });

  it("filters entities per client, sends full state on enter and $delete on leave", async () => {
    const test = await testRoom(VisibilityRoom);
    const room = test.room as VisibilityRoom;
    const a = await connect(test, clients);
    const b = await connect(test, clients);
    const c = await connect(test, clients);
    visibleFor[a.id] = [a.id, b.id];
    visibleFor[b.id] = [b.id];
    // c sees everyone

    room.players()[a.id].name.set("Alice");
    room.players()[b.id].name.set("Bob");
    room.players()[c.id].name.set("Carol");
    room.score.set(1);
    await tick();

    const forA = lastSync(a.packets).value;
    const forB = lastSync(b.packets).value;
    const forC = lastSync(c.packets).value;
    // a and b saw everyone before their view was restricted: the others leave with $delete
    expect(forA.players[a.id]).toEqual({ name: "Alice" });
    expect(forA.players[b.id]).toEqual({ name: "Bob" });
    expect(forA.players[c.id]).toBe("$delete");
    expect(forB.players[b.id]).toEqual({ name: "Bob" });
    expect(forB.players[a.id]).toBe("$delete");
    expect(forB.players[c.id]).toBe("$delete");
    expect(Object.keys(forC.players ?? {}).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(forA.score).toBe(1);
    expect(forB.score).toBe(1);

    // c moves: only visible to c
    room.players()[c.id].x.set(42);
    await tick();
    expect(lastSync(a.packets).value.players).toBeUndefined();
    expect(lastSync(c.packets).value.players[c.id]).toEqual({ x: 42 });

    // c becomes visible to b: b gets c's full state, not only the last patch
    visibleFor[b.id] = [b.id, c.id];
    room.score.set(2);
    await tick();
    expect(lastSync(b.packets).value.players[c.id]).toMatchObject({ x: 42, name: "Carol" });

    // c leaves b's view: b gets $delete
    visibleFor[b.id] = [b.id];
    room.score.set(3);
    await tick();
    expect(lastSync(b.packets).value.players[c.id]).toBe("$delete");
  });

  it("adds the per-client header and keeps custom packets going through interceptorPacket", async () => {
    const test = await testRoom(VisibilityRoom);
    const room = test.room as VisibilityRoom;
    const a = await connect(test, clients);
    room.frame = 7;
    room.score.set(5);
    await tick();
    expect(lastSync(a.packets).value.ack).toEqual({ for: a.id, frame: 7 });

    (room as any).$broadcast({ type: "custom", value: { hello: 1 } });
    await tick();
    expect(a.packets.find((p) => p.type === "custom").value).toEqual({ hello: 1, seenBy: a.id });
  });

  it("filters the initial sync of a new client", async () => {
    const test = await testRoom(VisibilityRoom);
    const room = test.room as VisibilityRoom;
    const a = await connect(test, clients);
    room.players()[a.id].name.set("Alice");
    room.score.set(9);
    await tick();

    defaultVisibility = "self";
    const b = await connect(test, clients);
    await tick();
    const syncs = b.packets.filter((p) => p.type === "sync");
    const seen = new Set(syncs.flatMap((p) => Object.keys(p.value.players ?? {})));
    expect([...seen]).toEqual([b.id]);
    expect(syncs.some((p) => p.value.score === 9)).toBe(true);
  });

  it("sends the full state again after a reconnection", async () => {
    const test = await testRoom(VisibilityRoom);
    const room = test.room as VisibilityRoom;
    const a = await connect(test, clients);
    const b = await connect(test, clients);
    room.players()[b.id].name.set("Bob");
    await tick();
    const states = (room as any).$syncVisibleEntities as Map<string, unknown>;
    expect(states.has(a.client.conn.id)).toBe(true);
    a.client.conn.close();
    await tick();
    expect(states.has(a.client.conn.id)).toBe(false);
  });
});

describe("syncVisibility: client state", () => {
  const clients: any[] = [];
  afterEach(() => {
    for (const c of clients.splice(0)) c.conn?.close();
    for (const key of Object.keys(visibleFor)) delete visibleFor[key];
    defaultVisibility = "all";
  });

  it("a client that applies every packet ends with exactly the visible entities", async () => {
    const test = await testRoom(VisibilityRoom);
    const room = test.room as VisibilityRoom;
    const a = await connect(test, clients);
    const b = await connect(test, clients);
    const c = await connect(test, clients);

    const steps: Array<() => void> = [
      () => { visibleFor[a.id] = [a.id]; room.players()[c.id].x.set(5); },
      () => { visibleFor[a.id] = [a.id, c.id]; room.players()[c.id].name.set("Carol"); },
      () => { room.players()[b.id].x.set(9); room.players()[c.id].x.set(6); },
      () => { visibleFor[a.id] = [a.id, b.id]; },
      () => { visibleFor[a.id] = undefined; room.score.set(3); },
    ];
    for (const step of steps) {
      step();
      room.score.update((v) => v + 1);
      await tick();
    }

    class ClientRoom {
      @sync(Player) players = signal<Record<string, Player>>({});
      @sync() score = signal(0);
    }
    const clientState = new ClientRoom();
    for (const packet of a.packets) {
      if (packet.type === "sync") load(clientState, packet.value, true);
    }
    const server = room.players();
    expect(Object.keys(clientState.players()).sort()).toEqual(Object.keys(server).sort());
    for (const id of Object.keys(server)) {
      expect(clientState.players()[id].x()).toBe(server[id].x());
      expect(clientState.players()[id].name()).toBe(server[id].name());
    }
    expect(clientState.score()).toBe(room.score());
  });
});

class Npc {
  @id() id = signal("");
  @sync() label = signal("");
}

const bigNpcs = () => Object.fromEntries(Array.from({ length: 80 }, (_, i) => {
  const npc = new Npc();
  npc.label.set("npc number " + i);
  return ["n" + i, npc];
}));

@Room({ path: "visibility-events", compression: true })
class VisibilityEventsRoom {
  @sync(Npc) npcs = signal<Record<string, Npc>>({});
  @sync() hit = event<{ damage: number }>();
  syncVisibility() {
    return { npcs: Object.keys(this.npcs()) };
  }
}

@Room({ path: "visibility-compressed", compression: { intercepted: true, threshold: 100 } })
class VisibilityCompressedRoom {
  @sync(Npc) npcs = signal<Record<string, Npc>>({});
  syncVisibility() {
    return { npcs: Object.keys(this.npcs()) };
  }
}

describe("syncVisibility with events and compression", () => {
  const clients: any[] = [];
  afterEach(() => { for (const c of clients.splice(0)) c.conn?.close(); });
  const connectCompressed = async (test: any) => {
    const client = await test.createClient(undefined, { query: { compression: "deflate" } });
    clients.push(client);
    const packets = sentTo.get(client.conn.id) ?? [];
    sentTo.set(client.conn.id, packets);
    return { client, packets };
  };

  it("keeps volatile events in filtered packets, and does not compress them by default", async () => {
    const test = await testRoom(VisibilityEventsRoom);
    const room = test.room as VisibilityEventsRoom;
    const a = await connectCompressed(test);
    room.npcs.set(bigNpcs());
    room.hit.emit({ damage: 3 });
    await tick();
    const last = lastSync(a.packets);
    expect(Object.keys(last.value.npcs)).toHaveLength(80);
    expect(last.events).toEqual({ hit: [{ damage: 3 }] });
    expect(binaryFrames.get(a.client.conn.id) ?? 0).toBe(0);
  });

  it("compresses filtered packets with compression.intercepted", async () => {
    const test = await testRoom(VisibilityCompressedRoom);
    const room = test.room as VisibilityCompressedRoom;
    const a = await connectCompressed(test);
    room.npcs.set(bigNpcs());
    await tick();
    expect(binaryFrames.get(a.client.conn.id) ?? 0).toBeGreaterThan(0);
    expect(Object.keys(lastSync(a.packets).value.npcs)).toHaveLength(80);
  });
});

describe("copyPacketForInterceptor", () => {
  const clients: any[] = [];
  afterEach(() => { for (const c of clients.splice(0)) c.conn?.close(); });

  it("gives each client the same packet object when set to false", async () => {
    const test = await testRoom(NoCopyRoom);
    clients.push(await test.createClient(), await test.createClient());
    const room = test.room as NoCopyRoom;
    room.received.length = 0;
    room.count.set(1);
    await tick();
    expect(room.received).toHaveLength(2);
    expect(room.received[0]).toBe(room.received[1]);
  });

  it("copies the packet for each client by default", async () => {
    const test = await testRoom(CopyRoom);
    clients.push(await test.createClient(), await test.createClient());
    const room = test.room as CopyRoom;
    room.received.length = 0;
    room.count.set(1);
    await tick();
    expect(room.received).toHaveLength(2);
    expect(room.received[0]).not.toBe(room.received[1]);
    expect(room.received[0]).toEqual(room.received[1]);
  });
});
