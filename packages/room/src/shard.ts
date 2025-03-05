import type * as Party from "./types/party";
import { response } from "./utils";

interface PartyWebSocket {
  send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => void;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  close: () => void;
}

export interface ShardOptions {
  worldUrl?: string;
  worldId?: string;
  statsInterval?: number;
}

export class Shard {
  ws: PartyWebSocket;
  connectionMap = new Map<string, Party.Connection>(); // Map privateId -> connection
  mainServerStub: any;
  worldUrl: string | null = null;
  worldId: string = 'default';
  lastReportedConnections: number = 0;
  statsInterval: number = 30000; 
  statsIntervalId: any = null;

  constructor(private room: Party.Room) {}

  async onStart() {
    const roomId = this.room.id.split(':')[0];
    const roomStub = this.room.context.parties.main.get(roomId);
    if (!roomStub) {
      console.warn('No room room stub found in main party context');
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

    await this.updateWorldStats();
    this.startPeriodicStatsUpdates();
  }

  private startPeriodicStatsUpdates() {
    if (!this.worldUrl) {
      return;
    }

    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
    }

    this.statsIntervalId = setInterval(() => {
      this.updateWorldStats().catch(error => {
        console.error('Error in periodic stats update:', error);
      });
    }, this.statsInterval);
  }

  private stopPeriodicStatsUpdates() {
    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
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

    this.updateWorldStats();
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

    this.updateWorldStats();
  }

  async updateWorldStats(): Promise<boolean> {
    const currentConnections = this.connectionMap.size;
    
    if (currentConnections === this.lastReportedConnections) {
      return true;
    }

    try {
      const worldRoom = this.room.context.parties.world.get('world-default');
      const response = await worldRoom.fetch('/update-shard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-shard': this.room.env.SHARD_SECRET as string
        },
        body: JSON.stringify({
          shardId: this.room.id,
          connections: currentConnections
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error(`Failed to update World stats: ${response.status} - ${errorData.error || 'Unknown error'}`);
        return false;
      }

      // Mettre à jour le dernier nombre rapporté
      this.lastReportedConnections = currentConnections;
      return true;
    } catch (error) {
      console.error('Error updating World stats:', error);
      return false;
    }
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
      return response(503, { error: 'Shard not connected to main server' });
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
      return response(500, { error: 'Error forwarding request' });
    }
  }
  
  /**
   * @method onAlarm
   * @async
   * @description Executed periodically, used to perform maintenance tasks
   */
  async onAlarm() {
    await this.updateWorldStats();
  }
}

Shard satisfies Party.Worker;