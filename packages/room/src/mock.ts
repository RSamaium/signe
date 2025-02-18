import { generateShortUUID } from "../../sync/src/utils";
import { Server } from "./server";
import { Storage } from "./storage";

export class MockPartyClient {
    private events: Map<string, Function> = new Map();
    id = generateShortUUID()
    conn: MockConnection;

    constructor(public server: Server) {
      this.conn = new MockConnection(this)
    }
    
    addEventListener(event, cb) {
        this.events.set(event, cb);
    }

    removeEventListener(event, cb) {
        this.events.delete(event);
    }

    _trigger(event, data) {
        this.events.get(event)?.(data);
    }

    send(data) {
        return this.server.onMessage(JSON.stringify(data), this.conn as any)
    }
}

class MockPartyRoom {
  clients: Map<string, MockPartyClient> = new Map();
  storage = new Storage();
  env = {}

  constructor(public id?: string) {
    this.id = id || generateShortUUID()
  }

  async connection(server: Server) {
    const socket = new MockPartyClient(server);
    await server.onConnect(socket.conn as any, { request: {} } as any);
    this.clients.set(socket.id, socket);
    return socket
  }

  broadcast(data: any) {
    this.clients.forEach((client) => {
      client._trigger('message', data);
    });
  }

  getConnection(id: string) {
    return this.clients.get(id)
  }

  getConnections() {
    return this.clients; 
  }

  clear() {
    this.clients.clear();
  }
}

export class MockConnection {
  server: Server;
  id: string;

  constructor(public client: MockPartyClient) {
    this.server = client.server
    this.id = client.id
  }

  state: any = {};

  setState(value: any) {
    this.state = value;
  }

  send(data: any) {
    this.client._trigger('message', data)
  }

  close() {
      this.server.onClose(this as any)
  }
}

export const ServerIo = MockPartyRoom;
export const ClientIo = MockPartyClient;
