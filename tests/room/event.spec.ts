import { afterEach, describe, expect, it } from "vitest";
import { Room, testRoom, tick } from "../../packages/room/src";
import { event, sync } from "@signe/sync";
import { signal } from "@signe/reactive";

@Room({ path: "event-auto", throttleSync: 0 })
class AutoEventRoom {
  @sync() hp = signal(100);
  @sync() hit = event<{ damage: number }>();
}

@Room({ path: "event-manual", throttleSync: 0 })
class ManualEventRoom {
  autoSync = false;
  @sync() hp = signal(100);
  @sync() hit = event<{ damage: number }>();
}

@Room({ path: "event-throttle", throttleSync: 30 })
class ThrottledEventRoom {
  @sync() hp = signal(100);
  @sync() hit = event<{ damage: number }>();
}

function collectSync(client: any) {
  const packets: any[] = [];
  client.addEventListener("message", (msg: string) => {
    const packet = JSON.parse(msg);
    if (packet.type === "sync") packets.push(packet);
  });
  return packets;
}

const allEvents = (packets: any[], path: string) =>
  packets.flatMap((p) => p.events?.[path] ?? []);

describe("Volatile events in rooms", () => {
  const clients: any[] = [];
  const createClient = async (test: any) => {
    const client = await test.createClient();
    clients.push(client);
    return client;
  };

  afterEach(() => {
    for (const client of clients.splice(0)) client.conn?.close();
  });

  it("sends the event in the same packet as the state change", async () => {
    const test = await testRoom(AutoEventRoom);
    const client = await createClient(test);
    const packets = collectSync(client);
    const room = test.room as AutoEventRoom;

    room.hp.set(60);
    room.hit.emit({ damage: 40 });
    await tick();

    expect(allEvents(packets, "hit")).toEqual([{ damage: 40 }]);
    const withEvent = packets.find((p) => p.events?.hit);
    expect(withEvent.events.hit).toEqual([{ damage: 40 }]);
  });

  it("delivers identical emissions separately and never stores them", async () => {
    const test = await testRoom(AutoEventRoom);
    const client = await createClient(test);
    const packets = collectSync(client);
    const room = test.room as any;

    room.hit.emit({ damage: 1 });
    room.hit.emit({ damage: 1 });
    await tick();

    expect(allEvents(packets, "hit")).toEqual([{ damage: 1 }, { damage: 1 }]);
    expect(room.$memoryAll).not.toHaveProperty("hit");
  });

  it("does not replay past events to late joiners", async () => {
    const test = await testRoom(AutoEventRoom);
    await createClient(test);
    const room = test.room as AutoEventRoom;
    room.hit.emit({ damage: 40 });
    await tick();

    const late = await test.createClient();
    clients.push(late);
    const packets = collectSync(late);
    await tick();
    // The initial sync was sent during createClient; trigger another packet
    room.hp.set(50);
    await tick();

    expect(allEvents(packets, "hit")).toEqual([]);
  });

  it("groups events emitted within the throttle window", async () => {
    const test = await testRoom(ThrottledEventRoom);
    const client = await createClient(test);
    const packets = collectSync(client);
    const room = test.room as ThrottledEventRoom;

    room.hit.emit({ damage: 1 });
    room.hit.emit({ damage: 2 });
    room.hit.emit({ damage: 3 });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(allEvents(packets, "hit")).toEqual([
      { damage: 1 },
      { damage: 2 },
      { damage: 3 },
    ]);
  });

  describe("with autoSync disabled", () => {
    it("keeps events pending until $applySync()", async () => {
      const test = await testRoom(ManualEventRoom);
      const client = await createClient(test);
      const packets = collectSync(client);
      const room = test.room as any;

      room.hp.set(60);
      room.hit.emit({ damage: 40 });
      room.hit.emit({ damage: 2 });
      await tick();
      expect(allEvents(packets, "hit")).toEqual([]);

      room.$applySync();
      await tick();
      const packet = packets.find((p) => p.events?.hit);
      expect(packet.value.hp).toBe(60);
      expect(packet.events.hit).toEqual([{ damage: 40 }, { damage: 2 }]);
      expect(room.$pendingEvents.size).toBe(0);
    });

    it("does not resend events on a later $applySync()", async () => {
      const test = await testRoom(ManualEventRoom);
      const client = await createClient(test);
      const packets = collectSync(client);
      const room = test.room as any;

      room.hit.emit({ damage: 40 });
      room.$applySync();
      await tick();
      room.$applySync();
      await tick();

      expect(allEvents(packets, "hit")).toEqual([{ damage: 40 }]);
    });
  });
});
