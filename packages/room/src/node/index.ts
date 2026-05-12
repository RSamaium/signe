import type { IncomingMessage, ServerResponse as NodeServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import type * as Party from "../types/party";

export type NodeRoomStorage = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void | boolean>;
  list<T = unknown>(): Promise<Map<string, T>>;
};

export type NodeRoomStorageFactory = (
  namespace: string,
  roomId: string
) => NodeRoomStorage | Promise<NodeRoomStorage>;

export type NodeRoomStorageProvider = {
  getStorage(namespace: string, roomId: string): NodeRoomStorage | Promise<NodeRoomStorage>;
};

export type NodeMemoryStorageSnapshot = Record<string, [string, unknown][]>;

export type NodeSqliteDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number | bigint };
    all(...params: unknown[]): unknown[];
  };
};

export type NodeSqliteStorageOptions = {
  database?: NodeSqliteDatabase;
  databasePath?: string;
  tableName?: string;
};

export type NodeServerConstructor<TServer extends Party.Server = Party.Server> = {
  new (room: Party.Room): TServer;
};

export type NodeRoomTransportOptions = {
  partiesPath?: string;
  env?: Record<string, unknown>;
  storage?: NodeRoomStorageFactory | NodeRoomStorageProvider;
  rooms?: Record<string, NodeServerConstructor>;
};

export type NodeRequestNext = (error?: unknown) => void;

export type NodeWebSocketLike = {
  readyState?: number;
  send(data: string | ArrayBuffer | ArrayBufferView, cb?: (error?: Error) => void): void;
  close(code?: number, reason?: string | Buffer): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
};

export type NodeWebSocketServerLike = {
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    cb: (webSocket: NodeWebSocketLike) => void
  ): void;
  emit?(event: "connection", webSocket: NodeWebSocketLike, request: IncomingMessage): boolean;
};

type RoomRecord = {
  room: NodeRoom;
  server: Party.Server;
  started: Promise<void>;
};

type ParsedPartyPath = {
  namespace: string;
  roomId: string;
  restPath: string;
};

const DEFAULT_PARTIES_PATH = "/parties/main";
const WEBSOCKET_OPEN = 1;

export function createMemoryNodeRoomStorage(options: {
  snapshot?: NodeMemoryStorageSnapshot;
} = {}) {
  return new MemoryNodeRoomStorage(options);
}

export function createSqliteNodeRoomStorage(options: NodeSqliteStorageOptions) {
  return new SqliteNodeRoomStorage(options);
}

export function createNodeRoomTransport<TServer extends Party.Server>(
  ServerClass: NodeServerConstructor<TServer>,
  options: NodeRoomTransportOptions = {}
) {
  return new NodeRoomTransport(ServerClass, options);
}

export class MemoryNodeRoomStorage implements NodeRoomStorageProvider {
  private readonly rooms = new Map<string, Map<string, unknown>>();

  constructor(options: { snapshot?: NodeMemoryStorageSnapshot } = {}) {
    if (options.snapshot) {
      this.restore(options.snapshot);
    }
  }

  getStorage(namespace: string, roomId: string): NodeRoomStorage {
    const key = getStorageKey(namespace, roomId);
    let memory = this.rooms.get(key);

    if (!memory) {
      memory = new Map();
      this.rooms.set(key, memory);
    }

    return new MemoryNodeRoomStorageInstance(memory);
  }

  snapshot(): NodeMemoryStorageSnapshot {
    const snapshot: NodeMemoryStorageSnapshot = {};

    for (const [roomKey, memory] of this.rooms) {
      if (memory.size === 0) {
        continue;
      }

      snapshot[roomKey] = Array.from(memory.entries()).map(([key, value]) => [
        key,
        cloneStorageValue(value),
      ]);
    }

    return snapshot;
  }

  restore(snapshot: NodeMemoryStorageSnapshot) {
    this.clear();

    for (const [roomKey, entries] of Object.entries(snapshot)) {
      this.rooms.set(
        roomKey,
        new Map(entries.map(([key, value]) => [key, cloneStorageValue(value)]))
      );
    }
  }

