import { signal } from "@signe/reactive";
import { Room, Action, Guard, Request } from "./decorators";
import { sync, id, persist } from "@signe/sync";
import { z } from "zod";
import * as Party from "./types/party";

// Types definitions
type BalancingStrategy = 'round-robin' | 'least-connections' | 'random';
type ShardStatus = 'active' | 'maintenance' | 'draining';

// Schema validations
const RoomConfigSchema = z.object({
  name: z.string(),
  balancingStrategy: z.enum(['round-robin', 'least-connections', 'random']),
  public: z.boolean(),
  maxPlayersPerShard: z.number().int().positive(),
  minShards: z.number().int().min(0),
  maxShards: z.number().int().positive().optional(),
});

const RegisterShardSchema = z.object({
  shardId: z.string(),
  roomId: z.string(),
  url: z.string().url(),
  maxConnections: z.number().int().positive(),
});

const UpdateShardStatsSchema = z.object({
  connections: z.number().int().min(0),
  status: z.enum(['active', 'maintenance', 'draining']).optional(),
});

const ScaleRoomSchema = z.object({
  targetShardCount: z.number().int().positive(),
  shardTemplate: z.object({
    urlTemplate: z.string(),
    maxConnections: z.number().int().positive(),
  }).optional(),
});

// Model classes
class RoomConfig {
  @id() id: string;
  @sync() name = signal("");
  @sync() balancingStrategy = signal<BalancingStrategy>("round-robin");
  @sync() public = signal(true);
  @sync() maxPlayersPerShard = signal(100);
  @sync() minShards = signal(1);
  @sync() maxShards = signal<number | undefined>(undefined);
}

class ShardInfo {
  @id() id: string;
  @sync() roomId = signal("");
  @sync() url = signal("");
  @sync({
    persist: false
  }) currentConnections = signal(0);
  @sync() maxConnections = signal(100);
  @sync() status = signal<ShardStatus>("active");
  @sync() lastHeartbeat = signal(0);
}

// World room implementation
@Room({
  path: "world-{worldId}",
  maxUsers: 100, // Limit for admin connections
  throttleStorage: 2000, // Throttle storage updates (ms)
  throttleSync: 500, // Throttle sync updates (ms)
})
export class WorldRoom {
  // Synchronized state
  @sync(RoomConfig) rooms = signal<Record<string, RoomConfig>>({});
  @sync(ShardInfo) shards = signal<Record<string, ShardInfo>>({});
  
  // Only persisted state (not synced to clients)
  @persist() rrCounters = signal<Record<string, number>>({});
  
  // Configuration
  defaultShardUrlTemplate = signal("{shardId}");
  defaultMaxConnectionsPerShard = signal(100);
  
  // Non-synced state
  private worldId: string = 'default';
  private conn: Party.Connection | null = null;
  
  // Lifecycle hooks
  async onCreate(id: string) {
    console.log(`World service started: ${id}`);
    this.worldId = id;
    
    // Set up periodic cleanup for inactive shards
    setTimeout(() => this.cleanupInactiveShards(), 60000);
  }
  
  async onJoin(conn: Party.Connection, ctx: Party.ConnectionContext) {
    this.conn = conn;
    console.log(`Admin connected to World ${this.worldId}`);
  }
  
  async onLeave(conn: Party.Connection) {
    this.conn = null;
    console.log(`Admin disconnected from World ${this.worldId}`);
  }
  
  // Helper methods
  private cleanupInactiveShards() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes timeout
    const shardsValue = this.shards();
    
    let hasChanges = false;
    Object.values(shardsValue).forEach(shard => {
      if (now - shard.lastHeartbeat() > timeout) {
        console.log(`Removing inactive shard: ${shard.id}`);
        const roomId = shard.roomId();
        
        // Update shards list
        delete this.shards()[shard.id];
        
        hasChanges = true;
      }
    });
    
