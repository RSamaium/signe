import { describe, expect, it, vi, afterEach } from "vitest";
import { ServerResponse } from "../../packages/room/src/request/response";
import { cors, createCorsInterceptor } from "../../packages/room/src/request/cors";

describe("ServerResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds chained JSON responses with headers", async () => {
    const response = await new ServerResponse()
      .status(201)
      .header("X-Test", "yes")
      .setHeaders({ "Cache-Control": "no-store" })
      .json({ ok: true });

    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("X-Test")).toBe("yes");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("sends the current body when no override is provided", async () => {
    const response = await new ServerResponse()
      .status(202)
      .body({ queued: true })
      .send();

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
  });

  it("sends an override body when provided", async () => {
    const response = await new ServerResponse()
      .body({ original: true })
      .send({ override: true });

    await expect(response.json()).resolves.toEqual({ override: true });
  });

  it("sends plain text without JSON stringifying", async () => {
    const response = await new ServerResponse()
      .status(203)
      .text("plain body");

    expect(response.status).toBe(203);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    await expect(response.text()).resolves.toBe("plain body");
  });

  it("applies interceptors to text responses and ignores failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await new ServerResponse([
      (res) => new Response(res.body, {
        status: 209,
        headers: { ...Object.fromEntries(res.headers), "X-Text": "yes" },
      }),
      () => {
        throw new Error("text interceptor failed");
      },
    ]).text("plain body");

    expect(response.status).toBe(209);
    expect(response.headers.get("X-Text")).toBe("yes");
    await expect(response.text()).resolves.toBe("plain body");
    expect(console.error).toHaveBeenCalledWith("Error in interceptor:", expect.any(Error));
  });

  it("applies sync and async interceptors in order", async () => {
    const response = await new ServerResponse([
      (res) => new Response(res.body, {
        status: 206,
        headers: { ...Object.fromEntries(res.headers), "X-First": "1" },
      }),
      async (res) => new Response(await res.text(), {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), "X-Second": "2" },
      }),
    ]).success({ ok: true });

    expect(response.status).toBe(206);
    expect(response.headers.get("X-First")).toBe("1");
    expect(response.headers.get("X-Second")).toBe("2");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("keeps the current response when an interceptor fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await new ServerResponse()
      .use(() => {
        throw new Error("boom");
      })
      .success({ ok: true });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(console.error).toHaveBeenCalledWith("Error in interceptor:", expect.any(Error));
  });

  it("creates redirects and standard error responses", async () => {
    const redirect = await new ServerResponse().redirect("/next", 301);
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("Location")).toBe("/next");

    await expect((await new ServerResponse().badRequest("Invalid", { field: "name" })).json())
      .resolves.toEqual({ error: "Invalid", field: "name" });
    await expect((await new ServerResponse().notPermitted()).json())
      .resolves.toEqual({ error: "Not permitted" });
    await expect((await new ServerResponse().unauthorized()).json())
      .resolves.toEqual({ error: "Unauthorized" });
    await expect((await new ServerResponse().notFound()).json())
      .resolves.toEqual({ error: "Not found" });
    await expect((await new ServerResponse().serverError()).json())
      .resolves.toEqual({ error: "Internal Server Error" });
  });
});

describe("cors", () => {
  it("adds default CORS headers", async () => {
    const response = cors(new Response("ok", { status: 200 }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PUT, DELETE, PATCH, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization, X-Requested-With");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  it("adds configured CORS headers through the interceptor factory", () => {
    const interceptor = createCorsInterceptor({
      origin: "https://app.example",
      credentials: true,
      exposedHeaders: ["X-Trace"],
      methods: ["GET", "OPTIONS"],
      allowedHeaders: ["Authorization"],
      maxAge: 60,
    });

    const response = interceptor(new Response("ok"));

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Trace");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("60");
  });
});
