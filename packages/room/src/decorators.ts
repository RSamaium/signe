import type * as Party from "./types/party"
import type { z } from "zod"
type GuardFn = (sender: Party.Connection, value: any) => boolean | Promise<boolean>;
type RoomGuardFn = (conn: Party.Connection, ctx: Party.ConnectionContext) => boolean | Promise<boolean>;

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