import type { DurableObjectNamespace, DurableObjectState } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { signal } from "../../packages/reactive/src";
import { Request as RequestDecorator, Room, Server } from "../../packages/room/src";
import {
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
  rooms = [DemoRoom];

  async onStart() {
    DemoServer.startCount++;
    await super.onStart();
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
  return {
    storage: new FakeStorage(),
    blockConcurrencyWhile: <T>(callback: () => Promise<T>) => callback(),
  } as unknown as DurableObjectState;
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
      name: "demo",
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
      name: "other",
      path: "/parties/main/other/count",
    });
  });
});
