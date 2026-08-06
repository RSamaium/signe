import type { DurableObjectNamespace, DurableObjectState } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { signal } from "../../packages/reactive/src";
import { Request as RequestDecorator, Room, Server } from "../../packages/room/src";
import {
  CloudflareConnection,
  CloudflareRoom,
  createCloudflareRoomWorker,
  SigneRoomDurableObject,
} from "../../packages/room/src/cloudflare";
import { sync } from "../../packages/sync/src";

@Room({ path: "demo" })
class DemoRoom {
  constructor(readonly room: any) {}

  @sync() count = signal(0);

  @RequestDecorator({ path: "/count" })
  getCount() {
    return { count: this.count(), runtime: this.room.env.RUNTIME };
  }

  @RequestDecorator({ path: "/count", method: "POST" }, z.object({ count: z.number() }))
  setCount(req: Request & { data: { count: number } }) {
    this.count.set(req.data.count);
    return { count: this.count() };
  }

  @RequestDecorator({ path: "/peer/:id" })
  async getPeer(req: Request & { params: { id: string } }) {
    const response = await this.room.context.parties.main.get(req.params.id).fetch("/count");
    return response.json();
  }
}

class DemoServer extends Server {
  static startCount = 0;
  static alarmCount = 0;
  rooms = [DemoRoom];

  async onStart() {
    DemoServer.startCount++;
    await super.onStart();
  }

  async onAlarm() {
    DemoServer.alarmCount++;
  }
}

class FakeDurableObjectId {
  constructor(readonly name: string) {}
}

class FakeDurableObjectStub {
  requests: Request[] = [];

  constructor(private readonly handler: (request: Request) => Response | Promise<Response>) {}

  fetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request
      ? input
      : new Request(input, init);
    this.requests.push(request);
    return this.handler(request);
  }
}

class FakeDurableObjectNamespace {
  readonly stubs = new Map<string, FakeDurableObjectStub>();

  constructor(private readonly createHandler: (name: string) => (request: Request) => Response | Promise<Response>) {}

  idFromName(name: string) {
    return new FakeDurableObjectId(name);
  }

  get(id: FakeDurableObjectId) {
    let stub = this.stubs.get(id.name);
    if (!stub) {
      stub = new FakeDurableObjectStub(this.createHandler(id.name));
      this.stubs.set(id.name, stub);
    }
    return stub;
  }
}

class FakeStorage {
  private readonly memory = new Map<string, unknown>();

  async get<T = unknown>(key: string) {
    return this.memory.get(key) as T | undefined;
  }

  async put<T = unknown>(key: string, value: T) {
    this.memory.set(key, value);
  }

  async delete(key: string) {
    return this.memory.delete(key);
  }

  async list<T = unknown>() {
    return new Map(this.memory) as Map<string, T>;
  }
}

function createState() {
  const webSockets: FakeWebSocket[] = [];
  const state = {
    storage: new FakeStorage(),
    blockConcurrencyWhile: <T>(callback: () => Promise<T>) => callback(),
    acceptWebSocket: (webSocket: FakeWebSocket) => webSockets.push(webSocket),
    getWebSockets: () => webSockets,
  } as unknown as DurableObjectState;
  return state;
}

class FakeWebSocket {
  readyState = 1;
  sent: unknown[] = [];
  attachment: unknown;

  send(value: unknown) {
    this.sent.push(value);
  }

  close() {}

  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment() {
    return structuredClone(this.attachment);
  }
}

