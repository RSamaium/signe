import {
  ArraySubject,
  ObjectSubject,
  isArraySubject,
  isObjectSubject,
  isSignal,
  isComputed,
  type WritableSignal,
} from "@signe/reactive";
import { isInstanceOfClass, isObject } from "./utils";
import { type Observable } from "rxjs";

interface SyncOptions {
  onSync?: (value: Map<string, any>) => void;
  onPersist?: (value: Map<string, any>) => void;
}

interface TypeOptions {
  syncToClient?: boolean;
  persist?: boolean;
  classType?: any;
}

interface ExtendedWritableSignal<T>
  extends Omit<WritableSignal<T>, "observable"> {
  options?: TypeOptions;
  _subject?: ObjectSubject<T> | ArraySubject<T>;
  observable: Observable<SubjectValue<T>>;
}

interface SubjectValue<T = any> {
  type: "add" | "update" | "remove" | "reset";
  value: T;
  key?: string;
  index?: number;
  items?: T[];
}

interface SyncInstance {
  $path?: string;
  $snapshot?: Map<string, ExtendedWritableSignal<any>>;
  $valuesChanges: {
    set: (path: string, value: any) => void;
    setPersist: (path: string, value: any) => void;
    has: (path: string) => boolean;
    get: (path: string) => any;
  };
}

export const DELETE_TOKEN = "$delete";

/**
 * Synchronizes an instance by adding `$valuesChanges` methods for state management.
 *
 * This function initializes a cache for syncing and persisting values. It adds methods to the instance
 * to set values, mark values for persistence, and check and retrieve values from the cache.
 * Optionally, callbacks can be provided to handle synchronization and persistence events.
 *
 * @param {Record<string, any>} instance - The instance to be synchronized.
 * @param {SyncOptions} [options={}] - Optional synchronization options.
 * @param {Function} [options.onSync] - Callback function to be called on value sync with the current cache.
 * @param {Function} [options.onPersist] - Callback function to be called on value persistence with the current cache.
 *
 * @example
 * class TestClass {
 *   @sync() count = signal(0);
 *   @sync() text = signal('hello');
 * }
 * const instance = new TestClass();
 * syncClass(instance, {
 *   onSync: (cache) => console.log('Sync cache:', cache),
 *   onPersist: (cache) => console.log('Persist cache:', cache),
 * });
 */
export const syncClass = (instance: any, options: SyncOptions = {}) => {
  const cacheSync = new Map();
  const cachePersist = new Map<string, any>();
  instance.$valuesChanges = {
    set: (path: string, value: any) => {
      cacheSync.set(path, value);
      options.onSync?.(cacheSync);
    },
    setPersist: (path: string, value: any) => {
      if (path == "") path = ".";
      cachePersist.set(path, value);
      options.onPersist?.(cachePersist);
    },
    has: (path: string) => {
      return cacheSync.has(path);
    },
    get: (path: string) => {
      return cacheSync.get(path);
    },
  };
  createSyncClass(instance);
};

/**
 * Creates a snapshot of the current state of an instance's signals.
 *
 * This function iterates over the signals stored in the instance's $snapshot property.
 * If a signal's value is not an object or array and the signal's persist option is true or undefined,
 * it adds the signal's value to the returned snapshot object.
 *
 * @param {Record<string, any>} instance - The instance containing the $snapshot map of signals.
 * @returns {Record<string, any>} - An object representing the persisted snapshot of the instance's state.
 *
 * @example
 * ```typescript
 * class TestClass {
 *   @sync() count = signal(0);
 *   @sync() text = signal('hello');
 * }
 * const instance = new TestClass();
 * syncClass(instance);
 * const snapshot = createStatesSnapshot(instance);
 * console.log(snapshot); // { count: 0, text: 'hello' }
 * ```
 */
export function createStatesSnapshot(
  instance: Record<string, any>
): Record<string, any> {
  let persistObject: any = {};
  if (instance?.$snapshot) {
    for (const key of instance.$snapshot.keys()) {
      const signal = instance.$snapshot.get(key);
      const persist = signal.options.persist ?? true;
      let value = signal();
      if (isObject(value) || Array.isArray(value)) {
        continue;
      }
      if (persist) {
        persistObject[key] = value;
      }
    }
  }
  return persistObject;
}

export function setMetadata(target: any, key: string, value: any) {
  const meta = target.constructor._propertyMetadata;
  const propId = meta?.get(key);
  if (propId) {
    if (isSignal(target[propId])) {
      target[propId].set(value);
    } else {
      target[propId] = value;
    }
  }
}

