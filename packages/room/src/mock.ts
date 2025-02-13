import { generateShortUUID } from "../../sync/src/utils";
import { Storage } from "./storage";

export class MockPartySocket {
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

class MockPartyRoom {
  private clients: Map<string, MockPartySocket> = new Map();
  storage = new Storage();

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

  getConnections() {
    return this.clients;
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
