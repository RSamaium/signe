import type * as Party from "./types/party"
import type { z } from "zod"
type GuardFn = (sender: Party.Connection, value: any | Party.Request, room: Party.Room) => boolean | Promise<boolean | Response>;
type RoomGuardFn = (conn: Party.Connection, ctx: Party.ConnectionContext, room: Party.Room) => boolean | Promise<boolean | Response>;

export function Action(name: string, bodyValidation?: z.ZodSchema) {
  return function (target: any, propertyKey: string) {
    if (!target.constructor._actionMetadata) {
      target.constructor._actionMetadata = new Map();
    }
    target.constructor._actionMetadata.set(name, {
      key: propertyKey,
      bodyValidation,
    });
  };
}

/**
 * Fallback decorator for handling websocket messages whose action
 * does not match any registered @Action decorator.
 */
export function UnhandledAction() {
  return function (target: any, propertyKey: string) {
    target.constructor._unhandledActionMetadata = {
      key: propertyKey,
    };
  };
}

/**
 * Request decorator for handling HTTP requests with path and method routing
 * @param options Configuration for the HTTP request handler
 * @param bodyValidation Optional Zod schema for request body validation
 */
export interface RequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
}

export function Request(options: RequestOptions, bodyValidation?: z.ZodSchema) {
  return function (target: any, propertyKey: string) {
    if (!target.constructor._requestMetadata) {
      target.constructor._requestMetadata = new Map();
    }
    
    // Format the path to ensure it starts with a slash
    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    const method = options.method || 'GET';
    
    // Create a unique key for this route using method and path
    const routeKey = `${method}:${path}`;
    
    target.constructor._requestMetadata.set(routeKey, {
      key: propertyKey,
      path,
      method,
      bodyValidation,
    });
  };
}

export interface RoomCompressionOptions {
  /** Minimum size (characters of JSON) of a message to compress. Default: 512. */
  threshold?: number;
  /** DEFLATE level, 1 (fastest) to 9. Default: 1, which keeps most of the gain for half the CPU. */
  level?: number;
  /**
   * Also compress messages returned by `interceptorPacket`. Each client then has its own
   * packet, so this costs one compression per client and per message. Default: false.
   */
  intercepted?: boolean;
}

export interface RoomOptions {
  path: string;
  maxUsers?: number;
  persistState?: boolean;
  /**
   * Debounce window (ms) for storage writes: changes are written once no change happened for this long.
   */
  throttleStorage?: number;
  /**
   * Upper bound (ms) on how long changes can wait for a storage write while the state keeps changing.
   * Defaults to 10 × `throttleStorage`.
   */
  throttleStorageMaxWait?: number;
  /**
   * Minimum interval (ms) between two sync packets. Changes made in the same task are always
   * grouped into one packet, even without this option.
   */
  throttleSync?: number;
  /**
   * Send compressed messages (binary frames, DEFLATE) to clients that ask for them
   * (`connectionRoom(..., { compression: true })`). Other clients keep receiving JSON text.
   * A broadcast is compressed once for all clients. Default: disabled.
   */
  compression?: boolean | RoomCompressionOptions;
  hibernate?: boolean;
  guards?: RoomGuardFn[];
  sessionExpiryTime?: number;
}

export function Room(options: RoomOptions) {
  return function (target: any) {
    target.path = options.path;
    target.prototype.maxUsers = options.maxUsers;
    target.prototype.persistState = options.persistState ?? true;
    target.prototype.throttleStorage = options.throttleStorage;
    target.prototype.throttleStorageMaxWait = options.throttleStorageMaxWait;
    target.prototype.throttleSync = options.throttleSync;
    target.prototype.compression = options.compression;
    target.prototype.sessionExpiryTime = options.sessionExpiryTime ?? 5 * 60 * 1000;
    if (options.guards) {
      target['_roomGuards'] = options.guards;
    }
  };
}

/**
 * Room guard decorator
 * @param guards Array of guard functions to check on connection
 */
export function RoomGuard(guards: RoomGuardFn[]) {
  return function (target: any) {
    target['_roomGuards'] = guards;
  };
}

/**
 * Action guard decorator
 * @param guards Array of guard functions to check before action execution
 */
export function Guard(guards: GuardFn[]) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    if (!target.constructor['_actionGuards']) {
      target.constructor['_actionGuards'] = new Map();
    }
    if (!Array.isArray(guards)) {
      guards = [guards]
    }
    target.constructor['_actionGuards'].set(propertyKey, guards);
  };
}