export const createSyncClass = (
  currentClass: any,
  parentKey: any = null,
  parentClass = null,
  path = ""
) => {
  currentClass.$path = path;
  if (parentClass) {
    currentClass.$valuesChanges = parentClass.$valuesChanges;
  }
  if (parentKey) {
    setMetadata(currentClass, "id", parentKey);
  }
  if (currentClass.$snapshot) {
    for (const key of currentClass.$snapshot.keys()) {
      const signal = currentClass.$snapshot.get(key);
      const syncToClient = signal.options?.syncToClient ?? true;
      const persist = signal.options?.persist ?? true;
      let signalValue = signal();

      if (isObject(signalValue) || Array.isArray(signalValue)) {
        signalValue = { ...signalValue };
      }

      const newPath = (path ? path + "." : "") + key;
      if (syncToClient) {
        currentClass.$valuesChanges.set(newPath, signalValue);
      }
      if (persist) {
        if (parentClass)
          currentClass.$valuesChanges.setPersist(path, signalValue);
      }

      // Handle computed signals specifically
      if (isComputed(signal)) {
        // Subscribe to the computed signal's observable to sync changes
        signal.observable.subscribe((newValue: any) => {
          if (syncToClient) {
            currentClass.$valuesChanges.set(newPath, newValue);
          }
        });
      }
    }
  }
};

export const type = <T>(
  _signal: ExtendedWritableSignal<T>,
  path: string,
  options: TypeOptions = {},
  currentInstance: SyncInstance
): ExtendedWritableSignal<T> => {
  const { syncToClient = true, persist = true } = options;
  let init = true;

  const handleObjectSubject = (value: SubjectValue, propPath: string) => {
    const newPath = `${propPath}${value.key ? `.${value.key}` : ""}`;
    if (["add", "reset", "update"].includes(value.type)) {
      if (isInstanceOfClass(value.value)) {
        createSyncClass(value.value, value.key, currentInstance, newPath);
      } else if (
        value.type === "update" &&
        (isObject(value.value) || Array.isArray(value.value))
      ) {
        createSyncClass(value.value, value.key, currentInstance, newPath);
      } else {
        savePath(newPath, value.value);
      }
    } else if (value.type === "remove") {
      savePath(newPath, DELETE_TOKEN);
    }
  };

  const handleArraySubject = (value: SubjectValue, propPath: string) => {
    if (value.type === "reset" && Array.isArray(value.items)) {
      value.items.forEach((item, index) => {
        const newPath = `${propPath}.${index}`;
        if (isInstanceOfClass(item)) {
          createSyncClass(item, value.key, currentInstance, newPath);
        } else {
          savePath(newPath, item);
        }
      });
      return;
    }

    const newPath = `${propPath}.${value.index}`;
    const firstItem = value.items?.[0];

    if (["add", "update"].includes(value.type) && firstItem !== undefined) {
      if (isInstanceOfClass(firstItem)) {
        createSyncClass(firstItem, value.key, currentInstance, newPath);
      } else if (
        value.type === "update" &&
        (isObject(firstItem) || Array.isArray(firstItem))
      ) {
        createSyncClass(firstItem, value.key, currentInstance, newPath);
      } else {
        savePath(newPath, firstItem);
      }
    } else if (value.type === "remove") {
      savePath(newPath, DELETE_TOKEN);
    }
  };

  const savePath = (propPath: string, value: any) => {
    if (syncToClient) {
      currentInstance.$valuesChanges.set(propPath, value);
    }
    if (persist && currentInstance.$path !== undefined) {
      currentInstance.$valuesChanges.setPersist(
        value == DELETE_TOKEN ? propPath : currentInstance.$path,
        value
      );
    }
  };

  /**
   * Common function to handle subscription to a signal
   * Uses the same logic for all signal types
   */
  const setupSubscription = (signal: any, signalPath: string) => {
    if (!isSignal(signal)) return;

    // For initial sync of direct property values
    if (syncToClient && currentInstance.$valuesChanges) {
      const initialValue = signal();
      currentInstance.$valuesChanges.set(signalPath, initialValue);
    }

    signal.options = options;

    signal.observable.subscribe((value: any) => {
      if (init) return; // Skip initial value

      if (currentInstance.$path !== undefined) {
        const fullPath = `${
          currentInstance.$path ? currentInstance.$path + "." : ""
        }${signalPath}`;

        if (isComputed(signal)) {
          savePath(fullPath, value);
        } else if (isObjectSubject(signal._subject)) {
          handleObjectSubject(value, fullPath);
        } else if (isArraySubject(signal._subject)) {
          handleArraySubject(value, fullPath);
        } else {
          savePath(fullPath, value);
        }
      }
    });

    if (!currentInstance.$snapshot) {
      currentInstance.$snapshot = new Map();
    }
    currentInstance.$snapshot.set(path, signal);
  };

  // If not a signal, handle appropriately
  if (!isSignal(_signal)) {
    // If it's an object (not null or array), process its signal properties
    if (_signal && typeof _signal === "object" && !Array.isArray(_signal)) {
      // Process each property in the object
      for (const key in _signal) {
        if (Object.prototype.hasOwnProperty.call(_signal, key)) {
          const value = _signal[key];
          const propertyPath = `${path}.${key}`;

          // If property is a signal, set up syncing
          if (isSignal(value)) {
            setupSubscription(value, propertyPath);
          }
          // Recursively process nested objects
          else if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value)
          ) {
            type(value as any, propertyPath, options, currentInstance);
          }
        }
      }

      init = false;
    }
    // For primitive values or arrays, just return as is
    return _signal as any;
  }
  // Set up subscription for the main signal
  setupSubscription(_signal, path);

  init = false;

  return _signal;
};
