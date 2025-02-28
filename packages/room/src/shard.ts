import type * as Party from "./types/party";

// Interface for WebSocket compatibility with Party.js
interface PartyWebSocket {
  send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => void;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  close: () => void;
}

// Map to track connections by their publicId
const clientConnections = new Map<string, Party.Connection>();

export class Shard {
  ws: PartyWebSocket;
  connectionMap = new Map<string, Party.Connection>(); // Map privateId -> connection
  mainServerStub: any;

  constructor(private room: Party.Party) {}

  async onStart() {
    const roomStub = this.room.context.parties.main.get('game');
    if (!roomStub) {
      console.warn('No game room stub found in main party context');
      return;
    }
    
    this.mainServerStub = roomStub;
    this.ws = await roomStub.socket({
      headers: {
        'x-shard-id': this.room.id
      }
    }) as unknown as PartyWebSocket;
    
    // Handle messages from the main server
    this.ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);

        // If the message is directed to a specific client, forward it
        if (message.targetClientId) {
          const clientConn = this.connectionMap.get(message.targetClientId);
          if (clientConn) {
            // Remove the routing information before forwarding
            delete message.targetClientId;
            clientConn.send(message.data);
          }
        } else {
          // Broadcast to all clients if no specific target
          this.room.broadcast(event.data);
        }
      } catch (error) {
        console.error("Error processing message from main server:", error);
      }
    });
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // Store connection mapping
    this.connectionMap.set(conn.id, conn);
    
    // Notify the main server about the new connection with connection metadata
    this.ws.send(JSON.stringify({
      type: 'shard.clientConnected',
      privateId: conn.id,
      connectionInfo: {
        ip: ctx.request?.headers.get('x-forwarded-for') || 'unknown',
        userAgent: ctx.request?.headers.get('user-agent') || 'unknown',
        // Add any other relevant connection info
      }
    }));
  }

  onMessage(message: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
    try {
      // Parse the message if it's a string
      const parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
      
      // Wrap the original message with sender information
      const wrappedMessage = JSON.stringify({
        type: 'shard.clientMessage',
        privateId: sender.id,
        publicId: (sender.state as any)?.publicId,
        payload: parsedMessage
      });
      
      // Forward to main server
      this.ws.send(wrappedMessage);
    } catch (error) {
      console.error("Error forwarding message to main server:", error);
    }
  }

  onClose(conn: Party.Connection) {
    // Remove connection from the map
    this.connectionMap.delete(conn.id);
    
    // Notify main server about disconnection
    this.ws.send(JSON.stringify({
      type: 'shard.clientDisconnected',
      privateId: conn.id,
      publicId: (conn.state as any)?.publicId
    }));
  }

  /**
   * @method onRequest
   * @async
   * @param {Party.Request} req - The HTTP request to handle
   * @description Forwards HTTP requests to the main server, preserving client context
   * @returns {Promise<Response>} The response from the main server
   */
  async onRequest(req: Party.Request): Promise<Response> {
    if (!this.mainServerStub) {
      return new Response('Shard not connected to main server', { status: 503 });
    }

    try {
      // Extract necessary information from the request
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;
      let body: string | null = null;
      
      if (method !== 'GET' && method !== 'HEAD') {
        body = await req.text();
      }
      
      // Convert original headers to a new Headers object
      const headers = new Headers();
      req.headers.forEach((value, key) => {
        headers.set(key, value);
      });
      
      // Add shard identification
      headers.set('x-shard-id', this.room.id);
      headers.set('x-forwarded-by-shard', 'true');
      
      // Client IP tracking for the main server
      const clientIp = req.headers.get('x-forwarded-for') || 'unknown';
      if (clientIp) {
        headers.set('x-original-client-ip', clientIp);
      }
      
      // Prepare request options
      const requestInit: RequestInit = {
        method,
        headers,
        body
      };

      // Forward the request to the main server
      const response = await this.mainServerStub.fetch(path, requestInit);
      return response;
    } catch (error) {
      console.error('Error forwarding request to main server:', error);
      return new Response('Error forwarding request', { status: 500 });
    }
  }
}

Shard satisfies Party.Worker;