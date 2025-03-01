import { dset } from "dset";
import z from "zod";
import {
  createStatesSnapshot,
  getByPath,
  load,
  syncClass,
  DELETE_TOKEN,
  generateShortUUID
} from "@signe/sync";
import type * as Party from "./types/party";
import {
  awaitReturn,
  buildObject,
  extractParams,
  isClass,
  throttle,
} from "./utils";

const Message = z.object({
  action: z.string(),
  value: z.any(),
});

type CreateRoomOptions = {
  getMemoryAll?: boolean;
};

/**
 * @class Server
 * @implements {Party.Server}
 * @description Represents a server that manages rooms and connections for a multiplayer game or application.
 * 
 * @example
 * ```typescript
 * import { Room, Server, ServerIo } from "@yourpackage/room";
 * 
 * @Room({ path: "game" })
 * class GameRoom {
 *   // Room implementation
 * }
 * 
 * class MyServer extends Server {
 *   rooms = [GameRoom];
 * }
 * 
 * const server = new MyServer(new ServerIo("game"));
 * server.onStart();
 * ```
 */
export class Server implements Party.Server {
  subRoom = null;
  rooms: any[] = [];

  /**
   * @constructor
   * @param {Party.Room} room - The room object representing the current game or application instance.
   * 
   * @example
   * ```typescript
   * const server = new MyServer(new ServerIo("game"));
   * ```
   */
  constructor(readonly room: Party.Room) {}

 /**
   * @readonly
   * @property {boolean} isHibernate - Indicates whether the server is in hibernate mode.
   * 
   * @example
   * ```typescript
   * if (!server.isHibernate) {
   *   console.log("Server is active");
   * }
   * ```
   */
  get isHibernate(): boolean {
    return !!this["options"]?.hibernate;
  }

  get roomStorage(): Party.Storage {
    return this.room.storage
  }

  /**
   * @method onStart
   * @async
   * @description Initializes the server and creates the initial room if not in hibernate mode.
   * @returns {Promise<void>}
   * 
   * @example
   * ```typescript
   * async function initServer() {
   *   await server.onStart();
   *   console.log("Server started");
   * }
   * ```
   */

  async onStart() {
    // Only create a room if not in hibernate mode
    // This prevents unnecessary resource allocation for inactive rooms
    if (!this.isHibernate) {
      this.subRoom = await this.createRoom();
    }
  }

  private async garbageCollector(options: { sessionExpiryTime: number }) {
    const subRoom = await this.getSubRoom();
    if (!subRoom) return;

    // Get active connections
    const activeConnections = [...this.room.getConnections()];
    const activePrivateIds = new Set(activeConnections.map(conn => conn.id));

    try {
      // Get all sessions from storage
      const sessions = await this.room.storage.list();
      const users = this.getUsersProperty(subRoom);
      const usersPropName = this.getUsersPropName(subRoom);

      // Store valid publicIds from sessions
      const validPublicIds = new Set<string>();
      const expiredPublicIds = new Set<string>();
      const SESSION_EXPIRY_TIME = options.sessionExpiryTime 
      const now = Date.now();

      for (const [key, session] of sessions) {
        // Only process session entries
        if (!key.startsWith('session:')) continue;

        const privateId = key.replace('session:', '');
        const typedSession = session as {publicId: string, created: number, connected: boolean};
        
        // Check if session should be deleted based on:
        // 1. Connection is not active
        // 2. Session is marked as disconnected
        // 3. Session is older than expiry time
        if (!activePrivateIds.has(privateId) && 
            !typedSession.connected && 
            (now - typedSession.created) > SESSION_EXPIRY_TIME) {
          // Delete expired session
          await this.deleteSession(privateId);
          expiredPublicIds.add(typedSession.publicId);
        } else if (typedSession && typedSession.publicId) {
          // Keep track of valid publicIds from active or recent sessions
          validPublicIds.add(typedSession.publicId);
        }
      }

      // Clean up users only if ALL their sessions are expired
      if (users && usersPropName) {
        const currentUsers = users();
        for (const publicId in currentUsers) {
          // Only delete user if they have an expired session and no valid sessions
          if (expiredPublicIds.has(publicId) && !validPublicIds.has(publicId)) {
            delete currentUsers[publicId];
            await this.room.storage.delete(`${usersPropName}.${publicId}`);
          }
        }
      }
     
    } catch (error) {
      console.error('Error in garbage collector:', error);
    }
  }