  clear() {
    this.rooms.clear();
  }
}

class MemoryNodeRoomStorageInstance implements NodeRoomStorage {
  constructor(private readonly memory: Map<string, unknown>) {}

  async put<T = unknown>(key: string, value: T) {
    this.memory.set(key, value);
  }

  async get<T = unknown>(key: string) {
    return this.memory.get(key) as T | undefined;
  }

  async delete(key: string) {
    this.memory.delete(key);
  }

  async list<T = unknown>() {
    return new Map(this.memory) as Map<string, T>;
  }
}

export class SqliteNodeRoomStorage implements NodeRoomStorageProvider {
  private readonly tableName: string;
  private databasePromise?: Promise<NodeSqliteDatabase>;

  constructor(private readonly options: NodeSqliteStorageOptions) {
    if (!options.database && !options.databasePath) {
      throw new Error("createSqliteNodeRoomStorage requires `database` or `databasePath`.");
    }

    this.tableName = options.tableName ?? "signe_room_storage";
    assertSafeSqlIdentifier(this.tableName);
  }

  async getStorage(namespace: string, roomId: string): Promise<NodeRoomStorage> {
    const database = await this.getDatabase();
    await this.ensureSchema(database);
    return new SqliteNodeRoomStorageInstance(database, this.tableName, namespace, roomId);
  }

  private async getDatabase() {
    if (!this.databasePromise) {
      this.databasePromise = this.createDatabase();
    }

    return this.databasePromise;
  }

  private async createDatabase(): Promise<NodeSqliteDatabase> {
    if (this.options.database) {
      return this.options.database;
    }

    const sqliteModule = loadNodeSqliteModule();
    const { DatabaseSync } = sqliteModule;
    return new DatabaseSync(this.options.databasePath!) as NodeSqliteDatabase;
  }

  private async ensureSchema(database: NodeSqliteDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        namespace TEXT NOT NULL,
        room_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (namespace, room_id, key)
      )
    `);
  }
}

class SqliteNodeRoomStorageInstance implements NodeRoomStorage {
  constructor(
    private readonly database: NodeSqliteDatabase,
    private readonly tableName: string,
    private readonly namespace: string,
    private readonly roomId: string
  ) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = this.database
      .prepare(`
        SELECT value
        FROM ${this.tableName}
        WHERE namespace = ? AND room_id = ? AND key = ?
      `)
      .get(this.namespace, this.roomId, key) as { value: string } | undefined;

    return row ? JSON.parse(row.value) as T : undefined;
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO ${this.tableName} (namespace, room_id, key, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(namespace, room_id, key) DO UPDATE SET value = excluded.value
      `)
      .run(this.namespace, this.roomId, key, JSON.stringify(value));
  }

  async delete(key: string): Promise<boolean> {
    const result = this.database
      .prepare(`
        DELETE FROM ${this.tableName}
        WHERE namespace = ? AND room_id = ? AND key = ?
      `)
      .run(this.namespace, this.roomId, key);

    return Number(result.changes) > 0;
  }

  async list<T = unknown>(): Promise<Map<string, T>> {
    const rows = this.database
      .prepare(`
        SELECT key, value
        FROM ${this.tableName}
        WHERE namespace = ? AND room_id = ?
      `)
      .all(this.namespace, this.roomId) as { key: string; value: string }[];

    return new Map(rows.map((row) => [row.key, JSON.parse(row.value) as T]));
  }
}

export class NodeRoomTransport<TServer extends Party.Server = Party.Server> {
  readonly partiesPath: string;
  readonly env: Record<string, unknown>;
  private readonly rooms: Record<string, NodeServerConstructor>;
  private readonly storage: NodeRoomStorageFactory | NodeRoomStorageProvider;
  private readonly records = new Map<string, Promise<RoomRecord>>();

