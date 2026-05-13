import { afterEach, describe, expect, it, vi } from "vitest";
import { Shard } from "../../packages/room/src/shard";

describe("Shard unit behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createRoom = (overrides: Record<string, unknown> = {}) => ({
    id: "game:shard-1",
    env: { SHARD_SECRET: "shard-secret" },
    broadcast: vi.fn(),
    context: {
      parties: {
        main: { get: vi.fn() },
        world: { get: vi.fn() },
      },
    },
    ...overrides,
  });

  it("warns and skips startup when the main room stub is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const room = createRoom();
    const shard = new Shard(room as any);

    await shard.onStart();

    expect(room.context.parties.main.get).toHaveBeenCalledWith("game");
    expect(console.warn).toHaveBeenCalledWith("No room room stub found in main party context");
    expect(shard.mainServerStub).toBeUndefined();
  });

  it("broadcasts main server messages without target clients", async () => {
    const listeners = new Map<string, (event: any) => void>();
    const ws = {
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    };
    const room = createRoom({
      context: {
        parties: {
          main: { get: vi.fn(() => ({ socket: vi.fn().mockResolvedValue(ws) })) },
          world: { get: vi.fn() },
        },
      },
    });
    const shard = new Shard(room as any);

    await shard.onStart();
    listeners.get("message")?.({ data: JSON.stringify({ type: "announcement" }) });

    expect(room.broadcast).toHaveBeenCalledWith(JSON.stringify({ type: "announcement" }));
  });

  it("logs malformed main server messages", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const listeners = new Map<string, (event: any) => void>();
    const ws = {
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    };
    const room = createRoom({
      context: {
        parties: {
          main: { get: vi.fn(() => ({ socket: vi.fn().mockResolvedValue(ws) })) },
          world: { get: vi.fn() },
        },
      },
    });
    const shard = new Shard(room as any);

    await shard.onStart();
    listeners.get("message")?.({ data: "not-json" });

    expect(console.error).toHaveBeenCalledWith("Error processing message from main server:", expect.any(Error));
  });

  it("updates world stats and records the reported connection count", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const room = createRoom({
      context: {
        parties: {
          main: { get: vi.fn() },
          world: { get: vi.fn(() => ({ fetch })) },
        },
      },
    });
    const shard = new Shard(room as any);
    shard.connectionMap.set("private-1", new Set([{ id: "conn-1" } as any]));

    await expect(shard.updateWorldStats()).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith("/update-shard", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ shardId: "game:shard-1", connections: 1 }),
    }));
    expect(shard.lastReportedConnections).toBe(1);
  });

  it("reports failed world stat updates", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "denied" }), { status: 403 }));
    const room = createRoom({
      context: {
        parties: {
          main: { get: vi.fn() },
          world: { get: vi.fn(() => ({ fetch })) },
        },
      },
    });
    const shard = new Shard(room as any);
    shard.connectionMap.set("private-1", new Set([{ id: "conn-1" } as any]));

    await expect(shard.updateWorldStats()).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith("Failed to update World stats: 403 - denied");
  });

  it("returns false when world stat updates throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const room = createRoom({
      context: {
        parties: {
          main: { get: vi.fn() },
          world: { get: vi.fn(() => ({ fetch: vi.fn().mockRejectedValue(new Error("network")) })) },
        },
      },
    });
    const shard = new Shard(room as any);
    shard.connectionMap.set("private-1", new Set([{ id: "conn-1" } as any]));

    await expect(shard.updateWorldStats()).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith("Error updating World stats:", expect.any(Error));
  });

  it("forwards non-GET HTTP requests with shard headers", async () => {
    const forwarded = new Response(JSON.stringify({ ok: true }), { status: 202 });
    const fetch = vi.fn().mockResolvedValue(forwarded);
    const shard = new Shard(createRoom() as any);
    shard.mainServerStub = { fetch };

    const response = await shard.onRequest(new Request("https://example.com/api/action?x=1", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
      body: "payload",
    }) as any);

    expect(response).toBe(forwarded);
    expect(fetch).toHaveBeenCalledWith("/api/action", expect.objectContaining({
      method: "POST",
      body: "payload",
    }));
    const headers = fetch.mock.calls[0][1].headers as Headers;
    expect(headers.get("x-shard-id")).toBe("game:shard-1");
    expect(headers.get("x-forwarded-by-shard")).toBe("true");
    expect(headers.get("x-original-client-ip")).toBe("203.0.113.10");
  });

  it("returns an error response when request forwarding fails", async () => {
    const shard = new Shard(createRoom() as any);
    shard.mainServerStub = { fetch: vi.fn().mockRejectedValue(new Error("downstream")) };

    const response = await shard.onRequest(new Request("https://example.com/api/action") as any);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Error forwarding request" });
  });

  it("runs stat updates from alarms", async () => {
    const shard = new Shard(createRoom() as any);
    const updateWorldStats = vi.spyOn(shard, "updateWorldStats").mockResolvedValue(true);

    await shard.onAlarm();

    expect(updateWorldStats).toHaveBeenCalled();
  });
});