  /**
   * @method createRoom
   * @private
   * @async
   * @param {CreateRoomOptions} [options={}] - Options for creating the room.
   * @returns {Promise<Object>} The created room instance.
   * 
   * @example
   * ```typescript
   * // This method is private and called internally
   * async function internalCreateRoom() {
   *   const room = await this.createRoom({ getMemoryAll: true });
   *   console.log("Room created:", room);
   * }
   * ```
   */
  private async createRoom(options: CreateRoomOptions = {}) {
    let instance
    let init = true
    let initPersist = true

    // Find the appropriate room based on the current room ID
    for (let room of this.rooms) {
      const params = extractParams(room.path, this.room.id);
      if (params) {
        instance = new room(this.room, params);
        break;
      }
    }

    if (!instance) {
      return null;
    }

    // Load the room's memory from storage
    // This ensures persistence across server restarts
    const loadMemory = async () => {
      const root = await this.room.storage.get(".");
      const memory = await this.room.storage.list();
      const tmpObject: any = root || {};
      for (let [key, value] of memory) {
        if (key.startsWith('session:')) {
          continue;
        }
        if (key == ".") {
          continue;
        }
        dset(tmpObject, key, value);
      }
      load(instance, tmpObject, true);
    };

    instance.$memoryAll = {}

    // Sync callback: Broadcast changes to all clients
    const syncCb = (values) => {
      if (options.getMemoryAll) {
        buildObject(values, instance.$memoryAll);
      }
      if (init && this.isHibernate) {
        init = false;
        return;
      }
      const packet = buildObject(values, instance.$memoryAll);
      this.room.broadcast(
        JSON.stringify({
          type: "sync",
          value: packet,
        })
      );
      values.clear();
    }

    // Persist callback: Save changes to storage
    const persistCb = async (values: Map<string, any>) => {
      if (initPersist) {
        values.clear();
        return;
      }
      for (let [path, value] of values) {
        const _instance =
          path == "." ? instance : getByPath(instance, path);
        const itemValue = createStatesSnapshot(_instance); 
        if (value == DELETE_TOKEN) {
          await this.room.storage.delete(path);
        } else {
          await this.room.storage.put(path, itemValue);
        }
      }
      values.clear();
    }

    // Set up syncing and persistence with throttling to optimize performance
    syncClass(instance, {
      onSync: throttle(syncCb, instance["throttleSync"] ?? 500),
      onPersist: throttle(persistCb, instance["throttleStorage"] ?? 2000),
    });

    await loadMemory();

    initPersist = false

    return instance
  }

  /**
   * @method getSubRoom
   * @private
   * @async
   * @param {Object} [options={}] - Options for getting the sub-room.
   * @returns {Promise<Object>} The sub-room instance.
   * 
   * @example
   * ```typescript
   * // This method is private and called internally
   * async function internalGetSubRoom() {
   *   const subRoom = await this.getSubRoom();
   *   console.log("Sub-room retrieved:", subRoom);
   * }
   * ```
   */
  private async getSubRoom(options = {}): Promise<any | null> {
    let subRoom // instance of the room or null
    if (this.isHibernate) {
      subRoom = await this.createRoom(options)
    }
    else {
      subRoom = this.subRoom
    }
    return subRoom
  }

  /**
   * @method getUsersProperty
   * @private
   * @param {Object} subRoom - The sub-room instance.
   * @returns {Object|null} The users property of the sub-room, or null if not found.
   * 
   * @example
   * ```typescript
   * // This method is private and called internally
   * function internalGetUsers(subRoom) {
   *   const users = this.getUsersProperty(subRoom);
   *   console.log("Users:", users);
   * }
   * ```
   */

  private getUsersProperty(subRoom) {
    const meta = subRoom.constructor["_propertyMetadata"];
    const propId = meta?.get("users");
    if (propId) {
      return subRoom[propId];
    }
    return null;
  }

  private getUsersPropName(subRoom) {
    const meta = subRoom.constructor["_propertyMetadata"];
    return meta?.get("users")
  }

  private async getSession(privateId: string): Promise<{publicId: string, state?: any, created?: number, connected?: boolean} | null> {
    if (!privateId) return null;
    try {
      const session = await this.room.storage.get(`session:${privateId}`);
      return session as {publicId: string, state?: any, created: number, connected: boolean} | null;
    } catch (e) {
      return null;
    }
  }