  constructor(
    private readonly ServerClass: NodeServerConstructor<TServer>,
    options: NodeRoomTransportOptions = {}
  ) {
    this.partiesPath = normalizePath(options.partiesPath ?? DEFAULT_PARTIES_PATH);
    this.env = options.env ?? {};
    this.rooms = {
      main: ServerClass,
      ...(options.rooms ?? {}),
    };
    this.storage = options.storage ?? createMemoryNodeRoomStorage();
  }

  async fetch(pathOrRequest: string | Request, init?: RequestInit): Promise<Response> {
    const request = typeof pathOrRequest === "string"
      ? new Request(toLocalUrl(pathOrRequest), init)
      : pathOrRequest;
    const parsed = this.parsePartyRequest(request.url);

    if (!parsed) {
      return new Response("Not Found", { status: 404 });
    }

    const record = await this.getRecord(parsed.namespace, parsed.roomId);
    return record.server.onRequest?.(request as unknown as Party.Request) ?? new Response("Not Found", { status: 404 });
  }

  async handleNodeRequest(
    req: IncomingMessage,
    res: NodeServerResponse,
    next?: NodeRequestNext
  ): Promise<void> {
    const url = getRequestUrl(req);

    if (!this.parsePartyRequest(url)) {
      if (next) {
        next();
        return;
      }
      await writeNodeResponse(res, new Response("Not Found", { status: 404 }));
      return;
    }

    try {
      const request = await createWebRequest(req, url);
      const response = await this.fetch(request);
      await writeNodeResponse(res, response);
    } catch (error) {
      if (next) {
        next(error);
        return;
      }
      await writeNodeResponse(res, new Response("Internal Server Error", { status: 500 }));
    }
  }

  handleUpgrade(
    wsServer: NodeWebSocketServerLike,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): void {
    const parsed = this.parsePartyRequest(getRequestUrl(request));

    if (!parsed) {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (webSocket) => {
      void this.acceptWebSocket(webSocket, request, parsed).catch(() => {
        webSocket.close(1011, "Unable to start room connection");
      });
      wsServer.emit?.("connection", webSocket, request);
    });
  }

  async acceptWebSocket(
    webSocket: NodeWebSocketLike,
    request: IncomingMessage | Request,
    parsedPath?: ParsedPartyPath
  ): Promise<NodeConnection> {
    const url = request instanceof Request ? request.url : getRequestUrl(request);
    const parsed = parsedPath ?? this.parsePartyRequest(url);

    if (!parsed) {
      webSocket.close(1008, "Invalid room path");
      throw new Error(`Unable to route WebSocket URL: ${url}`);
    }

    const record = await this.getRecord(parsed.namespace, parsed.roomId);
    const connection = new NodeConnection(webSocket, url);
    const connectRequest = request instanceof Request
      ? request
      : await createWebRequest(request, url, false);

    await record.server.onConnect?.(connection as unknown as Party.Connection, {
      request: connectRequest as unknown as Party.Request,
    });

    const onMessage = (data: unknown) => {
      void record.server.onMessage?.(normalizeWebSocketMessage(data), connection as unknown as Party.Connection);
    };
    const onClose = () => {
      record.room.deleteConnection(connection.id);
      void record.server.onClose?.(connection as unknown as Party.Connection);
    };
    const onError = (error: Error) => {
      void record.server.onError?.(connection as unknown as Party.Connection, error);
    };

    webSocket.on("message", onMessage);
    webSocket.on("close", onClose);
    webSocket.on("error", onError);
    record.room.addConnection(connection);

    return connection;
  }

  getRoom(namespace: string, roomId: string): Promise<NodeRoom> {
    return this.getRecord(namespace, roomId).then((record) => record.room);
  }

  getNamespacePath(namespace: string, roomId: string) {
    const baseSegments = trimSlashes(this.getPartiesBase()).split("/").slice(0, -1);
    return `/${[...baseSegments, namespace, encodeURIComponent(roomId)].join("/")}`;
  }

