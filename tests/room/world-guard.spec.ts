import { describe, expect, it } from "vitest";
import { JWTAuth } from "../../packages/room/src/jwt";
import { guardManageWorld } from "../../packages/room/src/world.guard";

describe("guardManageWorld", () => {
  const room = {
    env: {
      AUTH_JWT_SECRET: "auth-secret",
      SHARD_SECRET: "shard-secret",
    },
  };

  const request = (headers: Record<string, string> = {}, url = "https://example.com/world") => ({
    url,
    headers: new Headers(headers),
  });

  it("accepts valid shard secret headers", async () => {
    await expect(guardManageWorld(null, request({ "x-access-shard": "shard-secret" }) as any, room as any))
      .resolves.toBe(true);
  });

  it("rejects invalid shard secret headers before checking auth tokens", async () => {
    const token = await new JWTAuth("auth-secret").sign({ sub: "admin" });

    await expect(guardManageWorld(null, request({
      "x-access-shard": "wrong-secret",
      Authorization: token,
    }) as any, room as any)).resolves.toBe(false);
  });

  it("rejects requests without any token", async () => {
    await expect(guardManageWorld(null, request() as any, room as any)).resolves.toBe(false);
  });

  it("accepts valid authorization header tokens", async () => {
    const token = await new JWTAuth("auth-secret").sign({ sub: "admin" });

    await expect(guardManageWorld(null, request({ Authorization: token }) as any, room as any))
      .resolves.toBe(true);
  });

  it("accepts valid world auth query tokens", async () => {
    const token = await new JWTAuth("auth-secret").sign({ sub: "admin" });
    const url = `https://example.com/world?world-auth-token=${encodeURIComponent(token)}`;

    await expect(guardManageWorld(null, request({}, url) as any, room as any))
      .resolves.toBe(true);
  });

  it("rejects invalid JWT tokens", async () => {
    await expect(guardManageWorld(null, request({ Authorization: "not-a-token" }) as any, room as any))
      .resolves.toBe(false);
  });
});
