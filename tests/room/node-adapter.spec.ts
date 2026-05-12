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

@Room({ path: "{roomId}" })
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

    expect(connection.id).toBe("browser-session");
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
});

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
