import { generateShortUUID } from "../../sync/src/utils";

class MockPartySocket {
    private events: Map<string, Function> = new Map();
    id = generateShortUUID()
    
    addEventListener(event, cb) {
        this.events.set(event, cb);
    }

    removeEventListener(event, cb) {
        this.events.delete(event);
    }

    _trigger(event, data) {
        this.events.get(event)?.(data);
    }
}

class MockStorage {
    private storage: Map<string, any> = new Map();
    
    async get(key: string) {
        return this.storage.get(key);
    }
    
    async put(key: string, value: any) {
        this.storage.set(key, value);
    }
    
    async list() {
        return this.storage
    }
}

class MockPartyRoom {
  private clients: Map<string, MockPartySocket> = new Map();
  storage = new MockStorage();

  constructor(public id?: string) {
    this.id = id || generateShortUUID()
  }

  connection(client) {
    const socket = new MockPartySocket();
    this.clients.set(socket.id, client);
    client.id = socket.id;
  }

  broadcast(data: any) {
    this.clients.forEach((client) => {
      client._trigger('message', data);
    });
  }

  clear() {
    this.clients.clear();
  }
}

export class MockConnection {
  state: any = {};

  setState(value: any) {
    this.state = value;
  }
}

export const ServerIo = MockPartyRoom;
export const ClientIo = MockPartySocket;
