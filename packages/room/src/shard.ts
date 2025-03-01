import type * as Party from "./types/party";
import { response } from "./utils";

// Interface for WebSocket compatibility with Party.js
interface PartyWebSocket {
  send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => void;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  close: () => void;
}

// Options fournies au shard lors de la création
export interface ShardOptions {
  worldUrl?: string;        // URL du service World pour les mises à jour
  worldId?: string;         // ID du monde dans le service World
  statsInterval?: number;   // Intervalle en ms pour la mise à jour périodique des stats (défaut: 30000)
}

export class Shard {
  ws: PartyWebSocket;
  connectionMap = new Map<string, Party.Connection>(); // Map privateId -> connection
  mainServerStub: any;
  worldUrl: string | null = null;
  worldId: string = 'default';
  lastReportedConnections: number = 0;
  statsInterval: number = 30000; // 30 secondes par défaut
  statsIntervalId: NodeJS.Timeout | null = null;

  constructor(private room: Party.Party) {
    this.initializeShardOptions();
  }

  /**
   * Initialise les options du shard à partir du contexte
   */
  private initializeShardOptions() {
    // Essayer de récupérer les options depuis différents emplacements possibles
    let options: ShardOptions | undefined;

    // Vérifier d'abord le contexte direct de la room
    if ((this.room.context as any).options?.shard) {
      options = (this.room.context as any).options.shard;
    } 
    // Vérifier ensuite les metadata de la room
    else if ((this.room as any).metadata?.shardOptions) {
      options = (this.room as any).metadata.shardOptions;
    }
    // Vérifier enfin les env vars (si disponibles)
    else if (typeof process !== 'undefined' && process.env) {
      const worldUrl = process.env.WORLD_SERVICE_URL;
      const worldId = process.env.WORLD_SERVICE_ID;
      const statsInterval = process.env.SHARD_STATS_INTERVAL ? 
        parseInt(process.env.SHARD_STATS_INTERVAL, 10) : undefined;
      
      if (worldUrl) {
        options = { worldUrl, worldId, statsInterval };
      }
    }

    // Appliquer les options si elles existent
    if (options) {
      this.worldUrl = options.worldUrl || null;
      this.worldId = options.worldId || 'default';
      this.statsInterval = options.statsInterval || 30000;
    }
  }

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

    // Initialiser les statistiques au démarrage
    await this.updateWorldStats();

    // Démarrer la mise à jour périodique des statistiques
    this.startPeriodicStatsUpdates();
  }

  /**
   * Démarre les mises à jour périodiques des statistiques
   */
  private startPeriodicStatsUpdates() {
    if (!this.worldUrl) {
      console.log(`Shard ${this.room.id} - Periodic stats updates disabled (no worldUrl configured)`);
      return;
    }

    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
    }

    console.log(`Shard ${this.room.id} - Starting periodic stats updates every ${this.statsInterval}ms`);
    this.statsIntervalId = setInterval(() => {
      this.updateWorldStats().catch(error => {
        console.error('Error in periodic stats update:', error);
      });
    }, this.statsInterval);
  }

  /**
   * Arrête les mises à jour périodiques des statistiques
   */
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

    // Mettre à jour les statistiques du World service
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

    // Mettre à jour les statistiques du World service
    this.updateWorldStats();
  }

  /**
   * Envoie une mise à jour des statistiques au service World
   * @returns {Promise<boolean>} Succès de la mise à jour
   */
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