  private async saveSession(privateId: string, data: {publicId: string, state?: any, created?: number, connected?: boolean}) {
    const sessionData = {
      ...data,
      created: data.created || Date.now(),
      connected: data.connected !== undefined ? data.connected : true
    };
    await this.room.storage.put(`session:${privateId}`, sessionData);
  }

  private async updateSessionConnection(privateId: string, connected: boolean) {
    const session = await this.getSession(privateId);
    if (session) {
      await this.saveSession(privateId, { ...session, connected });
    }
  }

  private async deleteSession(privateId: string) {
    await this.room.storage.delete(`session:${privateId}`);
  }

  async onConnectClient(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const subRoom = await this.getSubRoom({
      getMemoryAll: true,
    })

    if (!subRoom) {
      conn.close();
      return;
    }

    const sessionExpiryTime = subRoom.constructor.sessionExpiryTime;
    await this.garbageCollector({ sessionExpiryTime });

    // Check room guards
    const roomGuards = subRoom.constructor['_roomGuards'] || [];
    for (const guard of roomGuards) {
      const isAuthorized = await guard(conn, ctx);
      if (!isAuthorized) {
        conn.close();
        return;
      }
    }

    // Check for existing session
    const existingSession = await this.getSession(conn.id) 

    // Generate IDs
    const publicId = existingSession?.publicId || generateShortUUID();

    let user = null;
    const signal = this.getUsersProperty(subRoom);
    const usersPropName = this.getUsersPropName(subRoom);

    if (signal) {
      const { classType } = signal.options;
     
      // Restore state if exists
      if (!existingSession?.publicId) {
        user = isClass(classType) ? new classType() : classType(conn, ctx);
        signal()[publicId] = user;
        const snapshot = createStatesSnapshot(user);
        this.room.storage.put(`${usersPropName}.${publicId}`, snapshot);
      }
      
      // Only store new session if it doesn't exist
      if (!existingSession) {
        await this.saveSession(conn.id, {
          publicId
        });
      }
      else {
        await this.updateSessionConnection(conn.id, true);
      }
    }

    // Call the room's onJoin method if it exists
    await awaitReturn(subRoom["onJoin"]?.(user, conn, ctx));
    
    // Store both IDs in connection state
    conn.setState({ 
      ...conn.state,
      publicId
     });

    // Send initial sync data with both IDs to the new connection
    conn.send(
      JSON.stringify({
        type: "sync",
        value: {
          pId: publicId,
          ...subRoom.$memoryAll,
        },
      })
    );
  }