  private async getRecord(namespace: string, roomId: string): Promise<RoomRecord> {
    const key = `${namespace}:${roomId}`;
    const existing = this.records.get(key);

    if (existing) {
      return existing;
    }

    const recordPromise = this.createRecord(namespace, roomId);
    this.records.set(key, recordPromise);

    try {
      return await recordPromise;
    } catch (error) {
      this.records.delete(key);
      throw error;
    }
  }

  private async createRecord(namespace: string, roomId: string): Promise<RoomRecord> {
    const ServerClass = this.rooms[namespace] ?? this.ServerClass;
    const room = new NodeRoom({
      id: roomId,
      name: namespace,
      env: this.env,
      storage: await this.resolveStorage(namespace, roomId),
      transport: this,
    });
    const server = new ServerClass(room as Party.Room);
    const record: RoomRecord = {
      room,
      server,
      started: Promise.resolve(server.onStart?.()).then(() => undefined),
    };

    await record.started;
    return record;
  }

  private async resolveStorage(namespace: string, roomId: string): Promise<NodeRoomStorage> {
    if (typeof this.storage === "function") {
      return this.storage(namespace, roomId);
    }

    return this.storage.getStorage(namespace, roomId);
  }

  private parsePartyRequest(url: string): ParsedPartyPath | null {
    const requestUrl = new URL(url, "http://localhost");
    const partiesBase = this.getPartiesBase();
    const segments = trimSlashes(requestUrl.pathname).split("/");
    const configuredSegments = trimSlashes(partiesBase).split("/");
    const baseSegments = configuredSegments.slice(0, -1);

    if (segments.length < baseSegments.length + 2) {
      return null;
    }

    for (let index = 0; index < baseSegments.length; index++) {
      if (segments[index] !== baseSegments[index]) {
        return null;
      }
    }

    const namespace = decodeURIComponent(segments[baseSegments.length]);
    const roomId = decodeURIComponent(segments[baseSegments.length + 1]);
    const rest = segments.slice(baseSegments.length + 2).join("/");

    return {
      namespace,
      roomId,
      restPath: rest ? `/${rest}` : "/",
    };
  }

  private getPartiesBase() {
    return this.partiesPath;
  }
}

export class NodeRoom implements Party.Room {
  readonly id: string;
  readonly internalID: string;
  readonly name: string;
  readonly env: Record<string, unknown>;
  readonly storage: Party.Storage;
  readonly context: Party.Context;
  readonly connections = new Map<string, Party.Connection>();
  readonly parties: Party.Context["parties"];
  readonly analytics = {} as Party.Room["analytics"];

  constructor(options: {
    id: string;
    name: string;
    env: Record<string, unknown>;
    storage: NodeRoomStorage;
    transport: NodeRoomTransport;
  }) {
    this.id = options.id;
    this.internalID = `${options.name}:${options.id}`;
    this.name = options.name;
    this.env = options.env;
    this.storage = options.storage as Party.Storage;
    this.parties = createPartiesContext(options.transport);
    this.context = {
      parties: this.parties,
      ai: {},
      vectorize: {},
      analytics: this.analytics,
      assets: {
        fetch: async () => null,
      },
      bindings: {
        r2: {},
        kv: {},
      },
    } as Party.Context;
  }

  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }

  broadcast(msg: string | ArrayBuffer | ArrayBufferView, without: string[] = []) {
    for (const connection of this.connections.values()) {
      if (!without.includes(connection.id)) {
        connection.send(msg);
      }
    }
  }

  getConnection<TState = unknown>(id: string): Party.Connection<TState> | undefined {
    return this.connections.get(id) as Party.Connection<TState> | undefined;
  }

  getConnections<TState = unknown>(): Iterable<Party.Connection<TState>> {
    return Array.from(this.connections.values()) as Party.Connection<TState>[];
  }

  addConnection(connection: NodeConnection) {
    this.connections.set(connection.id, connection as unknown as Party.Connection);
  }

  deleteConnection(id: string) {
    this.connections.delete(id);
  }
}

