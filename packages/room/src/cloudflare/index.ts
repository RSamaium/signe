import type {
  DurableObjectNamespace,
  DurableObjectState,
  WebSocket as CloudflareWebSocket,
} from "@cloudflare/workers-types";
import type * as Party from "../types/party";

export type CloudflareRoomServerConstructor<TServer extends Party.Server = Party.Server> = {
  new (room: Party.Room): TServer;
};

export type CloudflareRoomWorkerOptions = {
  binding: string;
  partiesPath?: string;
  env?: Record<string, unknown>;
  rooms?: Record<string, CloudflareRoomServerConstructor>;
};

export type CloudflareRoomEnv = Record<string, unknown>;

type ParsedPartyPath = {
  namespace: string;
  roomId: string;
};

type CloudflareRoomRecord = {
  room: CloudflareRoom;
  server: Party.Server;
  started: Promise<void>;
};

type CloudflareRuntimeConfig = Required<Pick<CloudflareRoomWorkerOptions, "binding" | "partiesPath">> & {
  ServerClass: CloudflareRoomServerConstructor;
  env: Record<string, unknown>;
  rooms: Record<string, CloudflareRoomServerConstructor>;
};

const DEFAULT_PARTIES_PATH = "/parties/main";
const WEBSOCKET_OPEN = 1;

let runtimeConfig: CloudflareRuntimeConfig | undefined;

export function createCloudflareRoomWorker<TServer extends Party.Server>(
  ServerClass: CloudflareRoomServerConstructor<TServer>,
  options: CloudflareRoomWorkerOptions
) {
  runtimeConfig = createRuntimeConfig(ServerClass, options);

  return {
    async fetch(
      request: Request,
      env: CloudflareRoomEnv,
      ctx: unknown
    ): Promise<Response> {
      return dispatchCloudflareRoomRequest(request, env, ctx);
    },
  };
}

export async function dispatchCloudflareRoomRequest(
  request: Request,
  env: CloudflareRoomEnv,
  _ctx?: unknown
): Promise<Response> {
  const config = getRuntimeConfig();
  const parsed = parsePartyRequest(request.url, config.partiesPath);

  if (!parsed) {
    return new Response("Not Found", { status: 404 });
  }

  const namespace = getNamespace(env, config.binding);
  const stub = namespace.get(namespace.idFromName(parsed.roomId));
  return fetchDurableObjectStub(stub, request);
}

export class SigneRoomDurableObject {
  private recordPromise?: Promise<CloudflareRoomRecord>;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: CloudflareRoomEnv
  ) {}

  async fetch(request: Request): Promise<Response> {
    const config = getRuntimeConfig();
    const parsed = parsePartyRequest(request.url, config.partiesPath);

    if (!parsed) {
      return new Response("Not Found", { status: 404 });
    }

    if (isWebSocketUpgrade(request)) {
      return this.acceptWebSocket(request, parsed);
    }

    const record = await this.getRecord(parsed);
    return record.server.onRequest?.(request as unknown as Party.Request)
      ?? new Response("Not Found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const record = await this.recordPromise;
    await record?.server.onAlarm?.();
  }

  private async acceptWebSocket(
    request: Request,
    parsed: ParsedPartyPath
  ): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [
      CloudflareWebSocket,
      CloudflareWebSocket,
    ];
    const record = await this.getRecord(parsed);
    const connection = new CloudflareConnection(
      server,
      request.url,
      getConnectionIdFromUrl(request.url)
    );

    server.accept();

    await record.server.onConnect?.(connection as unknown as Party.Connection, {
      request: request as unknown as Party.Request,
    });

    server.addEventListener("message", (event) => {
      void record.server.onMessage?.(
        normalizeWebSocketMessage(event.data),
        connection as unknown as Party.Connection
      );
    });
    server.addEventListener("close", () => {
      record.room.deleteConnection(connection.id, connection);
      void record.server.onClose?.(connection as unknown as Party.Connection);
    });
    server.addEventListener("error", (event) => {
      const errorData = (event as { error?: unknown; message?: string }).error;
      const error = errorData instanceof Error
        ? errorData
        : new Error((event as { message?: string }).message ?? "Cloudflare WebSocket error");
      void record.server.onError?.(connection as unknown as Party.Connection, error);
    });
    record.room.addConnection(connection);

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit & { webSocket: CloudflareWebSocket });
  }

  private async getRecord(parsed: ParsedPartyPath): Promise<CloudflareRoomRecord> {
    if (!this.recordPromise) {
      this.recordPromise = this.createRecord(parsed);
    }

    return this.recordPromise;
  }

  private async createRecord(parsed: ParsedPartyPath): Promise<CloudflareRoomRecord> {
    const config = getRuntimeConfig();
    const ServerClass = config.rooms[parsed.namespace] ?? config.ServerClass;
    const room = new CloudflareRoom({
      id: parsed.roomId,
      name: parsed.namespace,
      env: {
        ...config.env,
        ...this.env,
      },
      state: this.ctx,
      binding: config.binding,
      partiesPath: config.partiesPath,
    });
    const server = new ServerClass(room as Party.Room);
    const record: CloudflareRoomRecord = {
      room,
      server,
      started: Promise.resolve(server.onStart?.()).then(() => undefined),
    };

    await record.started;
    return record;
  }
}

