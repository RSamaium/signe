import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryNodeRoomStorage, createNodeRoomTransport } from "@signe/room/node";
import { MainServer } from "./room";
import { AUTH_JWT_SECRET, ROOM_ORIGIN, SHARD_SECRET, WORLD_ORIGIN, WORLD_PORT } from "./shared";

const root = fileURLToPath(new URL(".", import.meta.url));
const storage = createMemoryNodeRoomStorage();

const transport = createNodeRoomTransport(MainServer, {
  partiesPath: "/parties/main",
  storage,
  env: {
    AUTH_JWT_SECRET,
    SHARD_SECRET,
  },
  rooms: {
    world: MainServer,
  },
});

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/parties/world/")) {
      await transport.handleNodeRequest(req, res);
      return;
    }

    if (req.url?.startsWith("/api/world/")) {
      await handleWorldApi(req, res);
      return;
    }

    if (req.url?.startsWith("/api/room/")) {
      await handleRoomApi(req, res);
      return;
    }

    if (req.url === "/" || req.url === "/index.html" || req.url?.startsWith("/rooms/")) {
      const html = await readFile(join(root, "public/index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  } catch (error) {
    console.error(error);
    writeJson(res, 500, { error: "Internal Server Error" });
  }
});

server.listen(WORLD_PORT, () => {
  console.log(`World process: ${WORLD_ORIGIN}`);
  console.log(`Dashboard:     ${WORLD_ORIGIN}`);
  console.log(`Room process:  ${ROOM_ORIGIN}`);
});

async function handleWorldApi(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const match = url.pathname.match(/^\/api\/world\/([^/]+)\/([^/]+)$/);

  if (!match) {
    writeJson(res, 404, { error: "Not Found" });
    return;
  }

  const worldId = decodeURIComponent(match[1]);
  const action = match[2];

  if (req.method === "GET" && action === "dashboard") {
    await proxyWorld(res, worldId, "/dashboard", { method: "GET" });
    return;
  }

  if (req.method === "POST" && action === "connect") {
    const body = await readJson(req);
    await proxyWorld(res, worldId, "/connect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return;
  }

  if (req.method === "POST" && action === "scale") {
    const body = await readJson(req);
    await proxyWorld(res, worldId, "/scale-room", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return;
  }

  if (req.method === "POST" && action === "shard-status") {
    const body = await readJson(req);
    await proxyWorld(res, worldId, "/update-shard", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return;
  }

  writeJson(res, 404, { error: "Not Found" });
}

async function handleRoomApi(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const match = url.pathname.match(/^\/api\/room\/([^/]+)\/([^/]+)$/);

  if (!match) {
    writeJson(res, 404, { error: "Not Found" });
    return;
  }

  const roomId = decodeURIComponent(match[1]);
  const action = match[2];

  if (req.method === "POST" && action === "reset") {
    const response = await fetch(`${ROOM_ORIGIN}/parties/main/${encodeURIComponent(roomId)}/reset`, {
      method: "POST",
    });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  writeJson(res, 404, { error: "Not Found" });
}

async function proxyWorld(
  res: ServerResponse,
  worldId: string,
  path: string,
  init: RequestInit
) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("x-access-shard", SHARD_SECRET);

  const response = await transport.fetch(`/parties/world/${encodeURIComponent(worldId)}${path}`, {
    ...init,
    headers,
  });

  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