    // Schedule next cleanup
    setTimeout(() => this.cleanupInactiveShards(), 60000);
  }
  
  // Actions
  @Request({
    path: 'register-room',
    method: 'POST',
  })
  async registerRoom(req: Party.Request) {
    const roomConfig: z.infer<typeof RoomConfigSchema> = await req.json();
    const roomId = roomConfig.name;
    
    if (!this.rooms()[roomId]) {
      const newRoom = new RoomConfig();
      newRoom.id = roomId;
      newRoom.name.set(roomConfig.name);
      newRoom.balancingStrategy.set(roomConfig.balancingStrategy);
      newRoom.public.set(roomConfig.public);
      newRoom.maxPlayersPerShard.set(roomConfig.maxPlayersPerShard);
      newRoom.minShards.set(roomConfig.minShards);
      newRoom.maxShards.set(roomConfig.maxShards);
      
      this.rooms()[roomId] = newRoom;
      
      console.log(`Registered new room: ${roomId}`);
      
      // Ensure minimum shards are created
      if (roomConfig.minShards > 0) {
        for (let i = 0; i < roomConfig.minShards; i++) {
          await this.autoCreateShard(roomId);
        }
      }
    } else {
      // Update existing room
      const room = this.rooms()[roomId];
      room.balancingStrategy.set(roomConfig.balancingStrategy);
      room.public.set(roomConfig.public);
      room.maxPlayersPerShard.set(roomConfig.maxPlayersPerShard);
      room.minShards.set(roomConfig.minShards);
      room.maxShards.set(roomConfig.maxShards);
      console.log(`Updated room: ${roomId}`);
    }
  }
  
  @Action("registerShard", RegisterShardSchema)
  async registerShard(conn: Party.Connection, data: z.infer<typeof RegisterShardSchema>) {
    const { shardId, roomId, url, maxConnections } = data;
    
    // Ensure room exists
    if (!this.rooms()[roomId]) {
      return { error: `Room ${roomId} does not exist` };
    }
    
    // Create or update shard
    const updatedShards = { ...this.shards() };
    
    const newShard = new ShardInfo();
    newShard.id = shardId;
    newShard.roomId.set(roomId);
    newShard.url.set(url);
    newShard.maxConnections.set(maxConnections);
    newShard.currentConnections.set(0);
    newShard.status.set("active");
    newShard.lastHeartbeat.set(Date.now());
    
    updatedShards[shardId] = newShard;
    this.shards.set(updatedShards);
    
    console.log(`Registered shard ${shardId} for room ${roomId}`);
  }
  
  @Request({
    path: 'update-shard',
    method: 'POST',
  })
  async updateShardStats(req: Party.Request) {
    const body: { shardId: string; connections: number; status: ShardStatus } = await req.json();
    const { shardId, connections, status } = body;
    const shard = this.shards()[shardId];

    if (!shard) {
      return { error: `Shard ${shardId} not found` };
    }
    
    shard.currentConnections.set(connections);
    if (status) {
      shard.status.set(status);
    }
    shard.lastHeartbeat.set(Date.now());
  }
  
  @Action("scaleRoom", ScaleRoomSchema)
  async scaleRoom(conn: Party.Connection, data: z.infer<typeof ScaleRoomSchema>) {
    const { targetShardCount, shardTemplate } = data;
    const roomId = conn.id; // Assuming the shard's connection ID is its roomId
    
    // Validate room exists
    const room = this.rooms()[roomId];
    if (!room) {
      return { error: `Room ${roomId} does not exist` };
    }
    
    const roomShards = Object.values(this.shards())
      .filter(shard => shard.roomId() === roomId);
    
    const previousShardCount = roomShards.length;
    
    // Check max shards constraint
    if (room.maxShards() !== undefined && targetShardCount > room.maxShards()!) {
      return {
        error: `Cannot scale beyond maximum allowed shards (${room.maxShards()})`,
        roomId,
        currentShardCount: previousShardCount
      };
    }
    
    // Handle scaling down
    if (targetShardCount < previousShardCount) {
      // Find candidates for removal (prioritize draining or low-connection shards)
      const shardsToRemove = [...roomShards]
        .sort((a, b) => {
          // Prioritize draining status
          if (a.status() === 'draining' && b.status() !== 'draining') return -1;
          if (a.status() !== 'draining' && b.status() === 'draining') return 1;
          
          // Then by connection count (ascending)
          return a.currentConnections() - b.currentConnections();
        })
        .slice(0, previousShardCount - targetShardCount);
      
      // Remove the selected shards
      const shardsToKeep = roomShards.filter(
        shard => !shardsToRemove.some(s => s.id === shard.id)
      );
      
      // Update shards
      for (const shard of shardsToRemove) {
        delete this.shards()[shard.id];
      }
      
      return;
    }
    
    // Handle scaling up
    if (targetShardCount > previousShardCount) {
      const newShards = [];
      
      // Create new shards
      for (let i = 0; i < targetShardCount - previousShardCount; i++) {
        const newShard = await this.autoCreateShard(
          roomId,
          shardTemplate?.urlTemplate,
          shardTemplate?.maxConnections
        );
        
        if (newShard) {
          newShards.push(newShard);
        }
      }
    }
  }

  @Request({
    path: 'connect',
    method: 'POST',
  })
  async connect(req: Party.Request) {
    try {
      // Extract request data
      let data: { roomId: string; autoCreate?: boolean };
      
      try {
        // Handle potential empty body or malformed JSON
        const body = await req.text();
        if (!body || body.trim() === '') {
          return new Response(JSON.stringify({ 
            error: "Request body is empty" 
          }), { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        data = JSON.parse(body);
      } catch (parseError) {
        console.error('JSON parsing error:', parseError);
        return new Response(JSON.stringify({ 
          error: "Invalid JSON in request body" 
        }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Verify roomId is provided
      if (!data.roomId) {
        return new Response(JSON.stringify({ 
          error: "roomId parameter is required" 
        }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Determine if auto-creation is enabled (default to true)
      const autoCreate = data.autoCreate !== undefined ? data.autoCreate : true;
      
      // Find optimal shard
      const result = await this.findOptimalShard(data.roomId, autoCreate);
 
      // Check for errors
      if ('error' in result) {
        return new Response(JSON.stringify({ 
          error: result.error 
        }), { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Log the connection
      console.log(`Room ${data.roomId}: Client directed to shard ${result.shardId}`);
      
      // Return shard information to the client
      return new Response(JSON.stringify({
        success: true,
        shardId: result.shardId,
        url: result.url
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error connecting to shard:', error);
      return new Response(JSON.stringify({ 
        error: "Internal server error" 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // Méthode privée pour trouver un shard optimal sans connexion
  private async findOptimalShard(
    roomId: string, 
    autoCreate: boolean = true
  ): Promise<{ shardId: string; url: string } | { error: string }> {
    // Ensure room exists
    const room = this.rooms()[roomId];
    if (!room) {
      if (autoCreate) {
        // Auto-create room with default settings
        await this.registerRoom({ id: 'system', state: {} } as any, {
          name: roomId,
          balancingStrategy: 'round-robin',
          public: true,
          maxPlayersPerShard: this.defaultMaxConnectionsPerShard(),
          minShards: 1,
          maxShards: undefined
        });
      } else {
        return { error: `Room ${roomId} does not exist` };
      }
    }
    
    // Get shards for this room
    const roomShards = Object.values(this.shards())
      .filter(shard => shard.roomId() === roomId);
    
    if (roomShards.length === 0) {
      if (autoCreate) {
        // Auto-create a shard
        const newShard = await this.autoCreateShard(roomId);
        if (newShard) {
          return {
            shardId: newShard.id,
            url: newShard.url()
          };
        } else {
          return { error: `Failed to create shard for room ${roomId}` };
        }
      } else {
        return { error: `No shards available for room ${roomId}` };
      }
    }
    
    // Get active shards
    const activeShards = roomShards
      .filter(shard => shard && shard.status() === 'active');
    
    if (activeShards.length === 0) {
      return { error: `No active shards available for room ${roomId}` };
    }
    
    // Apply balancing strategy
    const balancingStrategy = room.balancingStrategy();
    let selectedShard: ShardInfo;
    
    switch (balancingStrategy) {
      case 'least-connections':
        // Choose shard with fewest connections
        selectedShard = activeShards.reduce(
          (min, shard) => 
            shard.currentConnections() < min.currentConnections() ? shard : min,
          activeShards[0]
        );
        break;
        
      case 'random':
        // Choose random shard
        selectedShard = activeShards[Math.floor(Math.random() * activeShards.length)];
        break;
        
      case 'round-robin':
      default:
        // Round-robin selection
        const counter = this.rrCounters()[roomId] || 0;
        const nextCounter = (counter + 1) % activeShards.length;
        this.rrCounters()[roomId] = nextCounter;
        
        selectedShard = activeShards[counter];
        break;
    }
    
    return {
      shardId: selectedShard.id,
      url: selectedShard.url()
    };
  }
  
  // Private methods
  private async autoCreateShard(
    roomId: string,
    urlTemplate?: string,
    maxConnections?: number
  ): Promise<ShardInfo | null> {
    const room = this.rooms()[roomId];
    if (!room) {
      console.error(`Cannot create shard for non-existent room: ${roomId}`);
      return null;
    }
    
    // Generate shard ID
    const shardId = `${roomId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    
    // Generate URL from template
    const template = urlTemplate || this.defaultShardUrlTemplate();
    const url = template.replace('{shardId}', shardId).replace('{roomId}', shardId);
    
    // Set max connections
    const max = maxConnections || room.maxPlayersPerShard();
    
    // Create the shard
    const newShard = new ShardInfo();
    newShard.id = shardId;
    newShard.roomId.set(roomId);
    newShard.url.set(url);
    newShard.maxConnections.set(max);
    newShard.currentConnections.set(0);
    newShard.status.set("active");
    newShard.lastHeartbeat.set(Date.now());
    
    // Update shards collection
    this.shards()[shardId] = newShard;
    
    console.log(`Auto-created shard ${shardId} for room ${roomId}`);
    return newShard;
  }
}