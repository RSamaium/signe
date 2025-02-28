import type * as Party from "./types/party";

/**
 * Room configuration interface
 */
interface RoomConfig {
  name: string;
  balancingStrategy: 'round-robin' | 'least-connections' | 'random';
  public: boolean;
  maxPlayersPerShard: number;
  minShards: number;
  maxShards?: number; // Limite maximale de shards pour cette salle
}

/**
 * Shard information interface
 */
interface ShardInfo {
  id: string;
  roomId: string;
  url: string;
  currentConnections: number;
  maxConnections: number;
  status: 'active' | 'maintenance' | 'draining';
  lastHeartbeat: number;
}

/**
 * Room-Shard relation tracking
 */
interface RoomShardRelation {
  roomId: string;
  shardIds: string[];
  config: RoomConfig;
  currentActiveShards: number;
}

/**
 * Load balancing results
 */
interface ConnectResult {
  url: string;
  shardId: string;
}

/**
 * Scale operation result
 */
interface ScaleResult {
  success: boolean;
  roomId: string;
  previousShardCount: number;
  currentShardCount: number;
  shards: {
    id: string;
    url: string;
    status: string;
  }[];
  error?: string;
}

/**
 * Room info result
 */
interface RoomInfoResult {
  roomId: string;
  config: RoomConfig;
  shards: {
    id: string;
    url: string;
    connections: number;
    capacity: number;
    status: string;
  }[];
  metrics: {
    totalConnections: number;
    totalCapacity: number;
    utilizationPercentage: number;
  };
}

// Interface for request body when registering a room
interface RegisterRoomBody {
  roomId: string;
  config: RoomConfig;
}

// Interface for request body when registering a shard
interface RegisterShardBody {
  shardId: string;
  roomId: string;
  url: string;
  maxConnections: number;
}

// Interface for request body when updating shard stats
interface UpdateShardStatsBody {
  shardId: string;
  connections: number;
  status?: 'active' | 'maintenance' | 'draining';
}

// Interface for scaling a room's shards
interface ScaleRoomBody {
  roomId: string;
  targetShardCount: number;
  shardTemplate?: {
    urlTemplate: string;
    maxConnections: number;
  };
}

/**
 * Storage keys used for persistent storage
 */
const STORAGE_KEYS = {
  ROOMS: 'rooms',
  SHARDS: 'shards',
  ROOM_SHARDS: 'roomShards',
  RR_COUNTERS: 'rrCounters'
};

/**
 * @class World
 * @description Central registry and load balancer for rooms and shards
 */
export class World {
  // In-memory storage (backed by persistent storage)
  private rooms: Map<string, RoomConfig> = new Map();
  private shards: Map<string, ShardInfo> = new Map();
  private roomShards: Map<string, string[]> = new Map();
  
  // Round-robin counters for each room
  private rrCounters: Map<string, number> = new Map();
  
  // Default shard URL template and configuration
  private defaultShardUrlTemplate: string = '{shardId}';
  private defaultMaxConnectionsPerShard: number = 100;
  
  constructor(private room: Party.Party) {}
  
  /**
   * Load data from storage at startup
   */
  async onStart() {
    console.log('World service started');
    await this.loadFromStorage();
  }
  
  /**
   * Load data from storage
   */
  private async loadFromStorage() {
    try { 
      // Load rooms
      const roomsData = await this.room.storage.get(STORAGE_KEYS.ROOMS);
      if (roomsData) {
        this.rooms = new Map(Object.entries(roomsData));
        console.log(`Loaded ${this.rooms.size} rooms from storage`);
      }
      
      // Load shards
      const shardsData = await this.room.storage.get(STORAGE_KEYS.SHARDS);
      if (shardsData) {
        this.shards = new Map(Object.entries(shardsData));
        console.log(`Loaded ${this.shards.size} shards from storage`);
      }
      
      // Load room-shard relations
      const roomShardsData = await this.room.storage.get(STORAGE_KEYS.ROOM_SHARDS);
      if (roomShardsData) {
        this.roomShards = new Map(Object.entries(roomShardsData));
      }
      
      // Load round-robin counters
      const rrCountersData = await this.room.storage.get(STORAGE_KEYS.RR_COUNTERS);
      if (rrCountersData) {
        this.rrCounters = new Map(Object.entries(rrCountersData).map(([key, value]) => [key, Number(value)]));
      }
      
      // Check for inactive shards
      this.cleanupInactiveShards();
    } catch (error) {
      console.error('Error loading data from storage:', error);
    }
  }
  
