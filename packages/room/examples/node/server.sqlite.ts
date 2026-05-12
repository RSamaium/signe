import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createNodeRoomTransport, createSqliteNodeRoomStorage } from "@signe/room/node";
import { CounterServer } from "./room";

const root = fileURLToPath(new URL(".", import.meta.url));

const transport = createNodeRoomTransport(CounterServer, {
  partiesPath: "/parties/main",
  storage: createSqliteNodeRoomStorage({
    databasePath: join(root, "rooms.sqlite"),
  }),
});

const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/parties/main/")) {
    await transport.handleNodeRequest(req, res);
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
});

const wsServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  if (request.url?.startsWith("/parties/main/")) {
    transport.handleUpgrade(wsServer, request, socket, head);
    return;
  }

  socket.destroy();
});

server.listen(3000, () => {
  console.log("Signe Node room SQLite example: http://localhost:3000");
  console.log("SQLite file: packages/room/examples/node/rooms.sqlite");
  console.log("Room URL: http://localhost:3000/rooms/demo");
  console.log("HTTP endpoint: http://localhost:3000/parties/main/demo/count");
  console.log("WebSocket: ws://localhost:3000/parties/main/demo?name=Sam");
});
