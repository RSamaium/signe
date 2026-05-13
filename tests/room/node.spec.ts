import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Action, Request, Room, Server } from "../../packages/room/src";
import {
  createMemoryNodeRoomStorage,
  createNodeRoomTransport,
  createSqliteNodeRoomStorage,
  type NodeWebSocketLike,
  type NodeWebSocketServerLike,
} from "../../packages/room/src/node";
import { sync } from "@signe/sync";
import { signal } from "@signe/reactive";
import { z } from "zod";

@Room({ path: "demo" })
class DemoRoom {
  constructor(readonly room: any) {}

  @sync() count = signal(0);

  @Action("increment")
  increment(_user: unknown, value: { amount?: number }) {
    this.count.update((current) => current + (value.amount ?? 1));
  }

  @Request({ path: "/count" })
  getCount() {
    return { count: this.count() };
  }

  @Request({ path: "/custom-response" })
  getCustomResponse() {
    return new Response("created", {
      status: 201,
      headers: {
        "X-Test-Header": "node-adapter",
      },
    });
  }

  @Request({ path: "/env" })
  getEnv() {
    return { runtime: this.room.env.RUNTIME };
  }

  @Request({ path: "/query" })
  getQuery(req: any) {
    const url = new URL(req.url);
    return { value: url.searchParams.get("value") };
  }

  @Request({ path: "/increment", method: "POST" }, z.object({ amount: z.number() }))
  incrementHttp(req: any) {
    this.count.update((current) => current + req.data.amount);
    return { count: this.count() };
  }

  @Request({ path: "/peer/:id" })
  async getPeer(req: any) {
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

@Room({ path: "debounced-storage", throttleStorage: 2500 })
class DebouncedStorageRoom {
  @sync() count = signal(0);

  @Request({ path: "/count", method: "POST" }, z.object({ count: z.number() }))
  setCount(req: any) {
    this.count.set(req.data.count);
    return { count: this.count() };
  }
}

class DebouncedStorageServer extends Server {
  rooms = [DebouncedStorageRoom];
}

@Room({ path: "demo" })
class AlternateRoom {
  @Request({ path: "/namespace" })
  getNamespace() {
    return { namespace: "alternate" };
  }
}

class AlternateServer extends Server {
  rooms = [AlternateRoom];
}

class FailingConnectServer extends DemoServer {
  async onConnect() {
    throw new Error("connect failed");
  }
}

class FakeWebSocket extends EventEmitter implements NodeWebSocketLike {
  readyState = 1;
  sent: unknown[] = [];
  closed = false;
  closeCode?: number;
  closeReason?: string | Buffer;

  send(data: unknown) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string | Buffer) {
    this.closeCode = code;
    this.closeReason = reason;
    this.closed = true;
    this.emit("close");
  }
}

class FakeWebSocketServer extends EventEmitter implements NodeWebSocketServerLike {
  readonly sockets: FakeWebSocket[] = [];

  get socket() {
    return this.sockets[this.sockets.length - 1];
  }

  handleUpgrade(_request: any, _socket: any, _head: Buffer, cb: (webSocket: NodeWebSocketLike) => void) {
    const socket = new FakeWebSocket();
    this.sockets.push(socket);
    cb(socket);
  }
}

async function setDebouncedCount(
  transport: ReturnType<typeof createNodeRoomTransport>,
  count: number
) {
  const response = await transport.fetch("/parties/main/debounced-storage/count", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count }),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ count });
}

