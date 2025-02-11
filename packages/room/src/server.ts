import { dset } from "dset";
import z from "zod";
import {
  createStatesSnapshot,
  getByPath,
  load,
  syncClass,
} from "../../sync/src";
import { generateShortUUID } from "../../sync/src/utils";
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
  private timeoutHandles: Map<string, any> = new Map();

  static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    request.headers.set("X-User-ID", token);
    return request;
  }

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

  /**
   * @method createRoom
   * @private
   * @async
   * @param {CreateRoomOptions} [options={}] - Options for creating the room.
   * @returns {Promise<Object>} The created room instance.
   * @throws {Error} If no matching room is found.
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

    // Find the appropriate room based on the current room ID
    for (let room of this.rooms) {
      const params = extractParams(room.path, this.room.id);
      if (params) {
        instance = new room(this.room, params);
        break;
      }
    }

    if (!instance) {
      throw new Error("Room not found");
    }

    // Load the room's memory from storage
    // This ensures persistence across server restarts
    const loadMemory = async () => {
      const root = await this.room.storage.get(".");
      const memory = await this.room.storage.list();
      const tmpObject: any = root || {};
      for (let [key, value] of memory) {
        if (key == ".") {
          continue;
        }
        dset(tmpObject, key, value);
      }
      load(instance, tmpObject);
    };

    await loadMemory();

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
    const persistCb = async (values) => {
      for (let path of values) {
        const _instance =
          path == "." ? instance : getByPath(instance, path);
        const itemValue = createStatesSnapshot(_instance);
        await this.room.storage.put(path, itemValue);
      }
      values.clear();
    }

    // Set up syncing and persistence with throttling to optimize performance
    syncClass(instance, {
      onSync: throttle(syncCb, instance["throttleSync"] ?? 500),
      onPersist: throttle(persistCb, instance["throttleStorage"] ?? 2000),
    });

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
  private async getSubRoom(options = {}) {
    let subRoom
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

  private async getSession(privateId: string): Promise<{publicId: string, state?: any} | null> {
    if (!privateId) return null;
    try {
      const session = await this.room.storage.get(`session:${privateId}`);
      return session as {publicId: string, state?: any} | null;
    } catch (e) {
      return null;
    }
  }

  private async saveSession(privateId: string, data: {publicId: string, state?: any}) {
    await this.room.storage.put(`session:${privateId}`, data);
  }

  private async deleteSession(privateId: string) {
    await this.room.storage.delete(`session:${privateId}`);
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
    const subRoom = await this.getSubRoom({
      getMemoryAll: true,
    })

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
    const providedPrivateId = ctx.request?.headers.get("X-User-ID");
    const existingSession = providedPrivateId ? await this.getSession(providedPrivateId) : null;

    // Generate IDs
    const publicId = existingSession?.publicId || generateShortUUID();
    const privateId = existingSession ? providedPrivateId : generateShortUUID();

    let user = null;
    const signal = this.getUsersProperty(subRoom);
    
    if (signal) {
      const { classType } = signal.options;
      user = isClass(classType) ? new classType() : classType(conn, ctx);
      
      // Restore state if exists
      if (existingSession?.state) {
        Object.assign(user, existingSession.state);
      }
      
      signal()[publicId] = user;
      
      // Only store new session if it doesn't exist
      if (!existingSession) {
        await this.saveSession(privateId, {
          publicId
        });
      }
    }

    // Call the room's onJoin method if it exists
    await awaitReturn(subRoom["onJoin"]?.(user, conn, ctx));
    
    // Store both IDs in connection state
    conn.setState({ publicId, privateId });

    // Send initial sync data with both IDs to the new connection
    conn.send(
      JSON.stringify({
        type: "sync",
        value: {
          pId: publicId,
          privateId,
          ...subRoom.$memoryAll,
        },
      })
    );
  }

  /**
   * @method onMessage
   * @async
   * @param {string} message - The message received from a user.
   * @param {Party.Connection} sender - The connection object of the sender.
   * @description Processes incoming messages and triggers corresponding actions in the sub-room.
   * @returns {Promise<void>}
   * 
   * @example
   * ```typescript
   * server.onMessage = async (message, sender) => {
   *   await server.onMessage(message, sender);
   *   console.log("Message processed from:", sender.id);
   * };
   * ```
   */

  async onMessage(message: string, sender: Party.Connection) {
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
      const isAuthorized = await guard(sender, result.data.value);
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
        const guards = subRoom.$actionGuards?.get(actionName.key) || [];
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
    const signal = this.getUsersProperty(subRoom);
    if (!conn.state) {
      return;
    }
    const { publicId, privateId } = conn.state as any;
    const user = signal?.()[publicId];
    
    if (!user) return;

    // Save current state
    if (privateId) {
      await this.saveSession(privateId, {
        publicId,
        state: { ...user }
      });
    }

    // Clear any existing timeout for this user
    const existingTimeout = this.timeoutHandles.get(privateId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.timeoutHandles.delete(privateId);
    }

    const cleanup = async () => {
      // Call onLeave hook
      await awaitReturn(subRoom["onLeave"]?.(user, conn));
      
      // Remove user from signal
      if (signal) {
        delete signal()[publicId];
      }
      
      // Delete session
      if (privateId) {
        await this.deleteSession(privateId);
      }

      // Broadcast user disconnection
      this.room.broadcast(
        JSON.stringify({
          type: "user_disconnected",
          value: { publicId }
        })
      );

      // Clear timeout handle
      this.timeoutHandles.delete(privateId);
    };

    const disconnectTimeout = subRoom.constructor.disconnectTimeout ?? 0;
    
    if (disconnectTimeout > 0) {
      // Set temporary offline status
      if (user.status) {
        user.status.set('offline');
      }

      // Broadcast temporary disconnection
      this.room.broadcast(
        JSON.stringify({
          type: "user_offline",
          value: { publicId }
        })
      );

      // Set cleanup timeout
      const timeout = setTimeout(cleanup, disconnectTimeout);
      this.timeoutHandles.set(privateId, timeout);
    } else {
      // Immediate cleanup if no timeout
      await cleanup();
    }
  }
}