export class NodeConnection<TState = unknown> {
  readonly id: string;
  readonly socket: this = this;
  readonly uri: string;
  state: Party.ConnectionState<TState> | TState | null = null;
  private attachment: unknown = null;

  constructor(
    private readonly webSocket: NodeWebSocketLike,
    uri: string,
    id = createConnectionId()
  ) {
    this.id = id;
    this.uri = uri;
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
    if (this.webSocket.readyState === undefined || this.webSocket.readyState === WEBSOCKET_OPEN) {
      this.webSocket.send(data);
    }
  }

  close(code?: number, reason?: string) {
    this.webSocket.close(code, reason);
  }

  setState(state: TState | Party.ConnectionSetStateFn<TState> | null) {
    this.state = typeof state === "function"
      ? (state as Party.ConnectionSetStateFn<TState>)(this.state as Party.ConnectionState<TState>)
      : state;
    return this.state as Party.ConnectionState<TState>;
  }

  serializeAttachment<T = unknown>(attachment: T): void {
    this.attachment = attachment;
  }

  deserializeAttachment<T = unknown>(): T | null {
    return this.attachment as T | null;
  }
}

function createPartiesContext(transport: NodeRoomTransport): Party.Context["parties"] {
  return new Proxy({}, {
    get(_target, namespace: string) {
      return {
        get(roomId: string) {
          return {
            connect: () => {
              throw new Error("Party stub connect() is not implemented by @signe/room/node");
            },
            socket: async () => {
              throw new Error("Party stub socket() is not implemented by @signe/room/node");
            },
            fetch(pathOrInit?: string | RequestInit | Request, init?: RequestInit) {
              const path = typeof pathOrInit === "string" ? pathOrInit : "/";
              const requestInit = typeof pathOrInit === "string" ? init : pathOrInit;
              return transport.fetch(`${transport.getNamespacePath(namespace, roomId)}${normalizeStubPath(path)}`, requestInit as RequestInit);
            },
          };
        },
      };
    },
  }) as Party.Context["parties"];
}

async function createWebRequest(req: IncomingMessage, url: string, includeBody = true): Promise<Request> {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  const method = req.method ?? "GET";
  const hasBody = includeBody && !["GET", "HEAD"].includes(method);
  const body = hasBody ? await readIncomingBody(req) : undefined;

  return new Request(url, {
    method,
    headers,
    body,
  });
}

async function readIncomingBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of req) {
    if (typeof chunk === "string") {
      chunks.push(new TextEncoder().encode(chunk));
    } else {
      chunks.push(chunk);
    }
  }

  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const body = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

async function writeNodeResponse(res: NodeServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const body = new Uint8Array(await response.arrayBuffer());
  res.end(body);
}

function getRequestUrl(req: IncomingMessage) {
  const protocol = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers.host ?? "localhost";
  return `${protocol}://${host}${req.url ?? "/"}`;
}

function normalizeWebSocketMessage(data: unknown): string | ArrayBuffer | ArrayBufferView {
  if (typeof data === "string" || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return data;
  }

  return String(data);
}

function normalizePath(path: string) {
  return `/${trimSlashes(path)}`;
}

function normalizeStubPath(path: string) {
  if (!path || path === "/") {
    return "";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function toLocalUrl(path: string) {
  return path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `http://localhost${path.startsWith("/") ? path : `/${path}`}`;
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function getStorageKey(namespace: string, roomId: string) {
  return `${encodeURIComponent(namespace)}:${encodeURIComponent(roomId)}`;
}

function assertSafeSqlIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQLite table name: ${identifier}`);
  }
}

function loadNodeSqliteModule(): typeof import("node:sqlite") {
  const require = createRequire(`${process.cwd()}/package.json`);
  return require("node:sqlite");
}

function cloneStorageValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }

  return value;
}

function createConnectionId() {
  return Math.random().toString(36).slice(2, 12);
}
