import type * as Party from "./types/party";

export class Shard {
  ws: WebSocket;

  constructor(private room: Party.Party) {}

  async onStart() {
       const roomStub = this.room.context.parties.main.get('game');
       this.ws = await roomStub.socket({
          headers: {
            'x-shard-id': this.room.id
          }
       });
       this.ws.addEventListener("message", (event) => {
        //console.log(event.data)
        });
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
   // console.log(conn)
    this.ws.send('shard.clientConnected')
  }

  onMessage(message: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
    console.log(message)
  }

  // static onBeforeConnect(req: Party.Request, lobby: Party.Lobby) {
  //   // Catch all connection attempts to /parties/router/:namespace and redirect them to a random room
  //   const namespace = lobby.id;
  //   return lobby.parties.main
  //     .get('game')
  //     .fetch(req as unknown as RequestInit);
  // }
  
  // Helper method to connect to a specific main shard
  private async connectToMain(namespace: string, roomId: number) {
    // try {
    //   const roomStub = this.party.context.parties.main.get(
    //     getRoomId(namespace, roomId)
    //   );
      
    //   const ws = await roomStub.socket();
    //   const roomIdStr = getRoomId(namespace, roomId);
      
    //   // Store the connection
    //   mainConnections.set(roomIdStr, ws as unknown as Party.Connection);
      
    //   // Set up event handlers (same as in setupMainConnections)
    //   ws.addEventListener("message", (event) => {
    //     this.forwardMessageToClients(event.data);
    //   });
      
    //   ws.addEventListener("close", () => {
    //     mainConnections.delete(roomIdStr);
    //     setTimeout(() => {
    //       if (!mainConnections.has(roomIdStr)) {
    //         this.connectToMain(namespace, roomId).catch(console.error);
    //       }
    //     }, 5000);
    //   });
      
    //   console.log(`Reconnected to main shard: ${roomIdStr}`);
    // } catch (error) {
    //   console.error(`Failed to reconnect to main shard ${getRoomId(namespace, roomId)}:`, error);
    // }
  }
  

  // static onBeforeConnect(req: Party.Request, lobby: Party.Lobby) {
  //   console.log(lobby.id)
  //   const namespace = lobby.id;
  //   return lobby.parties.main
  //     .get(getNextRoom(namespace))
  //     .fetch(req as unknown as RequestInit);
  // }

  // static async onBeforeRequest(req: Party.Request, lobby: Party.Lobby) {
  //   // Catch all HTTP requests to /parties/router/:namespace and fan-out to all rooms
  //   const namespace = lobby.id;
  //   const body = await req.text();
  //   const url = new URL(req.url);
  //   const path = url.pathname + url.search;

  //   // Convert headers to a compatible format
  //   const headersObject: HeadersInit = {};
  //   req.headers.forEach((value, key) => {
  //     headersObject[key] = value;
  //   });

  //   // TODO: Implement retry logic for robustness
  //   await Promise.all(rooms.map((roomId) => {
  //     const init: RequestInit = {
  //       method: req.method,
  //       headers: headersObject,
  //       body,
  //     };
  //     return lobby.parties.main.get(getRoomId(namespace, roomId)).fetch(path, init);
  //   }));
    
  //   return new Response("Proxied request to all rooms");
  // }
}

Shard satisfies Party.Worker;