import {
  load,
  loadEvents,
  decodeMessage,
  COMPRESSION_QUERY_PARAM,
  COMPRESSION_QUERY_VALUE,
  PATH_FORMAT_QUERY_PARAM,
  PATH_FORMAT_QUERY_VALUE,
  PathTableDecoder,
} from "@signe/sync";
import PartySocket, { PartySocketOptions } from "partysocket";

export interface CompressionOptions {
  /**
   * Ask the server for compressed messages (binary frames, DEFLATE).
   * Only used when the room enables `compression`; otherwise messages stay JSON text.
   */
  compression?: boolean;
  /**
   * Receive sync packets in the path table format: a flat list of path ids and values
   * instead of nested objects. Smaller packets, faster to parse and to apply.
   * `on("sync", cb)` then receives no `value`: read the state instead.
   */
  pathFormat?: boolean;
}

export type RoomConnectionOptions = PartySocketOptions & CompressionOptions;

export interface WorldConnectionOptions extends PartySocketOptions, CompressionOptions {
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

function withCompressionQuery(options: RoomConnectionOptions): PartySocketOptions {
  const { compression, pathFormat, ...socketOptions } = options;
  if (!compression && !pathFormat) return socketOptions;
  const query = socketOptions.query;
  const flag: Record<string, string> = {};
  if (compression) flag[COMPRESSION_QUERY_PARAM] = COMPRESSION_QUERY_VALUE;
  if (pathFormat) flag[PATH_FORMAT_QUERY_PARAM] = PATH_FORMAT_QUERY_VALUE;
  return {
    ...socketOptions,
    query: typeof query === "function"
      ? async () => ({ ...(await query()), ...flag })
      : { ...(query || {}), ...flag },
  };
}

function createConnection(options: RoomConnectionOptions, roomInstance: RoomInstance): ConnectionResult {
  const conn = new PartySocket(withCompressionQuery(options));
  if (options.compression) {
    // Compressed messages are binary frames: read them synchronously as ArrayBuffer
    (conn as any).binaryType = "arraybuffer";
  }

  // Every listener receives the same event: decode (and decompress) it once
  const decoded = new WeakMap<object, any>();
  const decodeEvent = (event: MessageEvent) => {
    if (decoded.has(event)) return decoded.get(event);
    const object = decodeMessage(event.data);
    decoded.set(event, object);
    return object;
  };
  const handlers = new Map<string, Map<(value: any) => void, (event: MessageEvent) => void>>();
  // The path table belongs to the connection (the server sends "r" to reset it on reconnection)
  const pathDecoder = new PathTableDecoder();
  
  // Set up message handling
  conn.addEventListener("message", (event) => {
    const object = decodeEvent(event);
    switch (object.type) {
      case "sync":
        if (PathTableDecoder.isPathPacket(object)) {
          pathDecoder.apply(roomInstance, object);
        } else {
          load(roomInstance, object.value, true);
        }
        // Volatile events run after the state of the same packet is applied
        loadEvents(roomInstance, object.events);
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
      const handler = (event: MessageEvent) => {
        const object = decodeEvent(event);
        if (object.type === key) {
          cb(object.value);
        }
      };
      if (!handlers.has(key)) handlers.set(key, new Map());
      handlers.get(key)!.set(cb, handler);
      conn.addEventListener("message", handler);
    },
    off: (key, cb) => {
      // Remove the handler registered by on() for this callback
      const handler = handlers.get(key)?.get(cb);
      if (!handler) return;
      handlers.get(key)!.delete(cb);
      conn.removeEventListener("message", handler);
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
export async function connectionRoom(options: RoomConnectionOptions, roomInstance: RoomInstance): Promise<ConnectionResult> {
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
  const result = createConnection({
    ...options,
    party: 'shard',
    room: shardInfo.url
  }, roomInstance);

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
