import { describe, expect, it } from "vitest";
import { signal } from "../../packages/reactive/src";
import { Room, Server } from "../../packages/room/src";
import {
  createMemoryNodeRoomStorage,
  createNodeRoomTransport,
  type NodeWebSocketLike,
} from "../../packages/room/src/node";
import { connected, users } from "../../packages/sync/src";

class TestUser {
  @connected() connected = signal(false);
}

@Room({ path: "{roomId}", sessionExpiryTime: 50 })
class TestRoom {
  @users(TestUser) users = signal<Record<string, TestUser>>({});
}

class TestServer extends Server {
  rooms = [TestRoom];
}

class FakeWebSocket implements NodeWebSocketLike {
  readyState = 1;
  sent: Array<string | ArrayBuffer | ArrayBufferView> = [];
  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  on(event: string, listener: (...args: any[]) => void) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  emit(event: string, ...args: any[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

describe("Node room adapter sessions", () => {
  it("uses the explicit websocket id query parameter as the private session id", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(TestServer, { storage });
    const ws = new FakeWebSocket();

    const connection = await transport.acceptWebSocket(
      ws,
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );

    const room = await transport.getRoom("main", "demo");
    const session = await room.storage.get<{ publicId: string; connected: boolean }>(
      "session:browser-session"
    );

    expect(connection.id).not.toBe("browser-session");
    expect(connection.sessionId).toBe("browser-session");
    expect(session?.publicId).toBeTypeOf("string");
    expect(session?.connected).toBe(true);
  });

  it("restores the same public user when reconnecting with the same id", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(TestServer, { storage });

    const firstWs = new FakeWebSocket();
    await transport.acceptWebSocket(
      firstWs,
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );

    const room = await transport.getRoom("main", "demo");
    const firstSession = await room.storage.get<{ publicId: string }>(
      "session:browser-session"
    );

    firstWs.close();
    await nextTick();

    const secondWs = new FakeWebSocket();
    await transport.acceptWebSocket(
      secondWs,
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );

    const secondSession = await room.storage.get<{ publicId: string; connected: boolean }>(
      "session:browser-session"
    );

    expect(secondSession?.publicId).toBe(firstSession?.publicId);
    expect(secondSession?.connected).toBe(true);
  });

  it("keeps multiple active websockets for the same session id", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(TestServer, { storage });
    const firstWs = new FakeWebSocket();
    const secondWs = new FakeWebSocket();

    await transport.acceptWebSocket(
      firstWs,
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );
    await transport.acceptWebSocket(
      secondWs,
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );

    const room = await transport.getRoom("main", "demo");
    const session = await room.storage.get<{ publicId: string; connected: boolean }>(
      "session:browser-session"
    );

    expect(Array.from(room.getConnections())).toHaveLength(2);
    expect(session?.connected).toBe(true);

    firstWs.sent = [];
    secondWs.sent = [];
    room.broadcast("hello");

    expect(firstWs.sent).toEqual(["hello"]);
    expect(secondWs.sent).toEqual(["hello"]);

    firstWs.sent = [];
    secondWs.sent = [];
    room.broadcast("without-first", [firstConnectionId(room, "browser-session")!]);

    expect(firstWs.sent).toEqual([]);
    expect(secondWs.sent).toEqual(["without-first"]);

    firstWs.close();
    await nextTick();

    const stillConnectedSession = await room.storage.get<{ connected: boolean }>(
      "session:browser-session"
    );

    expect(Array.from(room.getConnections())).toHaveLength(1);
    expect(stillConnectedSession?.connected).toBe(true);

    secondWs.sent = [];
    room.broadcast("after-close");

    expect(secondWs.sent).toEqual(["after-close"]);

    secondWs.close();
    await nextTick();

    const disconnectedSession = await room.storage.get<{ connected: boolean }>(
      "session:browser-session"
    );

    expect(disconnectedSession?.connected).toBe(false);
  });

  it("creates distinct users for websocket connections without an explicit id", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(TestServer, { storage });

    const first = await transport.acceptWebSocket(
      new FakeWebSocket(),
      new Request("http://localhost/parties/main/demo")
    );
    const second = await transport.acceptWebSocket(
      new FakeWebSocket(),
      new Request("http://localhost/parties/main/demo")
    );

    const room = await transport.getRoom("main", "demo");
    const firstSession = await room.storage.get<{ publicId: string }>(`session:${first.id}`);
    const secondSession = await room.storage.get<{ publicId: string }>(`session:${second.id}`);

    expect(first.id).not.toBe(second.id);
    expect(firstSession?.publicId).not.toBe(secondSession?.publicId);
  });

