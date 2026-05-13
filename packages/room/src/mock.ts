import { generateShortUUID } from "../../sync/src/utils";
import { Server } from "./server";
import { Storage } from "./storage";
import { request } from "./testing";

export class MockPartyClient {
    private events: Map<string, Function[]> = new Map();
    id : string
    conn: MockConnection;

    constructor(public server: Server, sessionId?: string) {
      this.id = generateShortUUID()
      this.conn = new MockConnection(this, sessionId || this.id)
    }
    
    addEventListener(event, cb) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(cb);
    }

    removeEventListener(event, cb) {
        if (!this.events.has(event)) return;
        const callbacks = this.events.get(event);
        const index = callbacks.indexOf(cb);
        if (index !== -1) {
            callbacks.splice(index, 1);
        }
        if (callbacks.length === 0) {
            this.events.delete(event);
        }
    }

    _trigger(event, data) {
        const callbacks = this.events.get(event);
        if (callbacks) {
            for (const cb of callbacks) {
                cb(data);
            }
        }
    }

    send(data) {
        return this.server.onMessage(JSON.stringify(data), this.conn as any)
    }
}

class MockLobby {
  constructor(public server: Server, public lobbyId: string) {}

  socket(init?: { id?: string }) {
    return new MockPartyClient(this.server, init?.id)
  }

  async connection(idOrOptions?: string | { id?: string, query?: Record<string, string>, headers?: Record<string, string> }, maybeOptions?: { query?: Record<string, string>, headers?: Record<string, string> }) {
    const id = typeof idOrOptions === 'string' ? idOrOptions : idOrOptions?.id;
    const options = (typeof idOrOptions === 'string' ? maybeOptions : idOrOptions) || {};
    return (this.server.room as any).connection(this.server, id, options as any);
  }

  fetch(url: string, options: any) {
    const baseUrl = url.includes('shard') ? '' :( '/parties/main/' + this.lobbyId )
    return request(this.server, baseUrl + url, options)
  }
}

interface MockContextOptions {
  parties?: any;
  partyFn?: (roomId: string) => any;
}

class MockContext {
  parties: {
    main: any
  } = {
    main: new Map()
  }

  constructor(public room: MockPartyRoom, options: MockContextOptions = {}) {
    const parties = options.parties || {}
    if (options.partyFn) {
      const serverCache = new Map<string, MockLobby>();
      this.parties.main = {
        get: async (lobbyId: string) => {
          if (!serverCache.has(lobbyId)) {
            const server = await options.partyFn(lobbyId);
            serverCache.set(lobbyId, new MockLobby(server, lobbyId));
          }
          return serverCache.get(lobbyId)!;
        }
      }
    }
    else {
      for (let lobbyId in parties) {
        const server = parties[lobbyId](room)
        ;(this.parties.main as Map<string, any>).set(lobbyId, new MockLobby(server, lobbyId))
      }
    }
  }
}

class MockPartyRoom {
  clients: Map<string, MockPartyClient> = new Map();
  storage = new Storage();
  context: MockContext;
  env = {}

  constructor(public id?: string, options: any = {}) {
    this.id = id || generateShortUUID()
    this.context = new MockContext(this, {
      parties: options.parties,
      partyFn: options.partyFn
    })
    this.env = options.env || {}
  }

  async connection(server: Server, id?: string, opts?: { query?: Record<string, string>, headers?: Record<string, string> }) {
    const socket = new MockPartyClient(server, id);
    const url = new URL('http://localhost')
    if (opts?.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        url.searchParams.set(key, String(value))
      }
    }
    const request = new Request(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opts?.headers || {})
      }
    })
    await server.onConnect(socket.conn as any, { request } as any);
    this.clients.set(socket.id, socket);
    return socket
  }

  broadcast(data: any) {
    this.clients.forEach((client) => {
      client._trigger('message', data);
    });
  }

  getConnection(id: string) {
    let connection: MockConnection | undefined;
    for (const client of this.clients.values()) {
      if (client.conn.id === id || client.conn.sessionId === id) {
        connection = client.conn;
      }
    }
    return connection;
  }

  getConnections() {
    return Array.from(this.clients.values()).map((client) => client.conn); 
  }

  clear() {
    this.clients.clear();
  }

  deleteConnection(id: string, connection?: MockConnection) {
    if (connection) {
      this.clients.delete(connection.id);
      return;
    }

    for (const [connectionKey, client] of this.clients) {
      if (client.conn.id === id || client.conn.sessionId === id) {
        this.clients.delete(connectionKey);
      }
    }
  }
}

export class MockConnection {
  server: Server;
  id: string;
  sessionId: string;

  constructor(public client: MockPartyClient, sessionId: string) {
    this.server = client.server
    this.id = client.id
    this.sessionId = sessionId
  }

  state: any = {};

  setState(value: any) {
    this.state = value;
  }

  send(data: any) {
    this.client._trigger('message', data)
  }

  close() {
      (this.server.room as any).deleteConnection?.(this.id, this);
      this.server.onClose(this as any)
  }
}

export const ServerIo = MockPartyRoom;
export const ClientIo = MockPartyClient;