  /**
   * @method onConnect
   * @async
   * @param {Party.Connection} conn - The connection object for the new user.
   * @param {Party.ConnectionContext} ctx - The context of the connection.
   * @description Handles a new user connection, creates a user object, and sends initial sync data.
   * @returns {Promise<void>}
   * 
   * @example
   * ```typescript
   * server.onConnect = async (conn, ctx) => {
   *   await server.onConnect(conn, ctx);
   *   console.log("New user connected:", conn.id);
   * };
   * ```
   */
  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    if (ctx.request?.headers.has('x-shard-id')) {
      this.onConnectShard(conn, ctx);
    }
    else {
      await this.onConnectClient(conn, ctx);
    }
  }

  /**
   * @method onConnectShard
   * @private
   * @param {Party.Connection} conn - The connection object for the new shard.
   * @param {Party.ConnectionContext} ctx - The context of the shard connection.
   * @description Handles a new shard connection, setting up the necessary state.
   * @returns {void}
   */
  onConnectShard(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // Set shard metadata in connection state
    const shardId = ctx.request?.headers.get('x-shard-id') || 'unknown-shard';
    conn.setState({
      shard: true,
      shardId,
      clients: new Map() // Track clients connected through this shard
    });
  }

  /**
   * @method onMessage
   * @async
   * @param {string} message - The message received from a user or shard.
   * @param {Party.Connection} sender - The connection object of the sender.
   * @description Processes incoming messages, handling differently based on if sender is shard or client.
   * @returns {Promise<void>}
   */
  async onMessage(message: string, sender: Party.Connection) {
    // Check if message is from a shard
    if (sender.state && (sender.state as any).shard) {
      await this.handleShardMessage(message, sender);
      return;
    }
    
    // Regular client message handling
    let json
    try {
      json = JSON.parse(message)
    }
    catch (e) {
      return;
    }
    
    // Validate incoming messages
    const result = Message.safeParse(json);
    if (!result.success) {
      return;
    }
    
    const subRoom = await this.getSubRoom()
    
    // Check room guards
    const roomGuards = subRoom.constructor['_roomGuards'] || [];
    for (const guard of roomGuards) {
      const isAuthorized = await guard(sender, result.data.value, this.room);
      if (!isAuthorized) {
        return;
      }
    }

    const actions = subRoom.constructor["_actionMetadata"];
    if (actions) {
      const signal = this.getUsersProperty(subRoom);
      const { publicId } = sender.state as any;
      const user = signal?.()[publicId];
      const actionName = actions.get(result.data.action);
      if (actionName) {

        // Check all guards if they exist
        const guards = subRoom.constructor['_actionGuards']?.get(actionName.key) || [];
        for (const guard of guards) {
          const isAuthorized = await guard(sender, result.data.value);
          if (!isAuthorized) {
            return;
          }
        }

        // Validate action body if a validation schema is defined
        if (actionName.bodyValidation) {
          const bodyResult = actionName.bodyValidation.safeParse(
            result.data.value
          );
          if (!bodyResult.success) {
            return;
          }
        }
        // Execute the action
        await awaitReturn(
          subRoom[actionName.key](user, result.data.value, sender)
        );
      }
    }
  }

  /**
   * @method handleShardMessage
   * @private
   * @async
   * @param {string} message - The message received from a shard.
   * @param {Party.Connection} shardConnection - The connection object of the shard.
   * @description Processes messages from shards, extracting client information.
   * @returns {Promise<void>}
   */
  private async handleShardMessage(message: string, shardConnection: Party.Connection) {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
    } catch (e) {
      console.error("Error parsing shard message:", e);
      return;
    }
    
    const shardState = shardConnection.state as any;
    const clients = shardState.clients;
    
    switch (parsedMessage.type) {
      case 'shard.clientConnected':
        // Handle new client connection through shard
        await this.handleShardClientConnect(parsedMessage, shardConnection);
        break;
        
      case 'shard.clientMessage':
        // Handle message from a client through shard
        await this.handleShardClientMessage(parsedMessage, shardConnection);
        break;
        
      case 'shard.clientDisconnected':
        // Handle client disconnection through shard
        await this.handleShardClientDisconnect(parsedMessage, shardConnection);
        break;
        
      default:
        console.warn(`Unknown shard message type: ${parsedMessage.type}`);
    }
  }
  
  /**
   * @method handleShardClientConnect
   * @private
   * @async
   * @param {Object} message - The client connection message from a shard.
   * @param {Party.Connection} shardConnection - The connection object of the shard.
   * @description Handles a new client connection via a shard.
   * @returns {Promise<void>}
   */
  private async handleShardClientConnect(message: any, shardConnection: Party.Connection) {
    const { privateId, connectionInfo } = message;
    const shardState = shardConnection.state as any;
    
    // Create a virtual connection context for the client
    const virtualContext: Party.ConnectionContext = {
      request: {
        headers: new Headers({
          'x-forwarded-for': connectionInfo.ip,
          'user-agent': connectionInfo.userAgent,
          // Add other headers as needed
        }),
        method: 'GET',
        url: ''
      } as unknown as Party.Request
    };
    
    // Create a virtual connection for the client
    const virtualConnection: Partial<Party.Connection> = {
      id: privateId,
      send: (data: string) => {
        // Forward to the actual client through the shard
        shardConnection.send(JSON.stringify({
          targetClientId: privateId,
          data
        }));
      },
      state: {},
      setState: (state: unknown) => {
        // Store client state in the shard's client map
        const clients = shardState.clients;
        const currentState = clients.get(privateId) || {};
        const mergedState = Object.assign({}, currentState, state as object);
        clients.set(privateId, mergedState);
        
        // Update our virtual connection's state reference
        virtualConnection.state = clients.get(privateId);
        return virtualConnection.state as any;
      },
      close: () => {
        // Send close command to the shard
        shardConnection.send(JSON.stringify({
          type: 'shard.closeClient',
          privateId
        }));
        
        // Clean up virtual connection
        if (shardState.clients) {
          shardState.clients.delete(privateId);
        }
      }
    };
    
    // Initialize the client's state in the shard state
    if (!shardState.clients.has(privateId)) {
      shardState.clients.set(privateId, {});
    }
    
    // Now handle this virtual connection as a regular client connection
    await this.onConnectClient(virtualConnection as Party.Connection, virtualContext);
  }
  
  /**
   * @method handleShardClientMessage
   * @private
   * @async
   * @param {Object} message - The client message from a shard.
   * @param {Party.Connection} shardConnection - The connection object of the shard.
   * @description Handles a message from a client via a shard.
   * @returns {Promise<void>}
   */
  private async handleShardClientMessage(message: any, shardConnection: Party.Connection) {
    const { privateId, publicId, payload } = message;
    const shardState = shardConnection.state as any;
    const clients = shardState.clients;
    
    // Get or create virtual connection for this client
    if (!clients.has(privateId)) {
      console.warn(`Received message from unknown client ${privateId}, creating virtual connection`);
      clients.set(privateId, { publicId });
    }
    
    // Create a virtual connection for the client
    const virtualConnection: Partial<Party.Connection> = {
      id: privateId,
      send: (data: string) => {
        // Forward to the actual client through the shard
        shardConnection.send(JSON.stringify({
          targetClientId: privateId,
          data
        }));
      },
      state: clients.get(privateId),
      setState: (state: unknown) => {
        const currentState = clients.get(privateId) || {};
        const mergedState = Object.assign({}, currentState, state as object);
        clients.set(privateId, mergedState);
        virtualConnection.state = clients.get(privateId);
        return virtualConnection.state as any;
      },
      close: () => {
        shardConnection.send(JSON.stringify({
          type: 'shard.closeClient',
          privateId
        }));
        
        if (shardState.clients) {
          shardState.clients.delete(privateId);
        }
      }
    };
    
    // Process the payload using the regular message handler
    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await this.onMessage(payloadString, virtualConnection as Party.Connection);
  }
  
  /**
   * @method handleShardClientDisconnect
   * @private
   * @async
   * @param {Object} message - The client disconnection message from a shard.
   * @param {Party.Connection} shardConnection - The connection object of the shard.
   * @description Handles a client disconnection via a shard.
   * @returns {Promise<void>}
   */
  private async handleShardClientDisconnect(message: any, shardConnection: Party.Connection) {
    const { privateId, publicId } = message;
    const shardState = shardConnection.state as any;
    const clients = shardState.clients;
    
    // Get client state
    const clientState = clients.get(privateId);
    if (!clientState) {
      console.warn(`Disconnection for unknown client ${privateId}`);
      return;
    }
    
    // Create a virtual connection for the client one last time
    const virtualConnection: Partial<Party.Connection> = {
      id: privateId,
      send: () => {}, // No-op since client is disconnecting
      state: clientState,
      setState: () => {
        // No-op since client is disconnecting
        return {} as any;
      },
      close: () => {}
    };
    
    // Handle disconnection with the regular onClose handler
    await this.onClose(virtualConnection as Party.Connection);
    
    // Clean up
    clients.delete(privateId);
  }

  /**
   * @method onClose
   * @async
   * @param {Party.Connection} conn - The connection object of the disconnecting user.
   * @description Handles user disconnection, removing them from the room and triggering the onLeave event.
   * @returns {Promise<void>}
   * 
   * @example
   * ```typescript
   * server.onClose = async (conn) => {
   *   await server.onClose(conn);
   *   console.log("User disconnected:", conn.id);
   * };
   * ```
   */
  async onClose(conn: Party.Connection) {
    const subRoom = await this.getSubRoom()

    if (!subRoom) {
      return;
    }

    const signal = this.getUsersProperty(subRoom);

    if (!conn.state) {
      return;
    }

    const privateId = conn.id;
    const { publicId } = conn.state as any;
    const user = signal?.()[publicId];

    if (!user) return;

    await awaitReturn(subRoom["onLeave"]?.(user, conn));

    // Mark session as disconnected instead of deleting it
    await this.updateSessionConnection(privateId, false);

    // Broadcast user disconnection
    this.room.broadcast(
      JSON.stringify({
        type: "user_disconnected",
        value: { publicId }
      })
    );
  }

  async onAlarm() {
    const subRoom = await this.getSubRoom()
    await awaitReturn(subRoom["onAlarm"]?.(subRoom));
  }

  async onError(connection: Party.Connection, error: Error) {
    const subRoom = await this.getSubRoom()
    await awaitReturn(subRoom["onError"]?.(connection, error));
  }

  /**
   * @method onRequest
   * @async
   * @param {Party.Request} req - The HTTP request to handle
   * @description Handles HTTP requests, either directly from clients or forwarded by shards
   * @returns {Promise<Response>} The response to return to the client
   */
  async onRequest(req: Party.Request) {
    // Check if the request is coming from a shard
    const isFromShard = req.headers.has('x-forwarded-by-shard');
    const shardId = req.headers.get('x-shard-id');
 
    if (isFromShard) {
      return this.handleShardRequest(req, shardId);
    }
    
    // Handle regular client request
    return this.handleDirectRequest(req);
  }
  
  /**
   * @method handleDirectRequest
   * @private
   * @async
   * @param {Party.Request} req - The HTTP request received directly from a client
   * @description Processes requests received directly from clients
   * @returns {Promise<Response>} The response to return to the client
   */
  private async handleDirectRequest(req: Party.Request): Promise<Response> {
    const subRoom = await this.getSubRoom();
    const res = (body: any, status: number) => {
      return new Response(JSON.stringify(body), { status });
    };
    
    if (!subRoom) {
      return res({
        error: "Not found"
      }, 404);
    }

    // First try to match using the registered @Request handlers
    const response = await this.tryMatchRequestHandler(req, subRoom);
    if (response) {
      return response;
    }

    // Fall back to the legacy onRequest method if no handler matched
    const legacyResponse = await awaitReturn(subRoom["onRequest"]?.(req, this.room));
    if (!legacyResponse) {
      return res({
        error: "Not found"
      }, 404);
    }
    if (legacyResponse instanceof Response) {
      return legacyResponse;
    }
    return res(legacyResponse, 200);
  }

  /**
   * @method tryMatchRequestHandler
   * @private
   * @async
   * @param {Party.Request} req - The HTTP request to handle
   * @param {Object} subRoom - The room instance
   * @description Attempts to match the request to a registered @Request handler
   * @returns {Promise<Response | null>} The response or null if no handler matched
   */
  private async tryMatchRequestHandler(req: Party.Request, subRoom: any): Promise<Response | null> {
    const requestHandlers = subRoom.constructor["_requestMetadata"];
    if (!requestHandlers) {
      return null;
    }

    const url = new URL(req.url);
    const method = req.method;
    let pathname = url.pathname;

    pathname = '/' + pathname.split('/').slice(4).join('/');

    // Check each registered handler
    for (const [routeKey, handler] of requestHandlers.entries()) {
      const firstColonIndex = routeKey.indexOf(':');
      const handlerMethod = routeKey.substring(0, firstColonIndex);
      const handlerPath = routeKey.substring(firstColonIndex + 1);

      // Check if method matches
      if (handlerMethod !== method) {
        continue;
      }

      // Simple path matching (could be enhanced with path params)
      if (this.pathMatches(pathname, handlerPath)) {
        // Extract path params if any
        const params = this.extractPathParams(pathname, handlerPath);  
        // Check request guards if they exist
        const guards = subRoom.constructor['_actionGuards']?.get(handler.key) || [];
        for (const guard of guards) {
          const isAuthorized = await guard(null, req, this.room);
          if (isAuthorized instanceof Response) {
            return isAuthorized;
          }
          if (!isAuthorized) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
          }
        }

        // Validate request body if needed
        let bodyData = null;
        if (handler.bodyValidation && ['POST', 'PUT', 'PATCH'].includes(method)) {
          try {
            const contentType = req.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const body = await req.json();
              const validation = handler.bodyValidation.safeParse(body);
              if (!validation.success) {
                return new Response(
                  JSON.stringify({ error: "Invalid request body", details: validation.error }), 
                  { status: 400 }
                );
              }
              bodyData = validation.data;
            }
          } catch (error) {
            return new Response(
              JSON.stringify({ error: "Failed to parse request body" }), 
              { status: 400 }
            );
          }
        }

        // Execute the handler method
        try {
          const result = await awaitReturn(
            subRoom[handler.key](req, bodyData, params, this.room)
          );

          if (result instanceof Response) {
            return result;
          }

          return new Response(
            typeof result === 'string' ? result : JSON.stringify(result),
            { 
              status: 200,
              headers: { 'Content-Type': typeof result === 'string' ? 'text/plain' : 'application/json' }
            }
          );
        } catch (error) {
          console.error('Error executing request handler:', error);
          return new Response(
            JSON.stringify({ error: "Internal server error" }), 
            { status: 500 }
          );
        }
      }
    }

    return null;
  }

  /**
   * @method pathMatches
   * @private
   * @param {string} requestPath - The path from the request
   * @param {string} handlerPath - The path pattern from the handler
   * @description Checks if a request path matches a handler path pattern
   * @returns {boolean} True if the paths match
   */
  private pathMatches(requestPath: string, handlerPath: string): boolean {
    // Convert handler path pattern to regex
    // Replace :param with named capture groups
    const pathRegexString = handlerPath
      .replace(/\//g, '\\/') // Escape slashes
      .replace(/:([^\/]+)/g, '([^/]+)'); // Convert :params to capture groups

    const pathRegex = new RegExp(`^${pathRegexString}$`);
    return pathRegex.test(requestPath);
  }

  /**
   * @method extractPathParams
   * @private
   * @param {string} requestPath - The path from the request
   * @param {string} handlerPath - The path pattern from the handler
   * @description Extracts path parameters from the request path based on the handler pattern
   * @returns {Object} An object containing the path parameters
   */
  private extractPathParams(requestPath: string, handlerPath: string): Record<string, string> {
    const params: Record<string, string> = {};
    
    // Extract parameter names from handler path
    const paramNames: string[] = [];
    handlerPath.split('/').forEach(segment => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.substring(1));
      }
    });
    
    // Extract parameter values from request path
    const pathRegexString = handlerPath
      .replace(/\//g, '\\/') // Escape slashes
      .replace(/:([^\/]+)/g, '([^/]+)'); // Convert :params to capture groups
      
    const pathRegex = new RegExp(`^${pathRegexString}$`);
    const matches = requestPath.match(pathRegex);
    
    if (matches && matches.length > 1) {
      // Skip the first match (the full string)
      for (let i = 0; i < paramNames.length; i++) {
        params[paramNames[i]] = matches[i + 1];
      }
    }
    
    return params;
  }
  
  /**
   * @method handleShardRequest
   * @private
   * @async
   * @param {Party.Request} req - The HTTP request forwarded by a shard
   * @param {string | null} shardId - The ID of the shard that forwarded the request
   * @description Processes requests forwarded by shards, preserving client context
   * @returns {Promise<Response>} The response to return to the shard (which will forward it to the client)
   */
  private async handleShardRequest(req: Party.Request, shardId: string | null): Promise<Response> {
    const subRoom = await this.getSubRoom();
    
    if (!subRoom) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }
    
    // Create a context that preserves original client information
    const originalClientIp = req.headers.get('x-original-client-ip');
    const enhancedReq = this.createEnhancedRequest(req, originalClientIp);
    
    try {
      // First try to match using the registered @Request handlers
      const response = await this.tryMatchRequestHandler(enhancedReq, subRoom);
      if (response) {
        return response;
      }
      
      // Fall back to the legacy onRequest handler
      const legacyResponse = await awaitReturn(subRoom["onRequest"]?.(enhancedReq, this.room));
      
      if (!legacyResponse) {
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }
      
      if (legacyResponse instanceof Response) {
        return legacyResponse;
      }
      
      return new Response(JSON.stringify(legacyResponse), { status: 200 });
    } catch (error) {
      console.error(`Error processing request from shard ${shardId}:`, error);
      return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }
  }
  
  /**
   * @method createEnhancedRequest
   * @private
   * @param {Party.Request} originalReq - The original request received from the shard
   * @param {string | null} originalClientIp - The original client IP, if available
   * @description Creates an enhanced request object that preserves the original client context
   * @returns {Party.Request} The enhanced request object
   */
  private createEnhancedRequest(originalReq: Party.Request, originalClientIp: string | null): Party.Request {
    // Clone the original request to avoid mutating it
    const clonedReq = originalReq.clone();
    
    // Add a custom property to the request to indicate it came via a shard
    (clonedReq as any).viaShard = true;
    
    // If we have the original client IP, we can use it for things like rate limiting or geolocation
    if (originalClientIp) {
      (clonedReq as any).originalClientIp = originalClientIp;
    }
    
    return clonedReq;
  }
}