export class CloudflareRoom implements Party.Room {
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
    state: DurableObjectState;
    binding: string;
    partiesPath: string;
  }) {
    this.id = options.id;
    this.internalID = `${options.name}:${options.id}`;
    this.name = options.name;
    this.env = options.env;
    this.storage = options.state.storage as Party.Storage;
    this.parties = createPartiesContext(options.env, options.binding, options.partiesPath);
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
    this.blockConcurrencyWhile = options.state.blockConcurrencyWhile.bind(options.state);
  }

  blockConcurrencyWhile: Party.Room["blockConcurrencyWhile"];

  broadcast(msg: string | ArrayBuffer | ArrayBufferView, without: string[] = []) {
    for (const connection of this.connections.values()) {
      if (!without.includes(connection.id)) {
        connection.send(msg);
      }
    }
  }

  getConnection<TState = unknown>(id: string): Party.Connection<TState> | undefined {
    let connection: Party.Connection | undefined;
    for (const current of this.connections.values()) {
      if (current.id === id || current.sessionId === id) {
        connection = current;
      }
    }
    return connection as Party.Connection<TState> | undefined;
  }

  getConnections<TState = unknown>(): Iterable<Party.Connection<TState>> {
    return Array.from(this.connections.values()) as Party.Connection<TState>[];
  }

  addConnection(connection: CloudflareConnection) {
    this.connections.set(connection.id, connection as unknown as Party.Connection);
  }

  deleteConnection(id: string, connection?: CloudflareConnection) {
    if (connection) {
      this.connections.delete(connection.id);
      return;
    }

    for (const [connectionKey, current] of this.connections) {
      if (current.id === id || current.sessionId === id) {
        this.connections.delete(connectionKey);
      }
    }
  }
}

export class CloudflareConnection<TState = unknown> {
  readonly id = createConnectionId();
  readonly sessionId: string;
  readonly socket: this = this;
  readonly uri: string;
  state: Party.ConnectionState<TState> | TState | null = null;
  private attachment: unknown = null;

