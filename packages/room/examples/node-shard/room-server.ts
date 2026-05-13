import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createMemoryNodeRoomStorage, createNodeRoomTransport } from "@signe/room/node";
import { MainServer, ShardServer } from "./room";
import { AUTH_JWT_SECRET, ROOM_ORIGIN, ROOM_PORT, SHARD_SECRET, WORLD_ORIGIN } from "./shared";

const storage = createMemoryNodeRoomStorage();

const transport = createNodeRoomTransport(MainServer, {
  partiesPath: "/parties/main",
  storage,
  env: {
    AUTH_JWT_SECRET,
    SHARD_SECRET,
  },
  rooms: {
    main: MainServer,
    shard: ShardServer,
  },
  externalParties: {
    world: {
      get(worldId: string) {
        return {
          fetch(pathOrInit?: string | RequestInit | Request, init?: RequestInit) {
            const path = typeof pathOrInit === "string" ? pathOrInit : "/";
            const requestInit = typeof pathOrInit === "string" ? init : pathOrInit;
            return fetch(`${WORLD_ORIGIN}/parties/world/${encodeURIComponent(worldId)}${normalizeStubPath(path)}`, requestInit as RequestInit);
          },
        };
      },
    },
  },
});

const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/parties/")) {
    await transport.handleNodeRequest(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

const wsServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  if (request.url?.startsWith("/parties/")) {
    transport.handleUpgrade(wsServer, request, socket, head);
    return;
  }

  socket.destroy();
});

server.listen(ROOM_PORT, () => {
  console.log(`Room process: ${ROOM_ORIGIN}`);
  console.log(`Main rooms:    ${ROOM_ORIGIN}/parties/main/demo/state`);
  console.log(`Shard rooms:   ws://localhost:${ROOM_PORT}/parties/shard/{shardId}`);
  console.log(`World origin:  ${WORLD_ORIGIN}`);
});

function normalizeStubPath(path: string) {
  if (!path || path === "/") {
    return "";
  }
  return path.startsWith("/") ? path : `/${path}`;
}