  it("marks a session offline when the websocket closes", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(TestServer, { storage });
    const ws = new FakeWebSocket();

    await transport.acceptWebSocket(
      ws,
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );

    ws.close();
    await nextTick();

    const room = await transport.getRoom("main", "demo");
    const session = await room.storage.get<{ connected: boolean }>("session:browser-session");

    expect(session?.connected).toBe(false);
  });

  it("expires disconnected sessions after the room sessionExpiryTime", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(TestServer, { storage });
    const ws = new FakeWebSocket();

    await transport.acceptWebSocket(
      ws,
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );

    const room = await transport.getRoom("main", "demo");
    const session = await room.storage.get<{ publicId: string }>("session:browser-session");
    const publicId = session!.publicId;

    ws.close();
    await sleep(70);

    await transport.acceptWebSocket(
      new FakeWebSocket(),
      new Request("http://localhost/parties/main/demo?id=gc-trigger")
    );

    await nextTick();

    expect(await room.storage.get("session:browser-session")).toBeUndefined();
    expect(await room.storage.get(`users.${publicId}`)).toBeUndefined();
  });

  it("runs session expiration after disconnect without waiting for another connection", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(TestServer, { storage });
    const expiringWs = new FakeWebSocket();
    const observerWs = new FakeWebSocket();

    await transport.acceptWebSocket(
      expiringWs,
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );

    const room = await transport.getRoom("main", "demo");
    const session = await room.storage.get<{ publicId: string }>("session:browser-session");
    const publicId = session!.publicId;

    await transport.acceptWebSocket(
      observerWs,
      new Request("http://localhost/parties/main/demo?id=observer")
    );

    observerWs.sent = [];
    expiringWs.close();

    await waitFor(async () => {
      expect(await room.storage.get("session:browser-session")).toBeUndefined();
      expect(await room.storage.get(`users.${publicId}`)).toBeUndefined();
      expect(syncValues(observerWs)).toContainEqual({
        users: {
          [publicId]: "$delete",
        },
      });
    });
  });

  it("keeps a long-lived session when it reconnects before the disconnect expiry window", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(TestServer, { storage });
    const ws = new FakeWebSocket();

    await transport.acceptWebSocket(
      ws,
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );

    const room = await transport.getRoom("main", "demo");
    const session = await room.storage.get<{ publicId: string }>("session:browser-session");

    await sleep(70);
    ws.close();
    await nextTick();

    await transport.acceptWebSocket(
      new FakeWebSocket(),
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );

    const reconnectedSession = await room.storage.get<{ publicId: string; connected: boolean }>(
      "session:browser-session"
    );

    expect(reconnectedSession?.publicId).toBe(session?.publicId);
    expect(reconnectedSession?.connected).toBe(true);
  });

  it("broadcasts a user deletion when a disconnected session expires", async () => {
    const storage = createMemoryNodeRoomStorage();
    const transport = createNodeRoomTransport(TestServer, { storage });
    const expiringWs = new FakeWebSocket();
    const observerWs = new FakeWebSocket();

    await transport.acceptWebSocket(
      expiringWs,
      new Request("http://localhost/parties/main/demo?id=browser-session")
    );

    const room = await transport.getRoom("main", "demo");
    const session = await room.storage.get<{ publicId: string }>("session:browser-session");
    const publicId = session!.publicId;

    await transport.acceptWebSocket(
      observerWs,
      new Request("http://localhost/parties/main/demo?id=observer")
    );

    observerWs.sent = [];
    expiringWs.close();
    await sleep(70);

    await transport.acceptWebSocket(
      new FakeWebSocket(),
      new Request("http://localhost/parties/main/demo?id=gc-trigger")
    );

    await nextTick();

    expect(syncValues(observerWs)).toContainEqual({
      users: {
        [publicId]: "$delete",
      },
    });
  });
});

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(assertion: () => void | Promise<void>, timeout = 500) {
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(10);
    }
  }

  throw lastError;
}

function syncValues(ws: FakeWebSocket) {
  return ws.sent
    .map((data) => JSON.parse(String(data)))
    .filter((packet) => packet.type === "sync")
    .map((packet) => packet.value);
}

function firstConnectionId(room: { getConnections: () => Iterable<{ id: string; sessionId?: string }> }, sessionId: string) {
  return Array.from(room.getConnections()).find((connection) => connection.sessionId === sessionId)?.id;
}
