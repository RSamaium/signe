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
  connectionMap = new Map<string, Set<Party.Connection>>(); // Map privateId -> active connections
  mainServerStub: any;
  worldUrl: string | null = null;
  worldId: string;
  lastReportedConnections: number = 0;
  statsInterval: number = 30000; 
  statsIntervalId: any = null;

  constructor(private room: Party.Room, options: ShardOptions = {}) {
    this.worldUrl = options.worldUrl ?? null;
    this.worldId = options.worldId
      ?? this.getWorldIdFromShardId(room.id)
      ?? this.getEnvString('WORLD_ID')
      ?? this.getEnvString('SIGNE_WORLD_ID')
      ?? 'world-default';
    this.statsInterval = options.statsInterval ?? this.statsInterval;
  }

  private getPrivateId(conn: Party.Connection) {
    return conn.sessionId || conn.id;
  }

  private getEnvString(key: string) {
    const value = this.room.env?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private getRoomIdFromShardId(shardId: string) {
    return shardId.split(':')[0];
  }

  private getWorldIdFromShardId(shardId: string) {
    const parts = shardId.split(':');
    return parts.length >= 3 ? parts[1] : undefined;
  }

  async onStart() {
    const roomId = this.getRoomIdFromShardId(this.room.id);
    const roomStub = this.room.context.parties.main.get(roomId);
    if (!roomStub) {
      console.warn('No room room stub found in main party context');
      return;
    }
    
    this.mainServerStub = roomStub;
    this.ws = await roomStub.socket({
      headers: {
        'x-shard-id': this.room.id,
        'x-shard-world-id': this.worldId,
        'x-access-shard': this.room.env.SHARD_SECRET as string
      }
    }) as unknown as PartyWebSocket;
    
    // Handle messages from the main server
    this.ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'shard.closeClient' && message.privateId) {
          const clientConnections = this.connectionMap.get(message.privateId);
          if (clientConnections?.size) {
            for (const clientConn of [...clientConnections]) {
              clientConn.close();
            }
          }
          return;
        }

        // If the message is directed to a specific client, forward it
        if (message.targetClientId) {
          const clientConnections = this.connectionMap.get(message.targetClientId);
          if (clientConnections?.size) {
            // Remove the routing information before forwarding
            delete message.targetClientId;
            for (const clientConn of clientConnections) {
              clientConn.send(message.data);
            }
          }
        } else {
          // Broadcast to all clients if no specific target
          this.room.broadcast(event.data);
        }
      } catch (error) {
        console.error("Error processing message from main server:", error);
      }
    });

    await this.updateWorldStats(true);
    this.startPeriodicStatsUpdates();
  }

  private startPeriodicStatsUpdates() {
    if (this.statsInterval <= 0 || !this.room.context.parties.world) {
      return;
    }

    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
    }

    this.statsIntervalId = setInterval(() => {
      this.updateWorldStats(true).catch(error => {
        console.error('Error in periodic stats update:', error);
      });
    }, this.statsInterval);
    this.statsIntervalId?.unref?.();
  }

  private stopPeriodicStatsUpdates() {
    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const privateId = this.getPrivateId(conn);

    // Store connection mapping
    const connections = this.connectionMap.get(privateId) ?? new Set<Party.Connection>();
    connections.add(conn);
    this.connectionMap.set(privateId, connections);
    
    // Capture all headers and request information
    const headers: Record<string, string> = {};
    if (ctx.request?.headers) {
      ctx.request.headers.forEach((value, key) => {
        headers[key] = value;
      });
    }

    // Prepare connection context information
    const requestInfo = ctx.request ? {
      headers,
      url: ctx.request.url,
      method: ctx.request.method
    } : null;

    // Notify the main server about the new connection with complete connection metadata
    this.ws.send(JSON.stringify({
      type: 'shard.clientConnected',
      privateId,
      requestInfo
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
        privateId: this.getPrivateId(sender),
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
    const privateId = this.getPrivateId(conn);

    // Remove connection from the map
    const connections = this.connectionMap.get(privateId);
    connections?.delete(conn);

    if (connections?.size) {
      this.updateWorldStats();
      return;
    }

    this.connectionMap.delete(privateId);
    
    // Notify main server about disconnection
    this.ws.send(JSON.stringify({
      type: 'shard.clientDisconnected',
      privateId,
      publicId: (conn.state as any)?.publicId
    }));

    this.updateWorldStats();
  }

  async updateWorldStats(force = false): Promise<boolean> {
    const currentConnections = Array.from(this.connectionMap.values())
      .reduce((total, connections) => total + connections.size, 0);
    
    if (!force && currentConnections === this.lastReportedConnections) {
      return true;
    }

    try {
      const worldParty = this.room.context.parties.world;
      if (!worldParty) {
        return false;
      }

      const worldRoom = worldParty.get(this.worldId);
      if (!worldRoom?.fetch) {
        return false;
      }

      const response = await worldRoom.fetch('/update-shard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-shard': this.room.env.SHARD_SECRET as string
        },
        body: JSON.stringify({
          shardId: this.room.id,
          worldId: this.worldId,
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
      headers.set('x-shard-world-id', this.worldId);
      headers.set('x-forwarded-by-shard', 'true');
      headers.set('x-access-shard', this.room.env.SHARD_SECRET as string);
      
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
      const response = await this.mainServerStub.fetch(path + url.search, requestInit);
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
    await this.updateWorldStats(true);
  }
}

Shard satisfies Party.Worker;
