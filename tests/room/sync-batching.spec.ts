import { afterEach, describe, expect, it, vi } from "vitest";
import { Room, testRoom, tick } from "../../packages/room/src";
import { sync } from "@signe/sync";
import { signal } from "@signe/reactive";

@Room({ path: "batching-test" })
class BatchingRoom {
  @sync() x = signal(0);
  @sync() y = signal(0);
  @sync() hp = signal(100);
}

@Room({ path: "batching-intercept" })
class InterceptRoom {
  @sync() x = signal(0);
  interceptorPacket(_user: any, packet: any) {
    packet.value.tagged = true;
    return packet;
  }
}

function collectSync(client: any) {
  const packets: any[] = [];
  client.addEventListener("message", (msg: string) => {
    const packet = JSON.parse(msg);
    if (packet.type === "sync") packets.push(packet);
  });
  return packets;
}

describe("sync batching and broadcast", () => {
  const clients: any[] = [];
  afterEach(() => {
    for (const c of clients.splice(0)) c.conn?.close();
    vi.restoreAllMocks();
  });

  it("sends all changes made in the same task as one packet", async () => {
    const test = await testRoom(BatchingRoom);
    const client = await test.createClient();
    clients.push(client);
    const packets = collectSync(client);
    const room = test.room as BatchingRoom;

    room.x.set(10);
    room.y.set(20);
    room.hp.set(90);
    await tick();

    expect(packets).toHaveLength(1);
    expect(packets[0].value).toEqual({ x: 10, y: 20, hp: 90 });
  });

  it("serializes a broadcast once for all clients", async () => {
    const test = await testRoom(BatchingRoom);
    const received: any[][] = [];
    for (let i = 0; i < 3; i++) {
      const client = await test.createClient();
      clients.push(client);
      received.push(collectSync(client));
    }
    const room = test.room as BatchingRoom;
    const stringify = vi.spyOn(JSON, "stringify");

    room.x.set(42);
    await tick();

    const syncStringifies = stringify.mock.calls.filter(([v]: any[]) => v?.type === "sync");
    expect(syncStringifies).toHaveLength(1);
    for (const packets of received) {
      expect(packets.at(-1).value).toEqual({ x: 42 });
    }
  });

  it("still gives each client its own copy when interceptorPacket is defined", async () => {
    const test = await testRoom(InterceptRoom);
    const a = await test.createClient();
    const b = await test.createClient();
    clients.push(a, b);
    const pa = collectSync(a);
    const pb = collectSync(b);
    const room = test.room as InterceptRoom;

    room.x.set(5);
    await tick();

    expect(pa.at(-1).value).toEqual({ x: 5, tagged: true });
    expect(pb.at(-1).value).toEqual({ x: 5, tagged: true });
  });
});
