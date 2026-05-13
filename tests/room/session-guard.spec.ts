import { describe, expect, it, vi, afterEach } from "vitest";
import { createRequireSessionGuard, requireSession } from "../../packages/room/src/session.guard";

describe("session guards", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createStorage = (session: unknown, reject = false) => ({
    get: vi.fn().mockImplementation(() => reject ? Promise.reject(new Error("storage failed")) : Promise.resolve(session)),
  });

  it("requires a sender with an id", async () => {
    const storage = createStorage({ publicId: "user-1" });
    const guard = createRequireSessionGuard(storage as any);

    await expect(guard(undefined as any, {})).resolves.toBe(false);
    await expect(guard({} as any, {})).resolves.toBe(false);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("accepts sessions found by session id or connection id", async () => {
    const storage = createStorage({ publicId: "user-1", connected: true });
    const guard = createRequireSessionGuard(storage as any);

    await expect(guard({ id: "conn-1", sessionId: "private-1" } as any, {})).resolves.toBe(true);
    await expect(guard({ id: "conn-2" } as any, {})).resolves.toBe(true);

    expect(storage.get).toHaveBeenNthCalledWith(1, "session:private-1");
    expect(storage.get).toHaveBeenNthCalledWith(2, "session:conn-2");
  });

  it("rejects missing or malformed sessions", async () => {
    const missingGuard = createRequireSessionGuard(createStorage(undefined) as any);
    const malformedGuard = createRequireSessionGuard(createStorage({ connected: true }) as any);

    await expect(missingGuard({ id: "conn-1" } as any, {})).resolves.toBe(false);
    await expect(malformedGuard({ id: "conn-1" } as any, {})).resolves.toBe(false);
  });

  it("rejects when storage access fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const guard = createRequireSessionGuard(createStorage(null, true) as any);

    await expect(guard({ id: "conn-1" } as any, {})).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      "Error checking session in requireSession guard:",
      expect.any(Error),
    );
  });

  it("uses the room storage in the exported requireSession guard", async () => {
    const storage = createStorage({ publicId: "user-1" });
    const room = { storage };

    await expect(requireSession({ id: "conn-1", sessionId: "private-1" } as any, {}, room as any)).resolves.toBe(true);
    expect(storage.get).toHaveBeenCalledWith("session:private-1");
  });
});
