import { dset } from "dset";
import z from "zod";
import {
  createStatesSnapshot,
  getByPath,
  load,
  syncClass,
  DELETE_TOKEN,
  generateShortUUID,
  createStatesSnapshotDeep
} from "@signe/sync";
import type * as Party from "./types/party";
import {
  awaitReturn,
  buildObject,
  extractParams,
  isClass,
  throttle,
} from "./utils";
import { ServerResponse } from "./request/response";
import { createCorsInterceptor } from "./request/cors";
import { Signal, WritableSignal } from "@signe/reactive";

const Message = z.object({
  action: z.string(),
  value: z.any(),
});

type CreateRoomOptions = {
  getMemoryAll?: boolean;
  sessionExpiryTime?: number;
  throttleSync?: number;
  throttleStorage?: number;
};

type SessionData = {
  publicId: string;
  state?: any;
  created?: number;
  connected?: boolean;
  disconnectedAt?: number;
};

const STATE_PREFIX = "state:";
const SESSION_PREFIX = "session:";
const SESSION_PUBLIC_PREFIX = "session-public:";
const TRANSFER_PREFIX = "transfer:";
const INTERNAL_PREFIX = "$room:";
const SESSION_GC_LAST_RUN_KEY = `${INTERNAL_PREFIX}session-gc:last-run`;

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
  constructor(readonly room: Party.Room) { }

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

  private stateKey(path: string) {
    return `${STATE_PREFIX}${path}`;
  }

  private sessionKey(privateId: string) {
    return `${SESSION_PREFIX}${privateId}`;
  }

  private sessionPublicKey(publicId: string) {
    return `${SESSION_PUBLIC_PREFIX}${publicId}`;
  }

  private transferKey(token: string) {
    return `${TRANSFER_PREFIX}${token}`;
  }

  private isInternalStorageKey(key: string) {
    return key.startsWith(STATE_PREFIX)
      || key.startsWith(SESSION_PREFIX)
      || key.startsWith(SESSION_PUBLIC_PREFIX)
      || key.startsWith(TRANSFER_PREFIX)
      || key.startsWith(INTERNAL_PREFIX);
  }

  private async listStorage<T = unknown>(prefix?: string) {
    if (!prefix) {
      return this.room.storage.list<T>();
    }
    return this.room.storage.list<T>({ prefix });
  }

  private async loadStatePath<T = unknown>(path: string) {
    return this.room.storage.get<T>(this.stateKey(path));
  }

  private async saveStatePath(path: string, value: any) {
    await this.room.storage.put(this.stateKey(path), value);
  }

  private async deleteStatePath(path: string) {
    await Promise.all([
      this.room.storage.delete(this.stateKey(path)),
      this.room.storage.delete(path),
    ]);
  }

  private getPrivateId(conn: Party.Connection) {
    return (conn.state as any)?.privateId || conn.sessionId || conn.id;
  }

  private hasActiveSessionConnection(privateId: string) {
    return Array.from(this.room.getConnections())
      .some((conn) => this.getPrivateId(conn) === privateId);
  }

  async send(conn: Party.Connection, obj: any, subRoom: any) {
    obj = structuredClone(obj);
    if (subRoom.interceptorPacket) {
      const signal = this.getUsersProperty(subRoom);
      const { publicId } = conn.state as any;
      const user = signal?.()[publicId];
      obj = await awaitReturn(subRoom["interceptorPacket"]?.(user, obj, conn));
      if (obj === null) return;
    }
    conn.send(JSON.stringify(obj));
  }

  broadcast(obj: any, subRoom: any) {
    for (let conn of this.room.getConnections()) {
      this.send(conn, obj, subRoom);
    }
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

  async runGarbageCollector() {
    await this.garbageCollector({ sessionExpiryTime: -1 });
  }

  private async garbageCollector(options: { sessionExpiryTime: number }) {
    const subRoom = await this.getSubRoom();
    if (!subRoom) return;

    const SESSION_EXPIRY_TIME = Number(options.sessionExpiryTime);
    if (!Number.isFinite(SESSION_EXPIRY_TIME)) {
      return;
    }

    // Get active connections
    const activeConnections = [...this.room.getConnections()];
    const activePrivateIds = new Set(activeConnections.map(conn => this.getPrivateId(conn)));

    try {
      // Get all sessions from storage
      const sessions = await this.listStorage<SessionData>(SESSION_PREFIX);
      const users = this.getUsersProperty(subRoom);
      const usersPropName = this.getUsersPropName(subRoom);

      // Store valid publicIds from sessions
      const validPublicIds = new Set<string>();
      const expiredPublicIds = new Set<string>();
      const now = Date.now();

      for (const [key, session] of sessions) {
        // Only process session entries
        if (!key.startsWith(SESSION_PREFIX)) continue;

        const privateId = key.slice(SESSION_PREFIX.length);
        const typedSession = session as SessionData;

        // Check if session should be deleted based on:
        // 1. Connection is not active
        // 2. Session is marked as disconnected
        // 3. Session is older than expiry time
        if (!activePrivateIds.has(privateId) &&
          !typedSession.connected &&
          typedSession.disconnectedAt !== undefined &&
          (now - typedSession.disconnectedAt) >= SESSION_EXPIRY_TIME) {
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
          }
        }
      }

    } catch (error) {
      console.error('Error in garbage collector:', error);
    }
  }

  private scheduleSessionGarbageCollector(sessionExpiryTime: number | undefined, privateId?: string) {
    const normalizedSessionExpiryTime = Number(sessionExpiryTime);
    if (!Number.isFinite(normalizedSessionExpiryTime) || normalizedSessionExpiryTime < 0) {
      return;
    }

    setTimeout(() => {
      if (privateId) {
        void this.expireDisconnectedSession(privateId, normalizedSessionExpiryTime);
        return;
      }
      void this.garbageCollector({ sessionExpiryTime: normalizedSessionExpiryTime });
    }, normalizedSessionExpiryTime);
  }

  private getSessionExpiryTime(subRoom: any) {
    return subRoom?.sessionExpiryTime
      ?? subRoom?.constructor?.prototype?.sessionExpiryTime
      ?? subRoom?.constructor?.sessionExpiryTime;
  }

  private async shouldRunSessionGarbageCollector(sessionExpiryTime: number | undefined) {
    const normalizedSessionExpiryTime = Number(sessionExpiryTime);
    if (!Number.isFinite(normalizedSessionExpiryTime) || normalizedSessionExpiryTime < 0) {
      return false;
    }

    const now = Date.now();
    const lastRun = await this.room.storage.get<number>(SESSION_GC_LAST_RUN_KEY);
    if (lastRun && now - lastRun < normalizedSessionExpiryTime) {
      return false;
    }

    await this.room.storage.put(SESSION_GC_LAST_RUN_KEY, now);
    return true;
  }

  private async expireDisconnectedSession(privateId: string, sessionExpiryTime: number) {
    const session = await this.getSession(privateId);
    if (!session || session.connected || session.disconnectedAt === undefined) {
      return;
    }

    if (this.hasActiveSessionConnection(privateId)) {
      return;
    }

    const elapsed = Date.now() - session.disconnectedAt;
    if (elapsed < sessionExpiryTime) {
      setTimeout(() => {
        void this.expireDisconnectedSession(privateId, sessionExpiryTime);
      }, sessionExpiryTime - elapsed);
      return;
    }

    await this.deleteSession(privateId);

    const privateIds = await this.getSessionPrivateIds(session.publicId);
    for (const otherPrivateId of privateIds) {
      const otherSession = await this.getSession(otherPrivateId);
      if (otherSession?.publicId === session.publicId) {
        return;
      }
    }

    const subRoom = await this.getSubRoom();
    const users = this.getUsersProperty(subRoom);
    if (users?.()[session.publicId]) {
      delete users()[session.publicId];
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
      const root = await this.loadStatePath(".");
      const memory = await this.listStorage(STATE_PREFIX);
      const tmpObject: any = root || {};
      for (let [storageKey, value] of memory) {
        const key = storageKey.slice(STATE_PREFIX.length);
        if (key === ".") {
          continue;
        }
        dset(tmpObject, key, value);
      }

      if (root === undefined && memory.size === 0) {
        const legacyRoot = await this.room.storage.get(".");
        const legacyMemory = await this.room.storage.list();
        const legacyObject: any = legacyRoot || {};
        const migratedEntries: Array<[string, any]> = [];

        if (legacyRoot !== undefined) {
          migratedEntries.push([".", legacyRoot]);
        }

        for (let [key, value] of legacyMemory) {
          if (key === "." || this.isInternalStorageKey(key)) {
            continue;
          }
          dset(legacyObject, key, value);
          migratedEntries.push([key, value]);
        }

        await Promise.all(
          migratedEntries.map(([path, value]) => this.saveStatePath(path, value))
        );
        load(instance, legacyObject, true);
        return;
      }

      load(instance, tmpObject, true);
    };

    instance.$memoryAll = {}
    instance.$autoSync = instance["autoSync"] !== false; // Default to true
    instance.$pendingSync = new Map<string, any>();
    instance.$pendingInitialSync = new Map<Party.Connection, string>(); // Store connections waiting for initial sync with their publicId
    instance.$send = (conn: Party.Connection, obj: any) => {
      return this.send(conn, obj, instance)
    }
    instance.$broadcast = (obj: any) => {
      return this.broadcast(obj, instance)
    }
    /**
     * Applies pending synchronization changes by broadcasting them to all clients.
     * This method is useful when autoSync is disabled and you want to manually trigger synchronization.
     * 
     * @method $applySync
     * @description Broadcasts all pending synchronization changes and clears the pending queue.
     * If there are pending changes, they are merged with $memoryAll and broadcast. If there are no
     * pending changes, it broadcasts the current state from $memoryAll (useful for forcing a full sync).
     * Also sends initial sync to connections that were waiting for it (with their pId).
     * 
     * @example
     * ```typescript
     * // Disable auto sync
     * instance.$autoSync = false;
     * 
     * // Make some changes
     * instance.count.set(10);
     * instance.text.set('hello');
     * 
     * // Manually apply sync when ready
     * instance.$applySync();
     * ```
     */
    instance.$applySync = () => {
      let packet: any;
      if (instance.$pendingSync.size > 0) {
        if (options.getMemoryAll) {
          buildObject(instance.$pendingSync, instance.$memoryAll);
        }
        packet = buildObject(instance.$pendingSync, instance.$memoryAll);
        instance.$pendingSync.clear();
      } else {
        // No pending changes, broadcast current state from memory
        packet = instance.$memoryAll;
      }
      
      // Send initial sync to connections that were waiting for it (with their pId)
      const pendingConnections = new Set(instance.$pendingInitialSync.keys());
      for (const [conn, publicId] of instance.$pendingInitialSync) {
        this.send(conn, {
          type: "sync",
          value: {
            pId: publicId,
            ...packet,
          },
        }, instance);
      }
      instance.$pendingInitialSync.clear();
      
      // Broadcast to all other connections (excluding those that just received initial sync)
      for (const conn of this.room.getConnections()) {
        if (!pendingConnections.has(conn)) {
          this.send(conn, {
            type: "sync",
            value: packet,
          }, instance);
        }
      }
    }
    instance.$sessionTransfer = async (conn: Party.Connection, targetRoomId: string) => {
      let user: any;
      
      const signal = this.getUsersProperty(instance);
      
      if (!signal) {
        console.error('[sessionTransfer] `users` property not defined in the room.');
        return null;
      }
      
      const { publicId } = conn.state as any;
      user = signal()[publicId];

      if (!user) {
        console.error(`[sessionTransfer] User with publicId ${publicId} not found.`);
        return null;
      }

      const sessionEntry = await this.getSessionEntryByPublicId(publicId);
      const userSession = sessionEntry?.session;
      const privateId = sessionEntry?.privateId ?? null;

      if (!userSession || !privateId) {
        console.error(`[sessionTransfer] Session for publicId ${publicId} not found.`);
        return null;
      }

      const usersPropName = this.getUsersPropName(instance);
      if (!usersPropName) {
        console.error('[sessionTransfer] `users` property not defined in the room.');
        return null;
      }

      // Create a snapshot of the user state
      const userSnapshot = createStatesSnapshotDeep(user);

      const transferData = {
        privateId,
        userSnapshot,
        sessionState: userSession.state,
        publicId
      };

      try {
        const targetRoomParty = await this.room.context.parties.main.get(targetRoomId);
        const response = await targetRoomParty.fetch('/session-transfer', {
          method: 'POST',
          body: JSON.stringify(transferData),
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Transfer request failed: ${await response.text()}`);
        }

        const { transferToken } = await response.json();
   
        return transferToken;
      } catch (error) {
        console.error(`[sessionTransfer] Failed to transfer session to room ${targetRoomId}:`, error);
        return null;
      }
    };

    // Sync callback: Broadcast changes to all clients or store them for manual sync
    const syncCb = (values) => {
      if (options.getMemoryAll) {
        buildObject(values, instance.$memoryAll);
      }
      // During initialization in hibernate mode, skip entirely
      if (init && this.isHibernate) {
        init = false;
        return;
      }
      
      // If autoSync is disabled, store changes in pendingSync instead of broadcasting
      if (!instance.$autoSync) {
        // Merge pending changes into $pendingSync
        for (const [path, value] of values) {
          instance.$pendingSync.set(path, value);
        }
        values.clear();
        return;
      }
      
      // Auto sync: broadcast immediately (even during init if autoSync is enabled)
      const packet = buildObject(values, instance.$memoryAll);
      this.broadcast(
        {
          type: "sync",
          value: packet,
        },
        instance
      );
      values.clear();
    }

    // Persist callback: Save changes to storage
    const persistCb = async (values: Map<string, any>) => {
      if (initPersist) {
        values.clear();
        return;
      }
      const writes: Promise<unknown>[] = [];
      for (let [path, value] of values) {
        const _instance =
          path == "." ? instance : getByPath(instance, path);
        const itemValue = createStatesSnapshot(_instance);
        if (value == DELETE_TOKEN) {
          writes.push(this.deleteStatePath(path));
        } else {
          writes.push(this.saveStatePath(path, itemValue));
        }
      }
      await Promise.all(writes);
      values.clear();
    }

    const debouncePersist = (wait: number) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let flushing = false;
      const pending = new Map<string, any>();

      const schedule = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
          void flush();
        }, wait);
      };

      const flush = async () => {
        timeout = null;
        if (flushing) {
          schedule();
          return;
        }

        const values = new Map(pending);
        pending.clear();
        if (!values.size) {
          return;
        }

        flushing = true;
        try {
          await persistCb(values);
        } finally {
          flushing = false;
          if (pending.size) {
            schedule();
          }
        }
      };

      return (values: Map<string, any>) => {
        if (initPersist) {
          values.clear();
          return;
        }

        for (const [path, value] of values) {
          pending.set(path, value);
        }
        values.clear();
        schedule();
      };
    };

    // Set up syncing and persistence with throttling to optimize performance
    syncClass(instance, {
      onSync: instance["throttleSync"] ? throttle(syncCb, instance["throttleSync"]) : syncCb,
      onPersist: instance["throttleStorage"] ? debouncePersist(instance["throttleStorage"]) : persistCb,
    });

    await loadMemory();

    initPersist = false
    init = false; // Allow syncs after initialization is complete

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
    if (!subRoom) return null;
    const metadata = subRoom.constructor._propertyMetadata;
    if (!metadata) return null;
    return metadata.get("users");
  }

  /**
   * Retrieves the connection status property from a user object.
   * 
   * @param {any} user - The user object to get the connection property from.
   * @returns {Function|null} - The connection property signal function or null if not found.
   * @private
   */
  private getUserConnectionProperty(user: any): WritableSignal<boolean> | null {
    if (!user) return null;
    
    const metadata = user.constructor._propertyMetadata;
    if (!metadata) return null;
    
    const connectedPropName = metadata.get("connected");
    if (!connectedPropName) return null;

    return user[connectedPropName];
  }
  
  /**
   * Updates a user's connection status in the signal.
   * 
   * @param {any} user - The user object to update.
   * @param {boolean} isConnected - The new connection status.
   * @returns {boolean} - Whether the update was successful.
   * @private
   */
  private updateUserConnectionStatus(user: any, isConnected: boolean): boolean {
    const connectionSignal = this.getUserConnectionProperty(user);

    if (connectionSignal) {
      connectionSignal.set(isConnected);
      return true;
    }
    
    return false;
  }

  /**
   * @method getSession
   * @private
   * @param {string} privateId - The private ID of the session.
   * @returns {Promise<Object|null>} The session object, or null if not found.
   * 
   * @example
   * ```typescript
   * const session = await server.getSession("privateId");
   * console.log(session);
   * ```
   */
  async getSession(privateId: string): Promise<SessionData | null> {
    if (!privateId) return null;
    try {
      const session = await this.room.storage.get(this.sessionKey(privateId));
      return session as SessionData | null;
    } catch (e) {
      return null;
    }
  }

  private async getSessionPrivateIds(publicId: string): Promise<string[]> {
    if (!publicId) return [];
    const privateIds = await this.room.storage.get<string[]>(this.sessionPublicKey(publicId));
    return Array.isArray(privateIds) ? privateIds : [];
  }

  private async saveSessionPrivateIds(publicId: string, privateIds: string[]) {
    const key = this.sessionPublicKey(publicId);
    if (privateIds.length === 0) {
      await this.room.storage.delete(key);
      return;
    }
    await this.room.storage.put(key, privateIds);
  }

  private async addSessionToPublicIndex(privateId: string, publicId: string) {
    const privateIds = await this.getSessionPrivateIds(publicId);
    if (privateIds.includes(privateId)) {
      return;
    }
    await this.saveSessionPrivateIds(publicId, [...privateIds, privateId]);
  }

  private async removeSessionFromPublicIndex(privateId: string, publicId: string) {
    const privateIds = await this.getSessionPrivateIds(publicId);
    await this.saveSessionPrivateIds(
      publicId,
      privateIds.filter((id) => id !== privateId)
    );
  }

  private async getSessionEntryByPublicId(publicId: string): Promise<{ privateId: string; session: SessionData } | null> {
    const indexedPrivateIds = await this.getSessionPrivateIds(publicId);
    const stalePrivateIds: string[] = [];

    for (const privateId of indexedPrivateIds) {
      const session = await this.getSession(privateId);
      if (session?.publicId === publicId) {
        return { privateId, session };
      }
      stalePrivateIds.push(privateId);
    }

    if (stalePrivateIds.length) {
      await this.saveSessionPrivateIds(
        publicId,
        indexedPrivateIds.filter((id) => !stalePrivateIds.includes(id))
      );
    }

    const sessions = await this.listStorage<SessionData>(SESSION_PREFIX);
    for (const [key, session] of sessions) {
      const privateId = key.slice(SESSION_PREFIX.length);
      if (session?.publicId) {
        await this.addSessionToPublicIndex(privateId, session.publicId);
      }
      if (session?.publicId === publicId) {
        return { privateId, session };
      }
    }

    return null;
  }

  private async saveSession(privateId: string, data: SessionData) {
    const existingSession = await this.getSession(privateId);
    const sessionData = {
      ...data,
      created: data.created || Date.now(),
      connected: data.connected !== undefined ? data.connected : true
    };
    await this.room.storage.put(this.sessionKey(privateId), sessionData);
    if (existingSession?.publicId && existingSession.publicId !== sessionData.publicId) {
      await this.removeSessionFromPublicIndex(privateId, existingSession.publicId);
    }
    await this.addSessionToPublicIndex(privateId, sessionData.publicId);
  }

  private async updateSessionConnection(privateId: string, connected: boolean) {
    const session = await this.getSession(privateId);
    if (session) {
      const nextSession = { ...session, connected };
      if (connected) {
        delete nextSession.disconnectedAt;
      } else {
        nextSession.disconnectedAt = Date.now();
      }
      if (!await this.getSession(privateId)) {
        return;
      }
      await this.saveSession(privateId, nextSession);
    }
  }

  /**
   * @method deleteSession
   * @private
   * @param {string} privateId - The private ID of the session to delete.
   * @returns {Promise<void>}
   * 
   * @example
   * ```typescript
   * await server.deleteSession("privateId");
   * ```
   */
  async deleteSession(privateId: string) {
    const session = await this.getSession(privateId);
    await this.room.storage.delete(this.sessionKey(privateId));
    if (session?.publicId) {
      await this.removeSessionFromPublicIndex(privateId, session.publicId);
    }
  }

  async onConnectClient(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const subRoom = await this.getSubRoom({
      getMemoryAll: true,
    })

    if (!subRoom) {
      conn.close();
      return;
    }

    const sessionExpiryTime = this.getSessionExpiryTime(subRoom);
    if (await this.shouldRunSessionGarbageCollector(sessionExpiryTime)) {
      await this.garbageCollector({ sessionExpiryTime });
    }

    // Check room guards
    const roomGuards = subRoom.constructor['_roomGuards'] || [];
    for (const guard of roomGuards) {
      const isAuthorized = await guard(conn, ctx, this.room);
      if (!isAuthorized) {
        conn.close();
        return;
      }
    }

    // Handle session transfer
    let transferToken = null;
    if (ctx.request?.url) {
      const url = new URL(ctx.request.url);
      transferToken = url.searchParams.get('transferToken');
    }
    let transferData: any = null;
    if (transferToken) {
      transferData = await this.room.storage.get(this.transferKey(transferToken));
      if (transferData) {
        await this.room.storage.delete(this.transferKey(transferToken));
      }
    }

    // Check for existing session
    const requestedPrivateId = this.getPrivateId(conn);
    const privateId = transferData?.privateId || requestedPrivateId;
    const existingSession = await this.getSession(privateId)

    // Generate IDs
    const publicId = existingSession?.publicId || transferData?.publicId || generateShortUUID();

    let user = null;
    const signal = this.getUsersProperty(subRoom);
    const usersPropName = this.getUsersPropName(subRoom);

    if (signal) {
      const { classType } = signal.options;

      // Restore state if exists
      if (!existingSession?.publicId) {
        // Check if we have a transferred user already restored
        if (transferData?.restored && signal()[publicId]) {
          user = signal()[publicId];
        } else {
          user = isClass(classType) ? new classType() : classType(conn, ctx);
          signal()[publicId] = user;
          const snapshot = createStatesSnapshotDeep(user);
          await this.saveStatePath(`${usersPropName}.${publicId}`, snapshot);
        }
      }
      else {
        user = signal()[existingSession.publicId];
      }

      // Only store new session if it doesn't exist
      if (!existingSession) {
        // Use the transferred privateId if available, otherwise use connection id
        await this.saveSession(privateId, {
          publicId
        });
      }
      else {
        await this.updateSessionConnection(privateId, true);
      }
    }
    // Update user connection status if applicable
    this.updateUserConnectionStatus(user, true);

     // Store both IDs in connection state
     conn.setState({
      ...conn.state,
      publicId,
      privateId
    });

    // Call the room's onJoin method if it exists
    await awaitReturn(subRoom["onJoin"]?.(user, conn, ctx));

    // Send initial sync data with both IDs to the new connection
    if (subRoom.$autoSync) {
      // Auto sync enabled: send immediately
      this.send(conn, {
        type: "sync",
        value: {
          pId: publicId,
          ...subRoom.$memoryAll,
        },
      }, subRoom);
    } else {
      // Auto sync disabled: store connection to receive sync on next $applySync()
      subRoom.$pendingInitialSync.set(conn, publicId);
    }
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

    if (!subRoom) {
      console.warn("Room not found");
      return;
    }

    // Check room guards
    const roomGuards = subRoom.constructor['_roomGuards'] || [];
    for (const guard of roomGuards) {
      const isAuthorized = await guard(sender, result.data.value, this.room);
      if (!isAuthorized) {
        return;
      }
    }

    const actions = subRoom.constructor["_actionMetadata"];
    const signal = this.getUsersProperty(subRoom);
    const { publicId } = sender.state as any;
    const user = signal?.()[publicId];
    const actionName = actions?.get(result.data.action);
    if (actionName) {

      // Check all guards if they exist
      const guards = subRoom.constructor['_actionGuards']?.get(actionName.key) || [];
      for (const guard of guards) {
        const isAuthorized = await guard(sender, result.data.value, this.room);
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
      return;
    }

    const unhandledAction = subRoom.constructor["_unhandledActionMetadata"];
    if (unhandledAction) {
      const guards = subRoom.constructor['_actionGuards']?.get(unhandledAction.key) || [];
      for (const guard of guards) {
        const isAuthorized = await guard(sender, result.data, this.room);
        if (!isAuthorized) {
          return;
        }
      }

      await awaitReturn(
        subRoom[unhandledAction.key](user, result.data, sender)
      );
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
    const { privateId, requestInfo } = message;
    const shardState = shardConnection.state as any;

    // Create a virtual connection context for the client
    const virtualContext: Party.ConnectionContext = {
      request: requestInfo ? {
        headers: new Headers(requestInfo.headers),
        method: requestInfo.method,
        url: requestInfo.url
      } as unknown as Party.Request : undefined
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
      send: () => { }, // No-op since client is disconnecting
      state: clientState,
      setState: () => {
        // No-op since client is disconnecting
        return {} as any;
      },
      close: () => { }
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
   * @description Handles user disconnection, removing them from the room and triggering the onLeave event..
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

    // Clean up pending initial sync for this connection
    if (subRoom.$pendingInitialSync) {
      subRoom.$pendingInitialSync.delete(conn);
    }

    const signal = this.getUsersProperty(subRoom);

    if (!conn.state) {
      return;
    }

    const privateId = this.getPrivateId(conn);
    const { publicId } = conn.state as any;
    const user = signal?.()[publicId];

    if (!user) return;

    if (this.hasActiveSessionConnection(privateId)) {
      return;
    }

    // Mark session as disconnected instead of deleting it
    await this.updateSessionConnection(privateId, false);
    this.scheduleSessionGarbageCollector(this.getSessionExpiryTime(subRoom), privateId);

    // Update user connection status in the signal
    const connectionUpdated = this.updateUserConnectionStatus(user, false);

    await awaitReturn(subRoom["onLeave"]?.(user, conn));
    
    // Only broadcast disconnection if we couldn't update the connection signal
    if (!connectionUpdated) {
      // Broadcast user disconnection the old way
      this.broadcast({
        type: "user_disconnected",
        value: { publicId }
      }, subRoom);
    }
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
    
    // Create a response with proper CORS configuration
    const res = new ServerResponse([
      createCorsInterceptor()
    ]);

    if (req.method === 'OPTIONS') {
      // For OPTIONS requests, just return a 200 OK with CORS headers
      return res.status(200).send({});
    }

    if (isFromShard) {
      return this.handleShardRequest(req, res, shardId);
    }

    // Handle regular client request
    return this.handleDirectRequest(req, res);
  }


  /**
   * @method handleSessionRestore
   * @private
   * @async
   * @param {Party.Request} req - The HTTP request for session restore
   * @param {ServerResponse} res - The response object
   * @description Handles session restoration from transfer data, creates session from privateId
   * @returns {Promise<Response>} The response to return to the client
   */
  private async handleSessionRestore(req: Party.Request, res: ServerResponse): Promise<Response> {
    try {
      const transferData = await req.json() as {
        privateId: string;
        userSnapshot?: any;
        sessionState?: any;
        publicId: string;
      };
      const { privateId, userSnapshot, sessionState, publicId } = transferData;

      if (!privateId || !publicId) {
        return res.badRequest('Missing privateId or publicId in transfer data');
      }

      const subRoom = await this.getSubRoom();
      if (!subRoom) {
        return res.serverError('Room not available');
      }

      // Create session from privateId
      await this.saveSession(privateId, {
        publicId,
        state: sessionState,
        created: Date.now(),
        connected: false // Will be set to true when user connects
      });

      // If userSnapshot exists, restore user data
      if (userSnapshot) {
        const signal = this.getUsersProperty(subRoom);
        const usersPropName = this.getUsersPropName(subRoom);
        
        if (signal && usersPropName) {
          const { classType } = signal.options;
          
          // Create new user instance
          const user = isClass(classType) ? new classType() : classType();

          const hydratedSnapshot =
            (await awaitReturn(
              subRoom["onSessionRestore"]?.({
                userSnapshot,
                user,
                publicId,
                privateId,
                sessionState,
                room: this.room,
              })
            )) ?? userSnapshot;
          
          // Add user to signal before loading to avoid syncing non-serializable instances
          signal()[publicId] = user;

          // Load user data from snapshot
          load(user, hydratedSnapshot, true);
          
          // Save user snapshot to storage
          await this.saveStatePath(`${usersPropName}.${publicId}`, userSnapshot);
        }
      }

      // Generate transfer token for the client to use when connecting
      const transferToken = generateShortUUID();
      await this.room.storage.put(this.transferKey(transferToken), {
        privateId,
        publicId,
        restored: true
      });

      return res.success({ transferToken });
    } catch (error) {
      console.error('Error restoring session:', error);
      return res.serverError('Failed to restore session');
    }
  }

  /**
   * @method handleDirectRequest
   * @private
   * @async
   * @param {Party.Request} req - The HTTP request received directly from a client
   * @description Processes requests received directly from clients
   * @returns {Promise<Response>} The response to return to the client
   */
  private async handleDirectRequest(req: Party.Request, res: ServerResponse): Promise<Response> {
    const subRoom = await this.getSubRoom();

    if (!subRoom) {
      return res.notFound();
    }

    const url = new URL(req.url);
    if (url.pathname.endsWith('/session-transfer') && req.method === 'POST') {
      return this.handleSessionRestore(req, res);
    }

    // First try to match using the registered @Request handlers
    const response = await this.tryMatchRequestHandler(req, res, subRoom);
    if (response) {
      return response;
    }

    // Fall back to the legacy onRequest method if no handler matched
    const legacyResponse = await awaitReturn(subRoom["onRequest"]?.(req, res));
    if (!legacyResponse) {
      return res.notFound();
    }
    if (legacyResponse instanceof Response) {
      return legacyResponse;
    }
    return res.success(legacyResponse);
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
  private async tryMatchRequestHandler(req: Party.Request, res: ServerResponse, subRoom: any): Promise<Response | null> {
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
            return res.notPermitted();
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
                return res.badRequest("Invalid request body", {
                  details: validation.error
                });
              }
              bodyData = validation.data;
            }
          } catch (error) {
            return res.badRequest("Failed to parse request body");
          }
        }

        // Execute the handler method
        try {
          req['data'] = bodyData;
          req['params'] = params;
          const result = await awaitReturn(
            subRoom[handler.key](req, res)
          );

          if (result instanceof Response) {
            return result;
          }

          return res.success(result);
        } catch (error) {
          console.error('Error executing request handler:', error);
          return res.serverError();
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

    const pathRegex = new RegExp(`^${pathRegexString}`);
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

    const pathRegex = new RegExp(`^${pathRegexString}`);
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
  private async handleShardRequest(req: Party.Request, res: ServerResponse, shardId: string | null): Promise<Response> {
    const subRoom = await this.getSubRoom();

    if (!subRoom) {
      return res.notFound();
    }

    // Create a context that preserves original client information
    const originalClientIp = req.headers.get('x-original-client-ip');
    const enhancedReq = this.createEnhancedRequest(req, originalClientIp);
    
    try {
      // First try to match using the registered @Request handlers
      const response = await this.tryMatchRequestHandler(enhancedReq, res, subRoom);
      if (response) {
        return response;
      }

      // Fall back to the legacy onRequest handler
      const legacyResponse = await awaitReturn(subRoom["onRequest"]?.(enhancedReq, res));

      if (!legacyResponse) {
        return res.notFound();
      }

      if (legacyResponse instanceof Response) {
        return legacyResponse;
      }

      return res.success(legacyResponse);
    } catch (error) {
      console.error(`Error processing request from shard ${shardId}:`, error);
      return res.serverError();
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
