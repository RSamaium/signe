import { afterEach, describe, expect, it } from "vitest";
import { Room, testRoom, tick } from "../../packages/room/src";
import { MockConnection } from "../../packages/room/src/mock";
import { decodeMessage, event, sync } from "@signe/sync";
import { signal } from "@signe/reactive";

const big = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`item${i}`, i]));

@Room({ path: "compression-on", compression: true })
class CompressedRoom {
  @sync() data = signal<Record<string, number>>({});
  @sync() small = signal(0);
}

@Room({ path: "compression-off" })
class PlainRoom {
  @sync() data = signal<Record<string, number>>({});
}

@Room({ path: "compression-intercept", compression: true })
class InterceptRoom {
  @sync() data = signal<Record<string, number>>({});
  interceptorPacket(_user: any, packet: any) { return packet; }
}

@Room({ path: "compression-intercept-on", compression: { intercepted: true, threshold: 100 } })
class InterceptCompressedRoom {
  @sync() data = signal<Record<string, number>>({});
  interceptorPacket(_user: any, packet: any) { return packet; }
}

@Room({ path: "compression-events", compression: true })
class EventsRoom {
  @sync() data = signal<Record<string, number>>({});
  @sync() hit = event<{ damage: number }>();
}

const collect = (client: any) => {
  const frames: any[] = [];
  client.addEventListener("message", (data: any) => frames.push(data));
  return frames;
};
const syncFrames = (frames: any[]) => frames.filter((f) => decodeMessage(f).type === "sync");

describe("room compression", () => {
  const clients: any[] = [];
  afterEach(() => { for (const c of clients.splice(0)) c.conn?.close(); });
  const connect = async (test: any, compression: boolean) => {
    const client = await test.createClient(undefined, compression ? { query: { compression: "deflate" } } : undefined);
    clients.push(client);
    return client;
  };

  it("sends large packets compressed to clients that ask, and as text to others", async () => {
    const test = await testRoom(CompressedRoom);
    const zipped = collect(await connect(test, true));
    const plain = collect(await connect(test, false));
    zipped.length = 0;
    plain.length = 0;

    (test.room as any).data.set(big(200));
    await tick();

    const z = syncFrames(zipped).at(-1);
    const p = syncFrames(plain).at(-1);
    expect(z).toBeInstanceOf(Uint8Array);
    expect(typeof p).toBe("string");
    expect(decodeMessage(z)).toEqual(decodeMessage(p));
    expect(z.length).toBeLessThan(p.length);
  });

  it("compresses a broadcast once for all clients", async () => {
    const test = await testRoom(CompressedRoom);
    const a = collect(await connect(test, true));
    const b = collect(await connect(test, true));
    (test.room as any).data.set(big(200));
    await tick();
    expect(syncFrames(a).at(-1)).toBe(syncFrames(b).at(-1));
  });

  it("keeps small packets as text", async () => {
    const test = await testRoom(CompressedRoom);
    const frames = collect(await connect(test, true));
    frames.length = 0;
    (test.room as any).small.set(1);
    await tick();
    expect(typeof syncFrames(frames).at(-1)).toBe("string");
  });

  it("compresses the initial sync of a large state", async () => {
    const test = await testRoom(CompressedRoom);
    (test.room as any).data.set(big(200));
    await tick();

    // The initial sync is sent during the connection: record what connections send
    const sent: any[] = [];
    const original = MockConnection.prototype.send;
    MockConnection.prototype.send = function (data: any) {
      sent.push(data);
      return original.call(this, data);
    };
    try {
      clients.push(await connect(test, true));
    } finally {
      MockConnection.prototype.send = original;
    }

    const initial = sent.find((f) => decodeMessage(f).type === "sync");
    expect(initial).toBeInstanceOf(Uint8Array);
    expect(decodeMessage(initial).value.data.item199).toBe(199);
    expect(decodeMessage(initial).value.pId).toBeTruthy();
  });

  it("carries volatile events inside compressed packets", async () => {
    const test = await testRoom(EventsRoom);
    const frames = collect(await connect(test, true));
    const room = test.room as any;

    room.data.set(big(200));
    room.hit.emit({ damage: 40 });
    await tick();

    const last = syncFrames(frames).at(-1);
    expect(last).toBeInstanceOf(Uint8Array);
    const packet = decodeMessage(last);
    expect(packet.value.data.item199).toBe(199);
    expect(packet.events).toEqual({ hit: [{ damage: 40 }] });
  });

  it("ignores the client request when the room does not enable compression", async () => {
    const test = await testRoom(PlainRoom);
    const frames = collect(await connect(test, true));
    (test.room as any).data.set(big(200));
    await tick();
    expect(typeof syncFrames(frames).at(-1)).toBe("string");
  });

  it("does not compress intercepted packets by default", async () => {
    const test = await testRoom(InterceptRoom);
    const frames = collect(await connect(test, true));
    (test.room as any).data.set(big(200));
    await tick();
    expect(typeof syncFrames(frames).at(-1)).toBe("string");
  });

  it("compresses intercepted packets with intercepted: true", async () => {
    const test = await testRoom(InterceptCompressedRoom);
    const frames = collect(await connect(test, true));
    (test.room as any).data.set(big(200));
    await tick();
    const last = syncFrames(frames).at(-1);
    expect(last).toBeInstanceOf(Uint8Array);
    expect(decodeMessage(last).value.data.item199).toBe(199);
  });
});