describe("@signe/room/cloudflare", () => {
  it("routes Worker requests to Durable Objects by room id", async () => {
    createCloudflareRoomWorker(DemoServer, { binding: "ROOMS" });
    const namespace = new FakeDurableObjectNamespace((name) => (request) => {
      return Response.json({ name, url: request.url });
    });
    const worker = createCloudflareRoomWorker(DemoServer, { binding: "ROOMS" });

    const response = await worker.fetch(
      new Request("https://example.com/parties/main/demo/count"),
      { ROOMS: namespace as unknown as DurableObjectNamespace },
      {} as any
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      name: "main:demo",
      url: "https://example.com/parties/main/demo/count",
    });
  });

  it("returns 404 for non-party Worker requests", async () => {
    const worker = createCloudflareRoomWorker(DemoServer, { binding: "ROOMS" });
    const namespace = new FakeDurableObjectNamespace(() => () => {
      return new Response("unexpected");
    });

    const response = await worker.fetch(
      new Request("https://example.com/"),
      { ROOMS: namespace as unknown as DurableObjectNamespace },
      {} as any
    );

    expect(response.status).toBe(404);
  });

  it("handles HTTP requests inside the Durable Object with persistent storage", async () => {
    DemoServer.startCount = 0;
    createCloudflareRoomWorker(DemoServer, {
      binding: "ROOMS",
      env: { RUNTIME: "cloudflare" },
    });
    const namespace = new FakeDurableObjectNamespace(() => () => new Response("peer"));
    const durableObject = new SigneRoomDurableObject(createState(), {
      ROOMS: namespace as unknown as DurableObjectNamespace,
    });

    const first = await durableObject.fetch(
      new Request("https://example.com/parties/main/demo/count")
    );
    const update = await durableObject.fetch(
      new Request("https://example.com/parties/main/demo/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 5 }),
      })
    );
    const second = await durableObject.fetch(
      new Request("https://example.com/parties/main/demo/count")
    );

    expect(DemoServer.startCount).toBe(1);
    await expect(first.json()).resolves.toEqual({ count: 0, runtime: "cloudflare" });
    await expect(update.json()).resolves.toEqual({ count: 5 });
    await expect(second.json()).resolves.toEqual({ count: 5, runtime: "cloudflare" });
  });

  it("supports room-to-room fetch through parties context", async () => {
    createCloudflareRoomWorker(DemoServer, { binding: "ROOMS" });
    const namespace = new FakeDurableObjectNamespace((name) => (request) => {
      return Response.json({ name, path: new URL(request.url).pathname });
    });
    const durableObject = new SigneRoomDurableObject(createState(), {
      ROOMS: namespace as unknown as DurableObjectNamespace,
    });

    const response = await durableObject.fetch(
      new Request("https://example.com/parties/main/demo/peer/other")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      name: "main:other",
      path: "/parties/main/other/count",
    });
  });

  it("restores the room before running an alarm after eviction", async () => {
    DemoServer.alarmCount = 0;
    createCloudflareRoomWorker(DemoServer, { binding: "ROOMS" });
    const state = createState();
    const namespace = new FakeDurableObjectNamespace(() => () => new Response("peer"));
    const env = { ROOMS: namespace as unknown as DurableObjectNamespace };

    const firstInstance = new SigneRoomDurableObject(state, env);
    await firstInstance.fetch(
      new Request("https://example.com/parties/main/demo/count")
    );

    const restoredInstance = new SigneRoomDurableObject(state, env);
    await restoredInstance.alarm();

    expect(DemoServer.alarmCount).toBe(1);
  });

  it("restores hibernated connections from WebSocket attachments", () => {
    createCloudflareRoomWorker(DemoServer, {
      binding: "ROOMS",
      webSocketMode: "hibernate",
    });
    const state = createState();
    const webSocket = new FakeWebSocket();
    const connection = new CloudflareConnection(webSocket as any, {
      id: "connection-1",
      sessionId: "session-1",
      uri: "https://example.com/parties/main/demo?id=session-1",
      state: { publicId: "user-1" },
    });
    connection.persistAttachment();
    (state as any).acceptWebSocket(webSocket);

    const room = new CloudflareRoom({
      id: "demo",
      name: "main",
      env: {},
      state,
      binding: "ROOMS",
      partiesPath: "/parties/main",
    });
    const restored = [...room.getConnections()] as any[];

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id: "connection-1",
      sessionId: "session-1",
      state: { publicId: "user-1" },
    });

    room.broadcast("hello");
    expect(webSocket.sent).toEqual(["hello"]);
  });
});
