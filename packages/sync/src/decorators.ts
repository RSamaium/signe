import { type } from "./core";

interface SyncOptions {
  classType?: Function;
  persist?: boolean;
  syncToClient?: boolean;
}

/**
 * A decorator to sync a property with optional settings.
 * 
 * @param {SyncOptions | Function} [options] - The options or class type for syncing.
 * @returns {PropertyDecorator} - The property decorator function.
 * @example
 * ```typescript
 * import { signal } from '@signe/reactive'
 * import { sync } from '@signe/sync'
 * 
 * class MyClass {
 *   @sync() myProperty = signal(10);
 * 
 *   @sync({ classType: MyClass, persist: false }) myOtherProperty = signal({});
 * }
 * ```
 */
export function sync(options?: SyncOptions | Function): PropertyDecorator {
  let classType: Function | undefined;
  let persist = true;
  let syncToClient = true;

  if (typeof options === "function") {
    classType = options;
  } else if (typeof options === "object") {
    classType = options.classType;
    if (options.hasOwnProperty("persist")) {
      persist = options.persist!;
    }
    if (options.hasOwnProperty("syncToClient")) {
      syncToClient = options.syncToClient!;
    }
  }

  return function (target: any, propertyKey: string) {
    const privatePropertyKey = `__${propertyKey}`;

    const getter = function () {
      return this[privatePropertyKey];
    };

    const setter = function (newVal: any) {
      this[privatePropertyKey] = type(
        newVal,
        propertyKey,
        { classType, persist, syncToClient },
        this
      );
    };

    Object.defineProperty(target, propertyKey, {
      get: getter,
      set: setter,
      enumerable: true,
      configurable: true,
    });
  };
}

/**
 * A decorator to mark a property as an ID.
 * 
 * @returns {PropertyDecorator} - The property decorator function.
 * @example
 * ```typescript
 * import { signal } from '@signe/reactive'
 * import { id } from '@signe/sync'
 * 
 * class MyClass {
 *   @id() myId = signal(0);
 * }
 * ```
 */
export function id(): PropertyDecorator {
  return function (target: any, propertyKey: string) {
    if (!target.constructor._propertyMetadata) {
      target.constructor._propertyMetadata = new Map();
    }
    target.constructor._propertyMetadata.set("id", propertyKey);
  };
}

interface UsersOptions extends SyncOptions {}
type UserClass = Function;

/**
 * A decorator to mark a property for users with sync options.
 * 
 * @param {UsersOptions} options - The options for syncing.
 * @returns {PropertyDecorator} - The property decorator function.
 * @example
 * ```typescript
 * import { signal } from '@signe/reactive'
 * import { users } from '@signe/sync'
 * 
 * class MyClass {
 *   @users(UserClass) myUsers = signal({});
 * }
 * ```
 */
export function users(options: UsersOptions | UserClass): PropertyDecorator {
  return function (target: any, propertyKey: string) {
    if (!target.constructor._propertyMetadata) {
      target.constructor._propertyMetadata = new Map();
    }
    target.constructor._propertyMetadata.set("users", propertyKey);
    sync(options)(target, propertyKey);
  };
}

/**
 * A decorator to mark a property for persistence.
 * 
 * @returns {PropertyDecorator} - The property decorator function.
 * @example
 * ```typescript
 * import { signal } from '@signe/reactive'
 * import { persist } from '@signe/sync'
 * 
 * class MyClass {
 *   @persist() myPersistentProperty = signal(0);
 * }
 * ```
 */
export function persist(): PropertyDecorator {
  return sync({
    persist: true,
    syncToClient: false,
  });
}

/**
 * A decorator to mark a property for connection status tracking.
 * 
 * @returns {PropertyDecorator} - The property decorator function.
 * @example
 * ```typescript
 * import { signal } from '@signe/reactive'
 * import { connected } from '@signe/sync'
 * 
 * class User {
 *   @connected() isConnected = signal(false);
 * }
 * ```
 */
export function connected(): PropertyDecorator {
  return function (target: any, propertyKey: string) {
    if (!target.constructor._propertyMetadata) {
      target.constructor._propertyMetadata = new Map();
    }
    target.constructor._propertyMetadata.set("connected", propertyKey);
    sync({
      persist: false
    })(target, propertyKey);
  };
}
