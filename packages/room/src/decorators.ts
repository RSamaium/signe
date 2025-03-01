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

export interface RoomOptions {
  path: string;
  maxUsers?: number;
  throttleStorage?: number;
  throttleSync?: number;
  hibernate?: boolean;
  guards?: RoomGuardFn[];
  sessionExpiryTime?: number;
}

export function Room(options: RoomOptions) {
  return function (target: any) {
    target.path = options.path;
    target.prototype.maxUsers = options.maxUsers;
    target.prototype.throttleStorage = options.throttleStorage;
    target.prototype.throttleSync = options.throttleSync;
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