  constructor(
    private readonly webSocket: CloudflareWebSocket,
    uri: string,
    sessionId?: string
  ) {
    this.sessionId = sessionId || this.id;
    this.uri = uri;
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
    if (
      this.webSocket.readyState === undefined ||
      this.webSocket.readyState === WEBSOCKET_OPEN
    ) {
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

function createRuntimeConfig<TServer extends Party.Server>(
  ServerClass: CloudflareRoomServerConstructor<TServer>,
  options: CloudflareRoomWorkerOptions
): CloudflareRuntimeConfig {
  return {
    ServerClass: ServerClass as CloudflareRoomServerConstructor,
    binding: options.binding,
    partiesPath: normalizePath(options.partiesPath ?? DEFAULT_PARTIES_PATH),
    env: options.env ?? {},
    rooms: {
      main: ServerClass as CloudflareRoomServerConstructor,
      ...(options.rooms ?? {}),
    },
  };
}

function getRuntimeConfig(): CloudflareRuntimeConfig {
  if (!runtimeConfig) {
    throw new Error(
      "createCloudflareRoomWorker() must be called before using SigneRoomDurableObject."
    );
  }

  return runtimeConfig;
}

function createPartiesContext(
  env: Record<string, unknown>,
  binding: string,
  partiesPath: string
): Party.Context["parties"] {
  return new Proxy({}, {
    get(_target, namespace: string) {
      return {
        get(roomId: string) {
          return {
            connect: () => {
              throw new Error("Party stub connect() is not implemented by @signe/room/cloudflare");
            },
            socket: async () => {
              throw new Error("Party stub socket() is not implemented by @signe/room/cloudflare");
            },
            fetch(pathOrInit?: string | RequestInit | Request, init?: RequestInit) {
              const namespaceBinding = getNamespace(env, binding);
              const stub = namespaceBinding.get(namespaceBinding.idFromName(roomId));
              if (pathOrInit instanceof Request) {
                return fetchDurableObjectStub(stub, pathOrInit);
              }
              const path = typeof pathOrInit === "string" ? pathOrInit : "/";
              const requestInit = typeof pathOrInit === "string" ? init : pathOrInit;
              return fetchDurableObjectStub(
                stub,
                toLocalUrl(`${getNamespacePath(partiesPath, namespace, roomId)}${normalizeStubPath(path)}`),
                requestInit as RequestInit | undefined
              );
            },
          };
        },
      };
    },
  }) as Party.Context["parties"];
}

function getNamespace(env: Record<string, unknown>, binding: string) {
  const namespace = env[binding] as DurableObjectNamespace | undefined;

  if (!namespace) {
    throw new Error(`Missing Durable Object binding: ${binding}`);
  }

  return namespace;
}

function fetchDurableObjectStub(
  stub: unknown,
  input: Request | string | URL,
  init?: RequestInit
): Promise<Response> {
  return (stub as {
    fetch(request: Request | string | URL, init?: RequestInit): Promise<Response>;
  }).fetch(input, init);
}

function parsePartyRequest(url: string, partiesPath: string): ParsedPartyPath | null {
  const requestUrl = new URL(url);
  const segments = trimSlashes(requestUrl.pathname).split("/");
  const configuredSegments = trimSlashes(partiesPath).split("/");
  const baseSegments = configuredSegments.slice(0, -1);

  if (segments.length < baseSegments.length + 2) {
    return null;
  }

  for (let index = 0; index < baseSegments.length; index++) {
    if (segments[index] !== baseSegments[index]) {
      return null;
    }
  }

  return {
    namespace: decodeURIComponent(segments[baseSegments.length]),
    roomId: decodeURIComponent(segments[baseSegments.length + 1]),
  };
}

function getNamespacePath(partiesPath: string, namespace: string, roomId: string) {
  const baseSegments = trimSlashes(partiesPath).split("/").slice(0, -1);
  return `/${[...baseSegments, namespace, encodeURIComponent(roomId)].join("/")}`;
}

function isWebSocketUpgrade(request: Request) {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
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

function toLocalUrl(path: string) {
  return path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `http://localhost${path.startsWith("/") ? path : `/${path}`}`;
}

function normalizeStubPath(path: string) {
  if (!path || path === "/") {
    return "";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function getConnectionIdFromUrl(url: string) {
  const requestedId = new URL(url).searchParams.get("id")?.trim();
  return requestedId || undefined;
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function createConnectionId() {
  return Math.random().toString(36).slice(2, 12);
}

declare const WebSocketPair: {
  new (): {
    0: CloudflareWebSocket;
    1: CloudflareWebSocket;
  };
};
