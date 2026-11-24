import { afterEach, describe, expect, it } from "vitest";
import { Room, testRoom, tick } from "../../packages/room/src";
import { sync } from "@signe/sync";
import { signal } from "@signe/reactive";

@Room({ path: "precision-test" })
class PrecisionRoom {
  @sync({ precision: 0 }) x = signal(0);
  @sync() label = signal("");
}

describe("@sync({ precision }) in a room", () => {
  const clients: any[] = [];
  afterEach(() => { for (const c of clients.splice(0)) c.conn?.close(); });

  it("sends rounded values, keeps them in $memoryAll, and stores the exact value", async () => {
    const test = await testRoom(PrecisionRoom);
    const client = await test.createClient();
    clients.push(client);
    const packets: any[] = [];
    client.addEventListener("message", (msg: string) => {
      const p = JSON.parse(msg);
      if (p.type === "sync") packets.push(p);
    });
    const room = test.room as any;

    room.x.set(12.7);
    await tick();
    expect(packets.at(-1).value).toEqual({ x: 13 });
    expect(room.$memoryAll.x).toBe(13);
    expect(await test.server.room.storage.get("state:x")).toBe(12.7);

    const count = packets.length;
    room.x.set(12.9);
    await tick();
    expect(packets.length).toBe(count);
    expect(await test.server.room.storage.get("state:x")).toBe(12.9);
  });
});