describe("@signe/room/node", () => {
  let cleanup: (() => Promise<void> | void) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
  });

  it("routes Web Request objects to room request handlers", async () => {
    const transport = createNodeRoomTransport(DemoServer);

    const response = await transport.fetch("/parties/main/demo/count");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 0 });
  });

  it("creates a room lazily and starts its server once", async () => {
    DemoServer.startCount = 0;
    const transport = createNodeRoomTransport(DemoServer);

    await transport.fetch("/parties/main/demo/count");
    await transport.fetch("/parties/main/demo/count");

    expect(DemoServer.startCount).toBe(1);
  });

  it("converts Node HTTP requests and responses", async () => {
    const transport = createNodeRoomTransport(DemoServer);
    const httpServer = createServer((req, res) => {
      void transport.handleNodeRequest(req, res);
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    cleanup = () => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    });

    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/parties/main/demo/count`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 0 });
  });

  it("converts real Node HTTP POST bodies", async () => {
    const transport = createNodeRoomTransport(DemoServer);
    const httpServer = createServer((req, res) => {
      void transport.handleNodeRequest(req, res);
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    cleanup = () => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    });

    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/parties/main/demo/increment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 3 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 3 });
  });

  it("preserves custom Response status and headers", async () => {
    const transport = createNodeRoomTransport(DemoServer);

    const response = await transport.fetch("/parties/main/demo/custom-response");

    expect(response.status).toBe(201);
    expect(response.headers.get("x-test-header")).toBe("node-adapter");
    await expect(response.text()).resolves.toBe("created");
  });

  it("passes query strings to room request handlers", async () => {
    const transport = createNodeRoomTransport(DemoServer);

    const response = await transport.fetch("/parties/main/demo/query?value=hello");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ value: "hello" });
  });

  it("passes env options to Node rooms", async () => {
    const transport = createNodeRoomTransport(DemoServer, {
      env: { RUNTIME: "node" },
    });

    const response = await transport.fetch("/parties/main/demo/env");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ runtime: "node" });
  });

  it("supports a custom parties path", async () => {
    const transport = createNodeRoomTransport(DemoServer, {
      partiesPath: "/rooms/main",
    });

    const response = await transport.fetch("/rooms/main/demo/count");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 0 });
  });

  it("supports alternate namespace server constructors", async () => {
    const transport = createNodeRoomTransport(DemoServer, {
      rooms: {
        alternate: AlternateServer,
      },
    });

    const response = await transport.fetch("/parties/alternate/demo/namespace");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ namespace: "alternate" });
  });

  it("uses custom storage factories", async () => {
    const get = vi.fn(async (key: string) => key === "." ? undefined : `stored:${key}`);
    const put = vi.fn(async () => undefined);
    const del = vi.fn(async () => undefined);
    const list = vi.fn(async () => new Map());
    const storage = { get, put, delete: del, list };
    const storageFactory = vi.fn(() => storage);
    const transport = createNodeRoomTransport(DemoServer, {
      storage: storageFactory,
    });

    const room = await transport.getRoom("main", "demo");
    await room.storage.put("value", "custom");

    expect(storageFactory).toHaveBeenCalledWith("main", "demo");
    expect(put).toHaveBeenCalledWith("value", "custom");
  });

  it("uses explicit memory storage providers", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(DemoServer, {
      storage,
    });

    const room = await transport.getRoom("main", "demo");
    await room.storage.put("value", "memory");

    await expect(room.storage.get("value")).resolves.toBe("memory");
    expect(storage.snapshot()).toEqual({
      "main:demo": [["value", "memory"]],
    });
  });

  it("keeps explicit memory storage isolated by namespace and room id", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(DemoServer, {
      rooms: {
        alternate: AlternateServer,
      },
      storage,
    });
    const mainRoom = await transport.getRoom("main", "demo");
    const alternateRoom = await transport.getRoom("alternate", "demo");
    const otherRoom = await transport.getRoom("main", "other");

    await mainRoom.storage.put("value", "main");
    await alternateRoom.storage.put("value", "alternate");
    await otherRoom.storage.put("value", "other");

    await expect(mainRoom.storage.get("value")).resolves.toBe("main");
    await expect(alternateRoom.storage.get("value")).resolves.toBe("alternate");
    await expect(otherRoom.storage.get("value")).resolves.toBe("other");
  });

  it("returns snapshots without exposing mutable memory internals", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(DemoServer, { storage });
    const room = await transport.getRoom("main", "demo");
    const value = { count: 1 };

    await room.storage.put("value", value);
    const snapshot = storage.snapshot();
    (snapshot["main:demo"][0][1] as any).count = 99;

    await expect(room.storage.get("value")).resolves.toEqual({ count: 1 });
  });

  it("restores memory snapshots into new storage providers", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(DemoServer, { storage });
    const room = await transport.getRoom("main", "demo");
    await room.storage.put("value", { count: 7 });

    const restoredStorage = createMemoryNodeRoomStorage({
      snapshot: storage.snapshot(),
    });
    const restoredTransport = createNodeRoomTransport(DemoServer, {
      storage: restoredStorage,
    });
    const restoredRoom = await restoredTransport.getRoom("main", "demo");

    await expect(restoredRoom.storage.get("value")).resolves.toEqual({ count: 7 });
  });

  it("clears explicit memory storage providers", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(DemoServer, { storage });
    const room = await transport.getRoom("main", "demo");
    await room.storage.put("value", "memory");

    storage.clear();

    const emptyRoomStorage = storage.getStorage("main", "demo");
    await expect(emptyRoomStorage.get("value")).resolves.toBeUndefined();
    expect(storage.snapshot()).toEqual({});
  });

  it("supports async storage providers for sqlite-like backends", async () => {
    const sqliteStorage = {
      get: vi.fn(async (key: string) => `sqlite:${key}`),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => new Map()),
    };
    const provider = {
      getStorage: vi.fn(async () => sqliteStorage),
    };
    const transport = createNodeRoomTransport(DemoServer, {
      storage: provider,
    });

    const room = await transport.getRoom("main", "demo");
    await room.storage.put("value", "persisted");

    expect(provider.getStorage).toHaveBeenCalledWith("main", "demo");
    expect(sqliteStorage.put).toHaveBeenCalledWith("value", "persisted");
    await expect(room.storage.get("value")).resolves.toBe("sqlite:value");
  });

  it("debounces throttled storage writes until the wait time has elapsed", async () => {
    vi.useFakeTimers();
    const put = vi.fn(async () => undefined);
    const storage = {
      get: vi.fn(async () => undefined),
      put,
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => new Map()),
    };
    const transport = createNodeRoomTransport(DebouncedStorageServer, {
      storage: () => storage,
    });

    await setDebouncedCount(transport, 1);
    await setDebouncedCount(transport, 2);
    await setDebouncedCount(transport, 3);

    expect(put).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2499);
    expect(put).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith("state:.", { count: 3 });
  });

  it("restarts the throttled storage debounce window after each change", async () => {
    vi.useFakeTimers();
    const put = vi.fn(async () => undefined);
    const storage = {
      get: vi.fn(async () => undefined),
      put,
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => new Map()),
    };
    const transport = createNodeRoomTransport(DebouncedStorageServer, {
      storage: () => storage,
    });

    await setDebouncedCount(transport, 1);
    await vi.advanceTimersByTimeAsync(2000);
    await setDebouncedCount(transport, 2);

    await vi.advanceTimersByTimeAsync(2499);
    expect(put).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith("state:.", { count: 2 });
  });

  it("provides a SQLite storage provider", async () => {
    const dir = await mkdtemp(join(tmpdir(), "signe-room-sqlite-"));
    cleanup = () => rm(dir, { recursive: true, force: true });
    const storage = createSqliteNodeRoomStorage({
      databasePath: join(dir, "rooms.sqlite"),
    });
    const transport = createNodeRoomTransport(DemoServer, { storage });
    const room = await transport.getRoom("main", "demo");

    await room.storage.put("value", { persisted: true });
    await room.storage.put("other", "entry");

    await expect(room.storage.get("value")).resolves.toEqual({ persisted: true });
    await expect(room.storage.list()).resolves.toEqual(new Map([
      ["value", { persisted: true }],
      ["other", "entry"],
    ]));
    await expect(room.storage.delete("other")).resolves.toBe(true);
    await expect(room.storage.get("other")).resolves.toBeUndefined();
  });

  it("rejects unsafe SQLite table names", () => {
    expect(() => createSqliteNodeRoomStorage({
      databasePath: ":memory:",
      tableName: "rooms; DROP TABLE rooms;",
    })).toThrow("Invalid SQLite table name");
  });

  it("delegates unmatched Node HTTP requests to next", async () => {
    const transport = createNodeRoomTransport(DemoServer);
    const next = vi.fn();
    const httpServer = createServer((req, res) => {
      void transport.handleNodeRequest(req, res, next);
      res.end("fallback");
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    cleanup = () => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    });

    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/unmatched`);

    expect(next).toHaveBeenCalledOnce();
    expect(await response.text()).toBe("fallback");
  });

  it("accepts WebSocket upgrades and forwards messages to the room server", async () => {
    const transport = createNodeRoomTransport(DemoServer);
    const wsServer = new FakeWebSocketServer();
    const request = {
      url: "/parties/main/demo",
      method: "GET",
      headers: { host: "localhost" },
    } as any;
    const socket = { destroy: vi.fn() } as any;

    transport.handleUpgrade(wsServer, request, socket, Buffer.alloc(0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    wsServer.socket.emit("message", JSON.stringify({
      action: "increment",
      value: { amount: 2 },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = await transport.fetch("/parties/main/demo/count");
    await expect(response.json()).resolves.toEqual({ count: 2 });
    expect(wsServer.socket.sent.length).toBeGreaterThan(0);
  });

  it("destroys invalid WebSocket upgrade paths", () => {
    const transport = createNodeRoomTransport(DemoServer);
    const wsServer = new FakeWebSocketServer();
    const request = {
      url: "/invalid",
      method: "GET",
      headers: { host: "localhost" },
    } as any;
    const socket = { destroy: vi.fn() } as any;

    transport.handleUpgrade(wsServer, request, socket, Buffer.alloc(0));

    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(wsServer.sockets).toHaveLength(0);
  });

  it("closes WebSocket connections when onConnect fails", async () => {
    const transport = createNodeRoomTransport(FailingConnectServer);
    const wsServer = new FakeWebSocketServer();
    const request = {
      url: "/parties/main/demo",
      method: "GET",
      headers: { host: "localhost" },
    } as any;

    transport.handleUpgrade(wsServer, request, { destroy: vi.fn() } as any, Buffer.alloc(0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wsServer.socket.closed).toBe(true);
    expect(wsServer.socket.closeCode).toBe(1011);
  });

  it("tracks connections, broadcasts, and removes them on close", async () => {
    const transport = createNodeRoomTransport(DemoServer);
    const wsServer = new FakeWebSocketServer();
    const request = {
      url: "/parties/main/demo",
      method: "GET",
      headers: { host: "localhost" },
    } as any;

    transport.handleUpgrade(wsServer, request, { destroy: vi.fn() } as any, Buffer.alloc(0));
    transport.handleUpgrade(wsServer, request, { destroy: vi.fn() } as any, Buffer.alloc(0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const room = await transport.getRoom("main", "demo");
    expect(Array.from(room.getConnections())).toHaveLength(2);

    for (const socket of wsServer.sockets) {
      socket.sent = [];
    }

    room.broadcast("hello");
    expect(wsServer.sockets[0].sent).toEqual(["hello"]);
    expect(wsServer.sockets[1].sent).toEqual(["hello"]);

    wsServer.sockets[0].emit("close");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(Array.from(room.getConnections())).toHaveLength(1);
  });

  it("forwards WebSocket errors to the room server", async () => {
    const onError = vi.spyOn(DemoServer.prototype, "onError");
    const transport = createNodeRoomTransport(DemoServer);
    const wsServer = new FakeWebSocketServer();
    const request = {
      url: "/parties/main/demo",
      method: "GET",
      headers: { host: "localhost" },
    } as any;
    const error = new Error("socket failed");

    transport.handleUpgrade(wsServer, request, { destroy: vi.fn() } as any, Buffer.alloc(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    wsServer.socket.emit("error", error);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledWith(expect.anything(), error);
    onError.mockRestore();
  });

  it("supports room-to-room fetch through context.parties", async () => {
    const transport = createNodeRoomTransport(DemoServer);
    await transport.fetch("/parties/main/demo/increment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 4 }),
    });

    const response = await transport.fetch("/parties/main/demo/peer/demo");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 4 });
  });

  it("keeps default storage isolated per room id", async () => {
    const transport = createNodeRoomTransport(DemoServer);
    const roomA = await transport.getRoom("main", "demo");
    const roomB = await transport.getRoom("main", "other");

    await roomA.storage.put("value", "a");
    await roomB.storage.put("value", "b");

    await expect(roomA.storage.get("value")).resolves.toBe("a");
    await expect(roomB.storage.get("value")).resolves.toBe("b");
  });
});
