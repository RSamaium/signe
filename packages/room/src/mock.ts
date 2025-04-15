import { generateShortUUID } from "../../sync/src/utils";
import { Server } from "./server";
import { Storage } from "./storage";
import { request } from "./testing";

export class MockPartyClient {
    private events: Map<string, Function[]> = new Map();
    id : string
    conn: MockConnection;

    constructor(public server: Server, id?: string) {
      this.id = id || generateShortUUID()
      this.conn = new MockConnection(this)
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
  constructor(public server: Server) {}

  socket() {
    return new MockPartyClient(this.server)
  }

  fetch(url: string, options: any) {
    return request(this.server, url, options)
  }
}

class MockContext {
  parties: {
    main: Map<string, any>
  } = {
    main: new Map()
  }

  constructor(public room: MockPartyRoom, options: any = {}) {
   const parties = options.parties || {}
   for (let lobbyId in parties) {
    this.parties.main.set(lobbyId, new MockLobby(parties[lobbyId](room)))
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
      parties: options.parties || {}
    })
    this.env = options.env || {}
  }

  async connection(server: Server, id?: string) {
    const socket = new MockPartyClient(server, id);
    const url = new URL('http://localhost')
    const request = new Request(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
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
    return this.clients.get(id)
  }

  getConnections() {
    return Array.from(this.clients.values()).map((client) => client.conn); 
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