  /**
   * Save data to storage
   */
  private async saveToStorage() {
    try {
      // Save rooms
      const roomsObject = Object.fromEntries(this.rooms);
      await this.room.storage.put(STORAGE_KEYS.ROOMS, roomsObject);
      
      // Save shards
      const shardsObject = Object.fromEntries(this.shards);
      await this.room.storage.put(STORAGE_KEYS.SHARDS, shardsObject);
      
      // Save room-shard relations
      const roomShardsObject = Object.fromEntries(this.roomShards);
      await this.room.storage.put(STORAGE_KEYS.ROOM_SHARDS, roomShardsObject);
      
      // Save round-robin counters
      const rrCountersObject = Object.fromEntries(this.rrCounters);
      await this.room.storage.put(STORAGE_KEYS.RR_COUNTERS, rrCountersObject);
    } catch (error) {
      console.error('Error saving data to storage:', error);
    }
  }
  
  /**
   * Clean up inactive shards
   */
  private cleanupInactiveShards() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes
    
    for (const [shardId, shard] of this.shards.entries()) {
      // Mark shards as inactive if they haven't sent a heartbeat in 5 minutes
      if (now - shard.lastHeartbeat > timeout && shard.status === 'active') {
        shard.status = 'draining';
        console.log(`Shard ${shardId} has not sent a heartbeat for more than 5 minutes. Marking as inactive.`);
      }
    }
  }
  
  /**
   * Register a new room
   * @param roomId Unique identifier for the room
   * @param config Room configuration
   */
  async registerRoom(roomId: string, config: RoomConfig) {
    this.rooms.set(roomId, config);
    this.roomShards.set(roomId, []);
    this.rrCounters.set(roomId, 0);
    
    console.log(`Room registered: ${roomId}`);
    
    // Persist changes
    await this.saveToStorage();
    
    return { success: true, roomId };
  }
  
  /**
   * Register a new shard for a room
   * @param shardId Unique identifier for the shard
   * @param roomId Room this shard belongs to
   * @param url WebSocket URL for connecting to this shard
   * @param maxConnections Maximum connections this shard can handle
   */
  async registerShard(shardId: string, roomId: string, url: string, maxConnections: number) {
    // Verify the room exists
    if (!this.rooms.has(roomId)) {
      return { success: false, error: 'Room not found' };
    }
    
    // Create shard info
    const shardInfo: ShardInfo = {
      id: shardId,
      roomId,
      url,
      currentConnections: 0,
      maxConnections,
      status: 'active',
      lastHeartbeat: Date.now()
    };
    
    // Store shard and update room-shard relation
    this.shards.set(shardId, shardInfo);
    
    const shardIds = this.roomShards.get(roomId) || [];
    shardIds.push(shardId);
    this.roomShards.set(roomId, shardIds);
    
    console.log(`Shard registered: ${shardId} for room ${roomId}`);
    
    // Persist changes
    await this.saveToStorage();
    
    return { success: true, shardId };
  }
  
  /**
   * Scale the number of shards for a room
   * @param roomId Room identifier
   * @param targetShardCount Desired number of shards
   * @param shardTemplate Template data for creating new shards
   */
  async scaleShardsForRoom(
    roomId: string, 
    targetShardCount: number,
    shardTemplate?: { urlTemplate: string; maxConnections: number }
  ): Promise<ScaleResult> {
    // Verify the room exists
    if (!this.rooms.has(roomId)) {
      return { 
        success: false, 
        roomId, 
        previousShardCount: 0, 
        currentShardCount: 0,
        shards: [],
        error: 'Room not found' 
      };
    }
    
    const config = this.rooms.get(roomId)!;
    const currentShardIds = this.roomShards.get(roomId) || [];
    const previousCount = currentShardIds.length;
    
    // Validate against min/max constraints
    if (targetShardCount < config.minShards) {
      targetShardCount = config.minShards;
    }
    
    if (config.maxShards && targetShardCount > config.maxShards) {
      targetShardCount = config.maxShards;
    }
    
    // No change needed
    if (targetShardCount === previousCount) {
      const shardList = currentShardIds.map(id => {
        const shard = this.shards.get(id)!;
        return {
          id: shard.id,
          url: shard.url,
          status: shard.status
        };
      });
      
      return {
        success: true,
        roomId,
        previousShardCount: previousCount,
        currentShardCount: previousCount,
        shards: shardList
      };
    }
    
    // Scale down: mark excess shards as draining
    if (targetShardCount < previousCount) {
      // Mark shards for draining starting from the end
      const shardsToRemove = previousCount - targetShardCount;
      const shardsToRemoveIds = currentShardIds.slice(-shardsToRemove);
      
      for (const shardId of shardsToRemoveIds) {
        const shard = this.shards.get(shardId);
        if (shard) {
          shard.status = 'draining';
          console.log(`Marking shard ${shardId} for room ${roomId} as draining`);
        }
      }
    } 
    // Scale up: create new shards
    else if (targetShardCount > previousCount && shardTemplate) {
      const newShardsCount = targetShardCount - previousCount;
      
      for (let i = 0; i < newShardsCount; i++) {
        const newShardId = `${roomId}-shard-${Date.now()}-${i}`;
        const shardUrl = shardTemplate.urlTemplate.replace('{shardId}', newShardId);
        
        await this.registerShard(
          newShardId, 
          roomId, 
          shardUrl, 
          shardTemplate.maxConnections
        );
      }
    }
    
    // Get updated shard list
    const updatedShardIds = this.roomShards.get(roomId) || [];
    const activeShardList = updatedShardIds
      .map(id => this.shards.get(id))
      .filter(shard => shard !== undefined)
      .map(shard => ({
        id: shard!.id,
        url: shard!.url,
        status: shard!.status
      }));
    
    // Persist changes
    await this.saveToStorage();
    
    return {
      success: true,
      roomId,
      previousShardCount: previousCount,
      currentShardCount: updatedShardIds.length,
      shards: activeShardList
    };
  }
  
  /**
   * Get room details including shards and metrics
   * @param roomId Room identifier
   */
  getRoomInfo(roomId: string): RoomInfoResult | { error: string } {
    if (!this.rooms.has(roomId)) {
      return { error: 'Room not found' };
    }
    
    const config = this.rooms.get(roomId)!;
    const shardIds = this.roomShards.get(roomId) || [];
    
    let totalConnections = 0;
    let totalCapacity = 0;
    
    const shardDetails = shardIds
      .map(id => this.shards.get(id))
      .filter(shard => shard !== undefined)
      .map(shard => {
        totalConnections += shard!.currentConnections;
        totalCapacity += shard!.maxConnections;
        
        return {
          id: shard!.id,
          url: shard!.url,
          connections: shard!.currentConnections,
          capacity: shard!.maxConnections,
          status: shard!.status
        };
      });
    
    const utilizationPercentage = totalCapacity > 0 
      ? Math.round((totalConnections / totalCapacity) * 100) 
      : 0;
    
    return {
      roomId,
      config,
      shards: shardDetails,
      metrics: {
        totalConnections,
        totalCapacity,
        utilizationPercentage
      }
    };
  }
  
  /**
   * Get all rooms with their info
   */
  getAllRoomsInfo(): { rooms: RoomInfoResult[] } {
    const roomsInfo: RoomInfoResult[] = [];
    
    for (const roomId of this.rooms.keys()) {
      const roomInfo = this.getRoomInfo(roomId);
      if (!('error' in roomInfo)) {
        roomsInfo.push(roomInfo);
      }
    }
    
    return { rooms: roomsInfo };
  }
  
  /**
   * Update shard statistics
   * @param shardId Shard identifier
   * @param connectionCount Current number of connections
   * @param status Current shard status
   */
  async updateShardStats(shardId: string, connectionCount: number, status: 'active' | 'maintenance' | 'draining' = 'active') {
    const shard = this.shards.get(shardId);
    if (!shard) {
      return { success: false, error: 'Shard not found' };
    }
    
    shard.currentConnections = connectionCount;
    shard.status = status;
    shard.lastHeartbeat = Date.now();
    
    // Persist changes
    await this.saveToStorage();
    
    return { success: true };
  }
  
  /**
   * Get all shards for a room
   * @param roomId Room identifier
   */
  getShards(roomId: string) {
    if (!this.rooms.has(roomId)) {
      return { success: false, error: 'Room not found' };
    }
    
    const shardIds = this.roomShards.get(roomId) || [];
    const shardDetails = shardIds
      .map(id => this.shards.get(id))
      .filter(shard => shard && shard.status === 'active')
      .map(shard => ({
        id: shard!.id,
        url: shard!.url,
        connections: shard!.currentConnections,
        capacity: shard!.maxConnections
      }));
    
    return { 
      success: true, 
      shards: shardDetails,
      total: shardDetails.length
    };
  }
  
  /**
   * Configure default settings for auto-scaling
   * @param defaultShardUrlTemplate URL template to use when auto-creating shards
   * @param defaultMaxConnectionsPerShard Default max connections per shard
   */
  configureAutoScaling(defaultShardUrlTemplate: string, defaultMaxConnectionsPerShard: number) {
    this.defaultShardUrlTemplate = defaultShardUrlTemplate;
    this.defaultMaxConnectionsPerShard = defaultMaxConnectionsPerShard;
    console.log(`Auto-scaling configured with template ${defaultShardUrlTemplate} and ${defaultMaxConnectionsPerShard} max connections`);
  }

  /**
   * Auto-create a shard for a room if none exists
   * @param roomId Room identifier
   * @returns The newly created shard or null if failed
   */
  private async autoCreateShard(roomId: string): Promise<ShardInfo | null> {
    if (!this.rooms.has(roomId)) {
      console.error(`Cannot auto-create shard for non-existent room: ${roomId}`);
      return null;
    }

    const shardId = `${roomId}-shard-${Date.now()}`;
    const url = this.defaultShardUrlTemplate.replace('{shardId}', shardId);
    
    console.log(`Auto-creating shard ${shardId} for room ${roomId}`);
    
    const result = await this.registerShard(
      shardId,
      roomId,
      url,
      this.defaultMaxConnectionsPerShard
    );
    
    if (!result.success) {
      console.error(`Failed to auto-create shard: ${result.error}`);
      return null;
    }
    
    return this.shards.get(shardId) || null;
  }

  /**
   * Create a new room if it doesn't exist with default configuration
   * @param roomId Room identifier
   * @returns Success flag and room id
   */
  async ensureRoomExists(roomId: string): Promise<{success: boolean, roomId: string, created: boolean}> {
    if (this.rooms.has(roomId)) {
      return { success: true, roomId, created: false };
    }
    
    const defaultConfig: RoomConfig = {
      name: roomId,
      balancingStrategy: 'least-connections',
      public: true,
      maxPlayersPerShard: this.defaultMaxConnectionsPerShard,
      minShards: 1,
      maxShards: 10
    };
    
    console.log(`Auto-creating room: ${roomId}`);
    const result = await this.registerRoom(roomId, defaultConfig);
    return { ...result, created: true };
  }
  
  /**
   * Get optimal shard for a client to connect to
   * @param roomId Room identifier
   * @param autoCreate Whether to auto-create room and shard if none exist
   */
  async getOptimalShard(roomId: string, autoCreate: boolean = true): Promise<ConnectResult | { error: string }> {
    // Try to create room if it doesn't exist and auto-create is enabled
    if (autoCreate && !this.rooms.has(roomId)) {
      const roomResult = await this.ensureRoomExists(roomId);
      if (!roomResult.success) {
        return { error: 'Failed to create room' };
      }
    } else if (!this.rooms.has(roomId)) {
      return { error: 'Room not found' };
    }
    
    const shardIds = this.roomShards.get(roomId) || [];
    
    // Get active shards only
    const activeShards = shardIds
      .map(id => this.shards.get(id))
      .filter(shard => shard && shard.status === 'active');
    
    // Auto-create a shard if none available and auto-create is enabled
    if (activeShards.length === 0 && autoCreate) {
      console.log(`No active shards for room ${roomId}, auto-creating one`);
      const newShard = await this.autoCreateShard(roomId);
      
      if (newShard) {
        return {
          url: newShard.url,
          shardId: newShard.id
        };
      }
      return { error: 'Failed to auto-create shard' };
    } else if (activeShards.length === 0) {
      return { error: 'No active shards available for this room' };
    }
    
    const room = this.rooms.get(roomId)!;
    let selectedShard: ShardInfo;
    
    // Select shard based on balancing strategy
    switch (room.balancingStrategy) {
      case 'least-connections':
        // Find shard with fewest connections
        selectedShard = activeShards.reduce((min, shard) => 
          !min || (shard!.currentConnections < min.currentConnections) ? shard! : min, 
          null as unknown as ShardInfo);
        break;
        
      case 'random':
        // Select a random shard
        const randomIndex = Math.floor(Math.random() * activeShards.length);
        selectedShard = activeShards[randomIndex]!;
        break;
        
      case 'round-robin':
      default:
        // Round-robin selection
        let counter = this.rrCounters.get(roomId) || 0;
        counter = (counter + 1) % activeShards.length;
        this.rrCounters.set(roomId, counter);
        selectedShard = activeShards[counter]!;
        break;
    }
    
    return { 
      url: selectedShard.url,
      shardId: selectedShard.id
    };
  }
  
  /**
   * Handle HTTP requests to the World service
   */
  async onRequest(req: Party.Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    
    // Create a helper function for JSON responses
    const jsonResponse = (data: any, status: number = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    // Main route: /parties/world/{worldId} with query parameters
    if (path.startsWith('/parties/world/')) {
      // 1. Extract worldId from path
      const pathParts = path.split('/');
      if (pathParts.length < 4) {
        return jsonResponse({ error: 'Invalid path format' }, 400);
      }
      
      const worldId = pathParts[3]; // The world ID is the 4th segment (index 3)
      const action = url.searchParams.get('action');
      
      // 2. Process by action and method
      // 2.1 Action: connect - Get optimal shard for a room
      if (action === 'connect' && method === 'POST') {
        const roomId = url.searchParams.get('roomId');
        const autoCreate = url.searchParams.get('autoCreate') !== 'false'; // Default to true
        
        // Verify that roomId is present
        if (!roomId) {
          return jsonResponse({ error: 'Missing roomId parameter' }, 400);
        }
        
        // Get the optimal shard for this room
        const result = await this.getOptimalShard(roomId, autoCreate);
        
        if ('error' in result) {
          return jsonResponse({ error: result.error }, 404);
        }
        
        return jsonResponse(result);
      }
      
      // 2.2 Action: shards - Get the list of shards for a room
      else if (action === 'shards' && method === 'GET') {
        const roomId = url.searchParams.get('roomId');
        
        // Verify that roomId is present
        if (!roomId) {
          return jsonResponse({ error: 'Missing roomId parameter' }, 400);
        }
        
        // Get the list of shards for this room
        const result = this.getShards(roomId);
        
        if (!result.success) {
          return jsonResponse({ error: result.error }, 404);
        }
        
        return jsonResponse(result);
      }
      
      // 2.3 Action: register-room - Register a new room
      else if (action === 'register-room' && method === 'POST') {
        try {
          // Parse the request body
          const body = await req.json() as RegisterRoomBody;
          const { roomId, config } = body;
          
          if (!roomId || !config) {
            return jsonResponse({ error: 'Missing required fields' }, 400);
          }
          
          // Validate config fields
          if (!config.name || !config.balancingStrategy || config.maxPlayersPerShard === undefined) {
            return jsonResponse({ error: 'Invalid room configuration' }, 400);
          }
          
          // Register the room
          const result = await this.registerRoom(roomId, config);
          return jsonResponse(result);
        } catch (e) {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
      }
      
      // 2.4 Action: register-shard - Register a new shard
      else if (action === 'register-shard' && method === 'POST') {
        try {
          // Parse the request body
          const body = await req.json() as RegisterShardBody;
          const { shardId, roomId, url, maxConnections } = body;
          
          if (!shardId || !roomId || !url || !maxConnections) {
            return jsonResponse({ error: 'Missing required fields' }, 400);
          }
          
          // Register the shard
          const result = await this.registerShard(shardId, roomId, url, maxConnections);
          return jsonResponse(result);
        } catch (e) {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
      }
      
      // 2.5 Action: update-shard - Update shard statistics
      else if (action === 'update-shard' && method === 'POST') {
        try {
          // Parse the request body
          const body = await req.json() as UpdateShardStatsBody;
          const { shardId, connections, status } = body;
          
          if (!shardId || connections === undefined) {
            return jsonResponse({ error: 'Missing required fields' }, 400);
          }
          
          // Update shard stats
          const result = await this.updateShardStats(shardId, connections, status);
          return jsonResponse(result);
        } catch (e) {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
      }
      
      // 2.6 Action: scale-room - Adjust the number of shards for a room
      else if (action === 'scale-room' && method === 'POST') {
        try {
          // Parse the request body
          const body = await req.json() as ScaleRoomBody;
          const { roomId, targetShardCount, shardTemplate } = body;
          
          if (!roomId || targetShardCount === undefined) {
            return jsonResponse({ error: 'Missing required fields' }, 400);
          }
          
          // Scale the room's shards
          const result = await this.scaleShardsForRoom(roomId, targetShardCount, shardTemplate);
          return jsonResponse(result);
        } catch (e) {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
      }
      
      // 2.7 Action: room-info - Get room details
      else if (action === 'room-info' && method === 'GET') {
        const roomId = url.searchParams.get('roomId');
        
        // If roomId is provided, get specific room info
        if (roomId) {
          const result = this.getRoomInfo(roomId);
          
          if ('error' in result) {
            return jsonResponse({ error: result.error }, 404);
          }
          
          return jsonResponse(result);
        }
        // Otherwise get all rooms
        else {
          const result = this.getAllRoomsInfo();
          return jsonResponse(result);
        }
      }
      
      // Unrecognized action
      else {
        return jsonResponse({ error: 'Unknown action or method not allowed' }, 400);
      }
    }
    
    // Default route for unknown paths
    return jsonResponse({ error: 'Not found' }, 404);
  }
  
  // Handle WebSocket connections if needed
  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // We could implement a WebSocket-based protocol for shard-world communication
    // But for now we're using HTTP
    conn.close();
  }
  
  // No real message handling needed for HTTP-based API
  onMessage(message: string, sender: Party.Connection) {
    // Not used
  }
  
  // Clean up if needed
  onClose(conn: Party.Connection) {
    // Not used
  }
  
  /**
   * Periodic tasks - could be used to clean up inactive shards
   */
  async onAlarm() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes
    
    // Check for inactive shards
    for (const [shardId, shard] of this.shards.entries()) {
      if (now - shard.lastHeartbeat > timeout && shard.status === 'active') {
        console.log(`Shard ${shardId} has not sent a heartbeat for more than 5 minutes. Marking as inactive.`);
        shard.status = 'draining';
        
        // Persist changes
        await this.saveToStorage();
      }
    }
  }
}

// Make World compatible with Party.Worker interface
(World as any).prototype.onStart = World.prototype.onStart;
(World as any).prototype.onConnect = World.prototype.onConnect;
(World as any).prototype.onMessage = World.prototype.onMessage;
(World as any).prototype.onClose = World.prototype.onClose;
(World as any).prototype.onRequest = World.prototype.onRequest;
(World as any).prototype.onAlarm = World.prototype.onAlarm;
