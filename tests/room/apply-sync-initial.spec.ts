import { afterEach, describe, expect, it } from "vitest";
import { Room, testRoom, tick } from "../../packages/room/src";
import { sync } from "@signe/sync";
import { signal } from "@signe/reactive";

@Room({ path: "apply-sync-initial" })
class ManualRoom {
  autoSync = false;
  @sync() count = signal(0);
  @sync() score = signal(0);
  @sync() label = signal("");
}

describe("$applySync() and clients waiting for their initial sync", () => {
  it("sends changes made in the same task", async () => {
    const test = await testRoom(ManualRoom);
    const room = test.room as any;
    const a = await test.createClient();
    clients.push(a);
    room.$applySync();
    await tick();
    const packets: any[] = [];
    a.addEventListener("message", (msg: string) => packets.push(JSON.parse(msg)));

    room.score.set(7);
    room.$applySync();

    expect(packets.at(-1)?.value).toEqual({ score: 7 });
    await tick();
    // nothing is sent twice when the batched sync runs afterwards
    expect(packets.filter((p) => p.type === "sync")).toHaveLength(1);
  });

  const clients: any[] = [];
  afterEach(() => { for (const c of clients.splice(0)) c.conn?.close(); });

  const syncPackets = (client: any) => {
    const packets: any[] = [];
    client.addEventListener("message", (msg: string) => {
      const packet = JSON.parse(msg);
      if (packet.type === "sync") packets.push(packet);
    });
    return packets;
  };

  it("sends the full state to a waiting client, even when changes are pending", async () => {
    const test = await testRoom(ManualRoom);
    const room = test.room as any;
    const a = await test.createClient();
    clients.push(a);
    room.score.set(5);
    room.label.set("ready");
    room.$applySync();
    await tick();

    // b connects while only `count` has a pending change
    room.count.set(1);
    await tick();
    const b = await test.createClient();
    clients.push(b);
    const forB = syncPackets(b);
    const forA = syncPackets(a);

    room.$applySync();
    await tick();

    expect(forB).toHaveLength(1);
    expect(forB[0].value).toMatchObject({ count: 1, score: 5, label: "ready" });
    expect(forB[0].value.pId).toBeTruthy();
    // clients already synchronized still receive only the changes
    expect(forA.at(-1).value).toEqual({ count: 1 });
  });
});
