import { load } from "@signe/sync";
import PartySocket, { PartySocketOptions } from "partysocket";

export interface WorldConnectionOptions {
  host: string;
  room: string;
  worldId?: string;
  retryCount?: number;
  retryDelay?: number;
  autoCreate?: boolean;
}

interface RoomInstance {
  [key: string]: any;
  $valuesChanges?: {
    set: (path: string, value: any) => void;
    setPersist: (path: string) => void;
    has: (path: string) => boolean;
    get: (path: string) => any;
  };
}

interface ConnectionResult {
  emit: (key: string, value: any) => void;
  on: (key: string, cb: (value: any) => void) => void;
  off: (key: string, cb: (value: any) => void) => void;
  close: () => void;
  conn: PartySocket;
  shardInfo?: {
    shardId: string;
    url: string;
  };
}

interface WorldConnectionResult extends ConnectionResult {
  shardInfo: {
    shardId: string;
    url: string;
  };
}

// Implémentation synchrone de la connexion (sans feature world)
function createConnection(options: PartySocketOptions, roomInstance: RoomInstance): ConnectionResult {
  // Créer la connexion
  const conn = new PartySocket(options);
  
  // Set up message handling
  conn.addEventListener("message", (event) => {
    const object = JSON.parse(event.data);
    switch (object.type) {
      case "sync":
        load(roomInstance, object.value, true);
        break;
    }
  });
  
  return {
    emit: (key, value) => {
      conn.send(
        JSON.stringify({
          action: key,
          value,
        })
      );
    },
    on: (key, cb) => {
      conn.addEventListener("message", (event) => {
        const object = JSON.parse(event.data);
        if (object.type === key) {
          cb(object.value);
        }
      });
    },
    off: (key, cb) => {
      conn.removeEventListener("message", (event) => {
        const object = JSON.parse(event.data);
        if (object.type === key) {
          cb(object.value);
        }
      });
    },
    close: () => conn.close(),
    conn
  };
}

/**
 * Connect to a Party.js room
 * @param options Connection options for direct connection
 * @param roomInstance Instance to receive state updates
 * @returns Connection result with methods to interact with the room
 */
export async function connectionRoom(options: PartySocketOptions, roomInstance: RoomInstance): Promise<ConnectionResult> {
  return createConnection(options, roomInstance);
}

/**
 * Connect to a room via the World service to get the optimal shard
 * @param options Connection options for World-based connection
 * @param roomInstance Instance to receive state updates
 * @returns Connection result with methods to interact with the room and shard information
 */
export async function connectionWorld(
  options: WorldConnectionOptions,
  roomInstance: RoomInstance
): Promise<WorldConnectionResult> {

  const shardInfo = await getOptimalShard(options);
  // Create options for PartySocket
  const socketOptions: PartySocketOptions = {
    host: options.host,
    party: 'shard',
    room: shardInfo.url
  };
  // Establish connection with configured options
  const result = createConnection(socketOptions, roomInstance);

  // Add shard info to result
  return {
    ...result,
    shardInfo
  };
}

/**
 * Get the optimal shard for a room from the World service
 * @param worldOptions Options for connecting to the World
 * @returns Information about the selected shard
 */
async function getOptimalShard(worldOptions: WorldConnectionOptions): Promise<{ shardId: string, url: string }> {
  const { 
    host, 
    room, 
    worldId = 'world-default', // Default World ID is "default"
    retryCount = 3, 
    retryDelay = 1000,
    autoCreate = true // Default to true for auto-creation
  } = worldOptions as WorldConnectionOptions;
  
  let attempts = 0;

  // Build URL in expected format
  const url = new URL(`${host}/parties/world/${encodeURIComponent(worldId)}/connect`);
  const requestUrl = url.toString();
  
  // Try to get a shard with retries
  while (attempts < retryCount) {
    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          roomId: room,
          autoCreate
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(`World service returned ${response.status}: ${errorData.error || 'Unknown error'}`);
      }
      
      const data = await response.json();
      
      if (!data.url || !data.shardId) {
        throw new Error('Invalid response from World service: missing url or shardId');
      }
      
      return {
        shardId: data.shardId,
        url: data.url
      };
    } catch (error) {
      attempts++;
      
      if (attempts >= retryCount) {
        throw error;
      }
      
      console.warn(`Failed to get shard (attempt ${attempts}/${retryCount}). Retrying in ${retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  // This should never happen due to the throw in the loop, but TypeScript needs it
  throw new Error('Failed to get shard after all retry attempts');
}

export { PartySocket };
