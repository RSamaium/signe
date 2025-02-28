import { signal } from "@signe/reactive";
import { Room, Action, Guard } from "./decorators";
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
  @sync() currentConnections = signal(0);
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
  @sync() rooms = signal<Record<string, RoomConfig>>({});
  @sync() shards = signal<Record<string, ShardInfo>>({});
  @sync() roomShards = signal<Record<string, string[]>>({});
  
  // Only persisted state (not synced to clients)
  @persist() rrCounters = signal<Record<string, number>>({});
  
  // Configuration
  @sync() defaultShardUrlTemplate = signal("{shardId}");
  @sync() defaultMaxConnectionsPerShard = signal(100);
  
  // Non-synced state
  private worldId: string = 'default';
  private conn: Party.Connection | null = null;
  
  constructor() {}
  
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
        const updatedShards = { ...this.shards() };
        delete updatedShards[shard.id];
        this.shards.set(updatedShards);
        
        // Update room-shard relations
        const roomShardsList = [...(this.roomShards()[roomId] || [])];
        const updatedRoomShards = { ...this.roomShards() };
        updatedRoomShards[roomId] = roomShardsList.filter(id => id !== shard.id);
        this.roomShards.set(updatedRoomShards);
        
        hasChanges = true;
      }
    });
    
    // Schedule next cleanup
    setTimeout(() => this.cleanupInactiveShards(), 60000);
  }
  
  // Actions
  @Action("registerRoom", RoomConfigSchema)
  async registerRoom(conn: Party.Connection, roomConfig: z.infer<typeof RoomConfigSchema>) {
    const roomId = roomConfig.name;
    
    // Create or update room config
    const updatedRooms = { ...this.rooms() };
    
    if (!updatedRooms[roomId]) {
      const newRoom = new RoomConfig();
      newRoom.id = roomId;
      newRoom.name.set(roomConfig.name);
      newRoom.balancingStrategy.set(roomConfig.balancingStrategy);
      newRoom.public.set(roomConfig.public);
      newRoom.maxPlayersPerShard.set(roomConfig.maxPlayersPerShard);
      newRoom.minShards.set(roomConfig.minShards);
      newRoom.maxShards.set(roomConfig.maxShards);
      
      updatedRooms[roomId] = newRoom;
      this.rooms.set(updatedRooms);
      
      // Initialize roomShards mapping
      const updatedRoomShards = { ...this.roomShards() };
      updatedRoomShards[roomId] = [];
      this.roomShards.set(updatedRoomShards);
      
      console.log(`Registered new room: ${roomId}`);
      
      // Ensure minimum shards are created
      if (roomConfig.minShards > 0) {
        for (let i = 0; i < roomConfig.minShards; i++) {
          await this.autoCreateShard(roomId);
        }
      }
      
      return { success: true, roomId, created: true };
    } else {
      // Update existing room
      const room = updatedRooms[roomId];
      room.balancingStrategy.set(roomConfig.balancingStrategy);
      room.public.set(roomConfig.public);
      room.maxPlayersPerShard.set(roomConfig.maxPlayersPerShard);
      room.minShards.set(roomConfig.minShards);
      room.maxShards.set(roomConfig.maxShards);
      
      this.rooms.set(updatedRooms);
      console.log(`Updated room: ${roomId}`);
      
      return { success: true, roomId, created: false };
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
    
    // Update room-shard relations
    const updatedRoomShards = { ...this.roomShards() };
    if (!updatedRoomShards[roomId]) {
      updatedRoomShards[roomId] = [];
    }
    
    if (!updatedRoomShards[roomId].includes(shardId)) {
      updatedRoomShards[roomId] = [...updatedRoomShards[roomId], shardId];
    }
    
    this.roomShards.set(updatedRoomShards);
    
    console.log(`Registered shard ${shardId} for room ${roomId}`);
    return {
      success: true,
      shardId,
      roomId,
      url,
      maxConnections
    };
  }
  
  @Action("updateShardStats", UpdateShardStatsSchema)
  async updateShardStats(conn: Party.Connection, data: z.infer<typeof UpdateShardStatsSchema>) {
    const shardId = conn.id;
    const { connections, status } = data;
    
    const updatedShards = { ...this.shards() };
    const shard = updatedShards[shardId];
    
    if (!shard) {
      return { error: `Shard ${shardId} not found` };
    }
    
    shard.currentConnections.set(connections);
    if (status) {
      shard.status.set(status);
    }
    shard.lastHeartbeat.set(Date.now());
    
    this.shards.set(updatedShards);
    
    return {
      success: true,
      shardId,
      connections,
      status: shard.status()
    };
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
    
    // Get current shards for this room
    const roomShardIds = this.roomShards()[roomId] || [];
    const roomShards = roomShardIds
      .map(id => this.shards()[id])
      .filter(Boolean);
    
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
      const updatedShards = { ...this.shards() };
      for (const shard of shardsToRemove) {
        delete updatedShards[shard.id];
      }
      this.shards.set(updatedShards);
      
      // Update room-shard relations
      const updatedRoomShards = { ...this.roomShards() };
      updatedRoomShards[roomId] = shardsToKeep.map(shard => shard.id);
      this.roomShards.set(updatedRoomShards);
      
      return {
        success: true,
        roomId,
        previousShardCount,
        currentShardCount: shardsToKeep.length,
        shards: shardsToKeep.map(shard => ({
          id: shard.id,
          url: shard.url(),
          status: shard.status()
        }))
      };
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
      
      return {
        success: true,
        roomId,
        previousShardCount,
        currentShardCount: roomShards.length + newShards.length,
        shards: [...roomShards, ...newShards].map(shard => ({
          id: shard.id,
          url: shard.url(),
          status: shard.status()
        }))
      };
    }
    
    // No scaling needed
    return {
      success: true,
      roomId,
      previousShardCount,
      currentShardCount: previousShardCount,
      noChange: true,
      shards: roomShards.map(shard => ({
        id: shard.id,
        url: shard.url(),
        status: shard.status()
      }))
    };
  }
  
  @Action("getOptimalShard")
  async getOptimalShard(conn: Party.Connection, { roomId, autoCreate = true }: { roomId: string; autoCreate?: boolean }) {
    // Ensure room exists
    const room = this.rooms()[roomId];
    if (!room) {
      if (autoCreate) {
        // Auto-create room with default settings
        await this.registerRoom(conn, {
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
    const roomShardIds = this.roomShards()[roomId] || [];
    if (roomShardIds.length === 0) {
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
    const activeShards = roomShardIds
      .map(id => this.shards()[id])
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
        
        // Update counter
        const updatedCounters = { ...this.rrCounters() };
        updatedCounters[roomId] = nextCounter;
        this.rrCounters.set(updatedCounters);
        
        selectedShard = activeShards[counter];
        break;
    }
    
    return {
      shardId: selectedShard.id,
      url: selectedShard.url()
    };
  }
  
  @Action("getRoomInfo")
  getRoomInfo(conn: Party.Connection, { roomId }: { roomId: string }) {
    const room = this.rooms()[roomId];
    if (!room) {
      return { error: `Room ${roomId} does not exist` };
    }
    
    const roomShardIds = this.roomShards()[roomId] || [];
    const roomShards = roomShardIds
      .map(id => this.shards()[id])
      .filter(Boolean);
    
    // Calculate metrics
    const totalConnections = roomShards.reduce(
      (sum, shard) => sum + shard.currentConnections(), 0
    );
    
    const totalCapacity = roomShards.reduce(
      (sum, shard) => sum + shard.maxConnections(), 0
    );
    
    const utilizationPercentage = totalCapacity > 0 
      ? (totalConnections / totalCapacity) * 100 
      : 0;
    
    return {
      roomId,
      config: {
        name: room.name(),
        balancingStrategy: room.balancingStrategy(),
        public: room.public(),
        maxPlayersPerShard: room.maxPlayersPerShard(),
        minShards: room.minShards(),
        maxShards: room.maxShards()
      },
      shards: roomShards.map(shard => ({
        id: shard.id,
        url: shard.url(),
        connections: shard.currentConnections(),
        capacity: shard.maxConnections(),
        status: shard.status()
      })),
      metrics: {
        totalConnections,
        totalCapacity,
        utilizationPercentage
      }
    };
  }
  
  @Action("getAllRoomsInfo")
  getAllRoomsInfo() {
    const roomsInfo = Object.keys(this.rooms()).map(roomId => {
      const room = this.rooms()[roomId];
      const roomShardIds = this.roomShards()[roomId] || [];
      const roomShards = roomShardIds
        .map(id => this.shards()[id])
        .filter(Boolean);
      
      // Calculate metrics
      const totalConnections = roomShards.reduce(
        (sum, shard) => sum + shard.currentConnections(), 0
      );
      
      const totalCapacity = roomShards.reduce(
        (sum, shard) => sum + shard.maxConnections(), 0
      );
      
      const utilizationPercentage = totalCapacity > 0 
        ? (totalConnections / totalCapacity) * 100 
        : 0;
      
      return {
        roomId,
        config: {
          name: room.name(),
          balancingStrategy: room.balancingStrategy(),
          public: room.public(),
          maxPlayersPerShard: room.maxPlayersPerShard(),
          minShards: room.minShards(),
          maxShards: room.maxShards()
        },
        shards: roomShards.map(shard => ({
          id: shard.id,
          url: shard.url(),
          connections: shard.currentConnections(),
          capacity: shard.maxConnections(),
          status: shard.status()
        })),
        metrics: {
          totalConnections,
          totalCapacity,
          utilizationPercentage
        }
      };
    });
    
    return { rooms: roomsInfo };
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
    const url = template.replace('{shardId}', shardId).replace('{roomId}', roomId);
    
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
    const updatedShards = { ...this.shards() };
    updatedShards[shardId] = newShard;
    this.shards.set(updatedShards);
    
    // Update room-shard relations
    const updatedRoomShards = { ...this.roomShards() };
    if (!updatedRoomShards[roomId]) {
      updatedRoomShards[roomId] = [];
    }
    updatedRoomShards[roomId] = [...updatedRoomShards[roomId], shardId];
    this.roomShards.set(updatedRoomShards);
    
    console.log(`Auto-created shard ${shardId} for room ${roomId}`);
    return newShard;
  }
}