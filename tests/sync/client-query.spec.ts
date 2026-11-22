import { describe, expect, it } from "vitest";
import { connectionRoom } from "../../packages/sync/src/client";

/** URL the socket would open (PartySocket keeps a URL provider). */
const urlOf = async (conn: any): Promise<URL> => {
  const provider = conn._url;
  const url = typeof provider === "function" ? await provider() : provider;
  return new URL(url);
};

describe("connectionRoom query flags", () => {
  it("asks for the formats on the first connection", async () => {
    const { conn } = await connectionRoom({ host: "localhost:1", room: "a", startClosed: true, compression: true, pathFormat: true, query: { id: "1" } } as any, {});
    const url = await urlOf(conn);
    expect(url.searchParams.get("compression")).toBe("deflate");
    expect(url.searchParams.get("format")).toBe("paths");
    expect(url.searchParams.get("id")).toBe("1");
  });

  it("keeps them when the application replaces the query (room change)", async () => {
    const { conn } = await connectionRoom({ host: "localhost:1", room: "a", startClosed: true, compression: true, pathFormat: true } as any, {});
    conn.updateProperties({ room: "b", query: { transferToken: "t" } });
    const url = await urlOf(conn);
    expect(url.pathname).toContain("/b");
    expect(url.searchParams.get("transferToken")).toBe("t");
    expect(url.searchParams.get("compression")).toBe("deflate");
    expect(url.searchParams.get("format")).toBe("paths");
  });

  it("adds nothing when no format is asked", async () => {
    const { conn } = await connectionRoom({ host: "localhost:1", room: "a", startClosed: true } as any, {});
    conn.updateProperties({ room: "b", query: { transferToken: "t" } });
    const url = await urlOf(conn);
    expect(url.searchParams.has("compression")).toBe(false);
    expect(url.searchParams.has("format")).toBe(false);
  });
});
