import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Action, Request, Room, Server } from "../../packages/room/src";
import {
  createNodeRoomTransport,
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

describe("@signe/room/node", () => {
  let cleanup: (() => Promise<void> | void) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
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
