import {
  ArraySubject,
  ObjectSubject,
  isSignal,
  type WritableSignal,
} from "@signe/reactive";
import { isInstanceOfClass, isObject } from "./utils";
import { type Observable } from "rxjs";

interface SyncOptions {
  onSync?: (value: Map<string, any>) => void;
  onPersist?: (value: Set<string>) => void;
}

interface TypeOptions {
  syncToClient?: boolean;
  persist?: boolean;
  classType?: any;
}

interface ExtendedWritableSignal<T> extends Omit<WritableSignal<T>, 'observable'> {
  options?: TypeOptions;
  _subject?: ObjectSubject<T> | ArraySubject<T>;
  observable: Observable<SubjectValue<T>>;
}

interface SubjectValue<T = any> {
  type: 'add' | 'update' | 'remove' | 'reset';
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
    setPersist: (path: string) => void;
    has: (path: string) => boolean;
    get: (path: string) => any;
  };
}

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
  const cachePersist = new Set<string>();
  instance.$valuesChanges = {
    set: (path: string, value: any) => {
      cacheSync.set(path, value);
      options.onSync?.(cacheSync);
    },
    setPersist: (path: string) => {
      if (path == "") path = ".";
      cachePersist.add(path);
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
export function createStatesSnapshot(instance: Record<string, any>): Record<string, any> {
  let persistObject: any = {};
  if (instance.$snapshot) {
    for (const key of instance.$snapshot.keys()) {
      const signal = instance.$snapshot.get(key);
      const persist = signal.options.persist ?? true;
      let value = signal();
      if (isObject(value) || Array.isArray(value)) {
        break;
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
      const syncToClient = signal.options.syncToClient ?? true;
      const persist = signal.options.persist ?? true;
      let value = signal();
      if (isObject(value) || Array.isArray(value)) {
        value = { ...value };
      }
      const newPath = (path ? path + "." : "") + key;
      if (syncToClient) {
        currentClass.$valuesChanges.set(newPath, value);
      }
      if (persist) {
        if (parentClass) currentClass.$valuesChanges.setPersist(path);
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
  _signal.options = options;

  const handleObjectSubject = (value: SubjectValue, propPath: string) => {
    const newPath = `${propPath}${value.key ? `.${value.key}` : ''}`;

    if (['add', 'reset', 'update'].includes(value.type)) {
      if (isInstanceOfClass(value.value)) {
        createSyncClass(value.value, value.key, currentInstance, newPath);
      } else if (value.type === 'update' && (isObject(value.value) || Array.isArray(value.value))) {
        createSyncClass(value.value, value.key, currentInstance, newPath);
      } else {
        savePath(newPath, value.value);
      }
    } else if (value.type === 'remove') {
      savePath(newPath, '$delete');
    }
  };

  const handleArraySubject = (value: SubjectValue, propPath: string) => {
    if (value.type === 'reset' && Array.isArray(value.items)) {
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

    if (['add', 'update'].includes(value.type) && firstItem !== undefined) {
      if (isInstanceOfClass(firstItem)) {
        createSyncClass(firstItem, value.key, currentInstance, newPath);
      } else if (value.type === 'update' && (isObject(firstItem) || Array.isArray(firstItem))) {
        createSyncClass(firstItem, value.key, currentInstance, newPath);
      } else {
        savePath(newPath, firstItem);
      }
    } else if (value.type === 'remove') {
      savePath(newPath, '$delete');
    }
  };

  const savePath = (propPath: string, value: any) => {
    if (syncToClient) {
      currentInstance.$valuesChanges.set(propPath, value);
    }
    if (persist && currentInstance.$path !== undefined) {
      currentInstance.$valuesChanges.setPersist(currentInstance.$path);
    }
  };

  _signal.observable.subscribe((value: SubjectValue<T>) => {
    if (init) {
      init = false;
      return;
    }

    if (currentInstance.$path !== undefined) {
      const propPath = `${currentInstance.$path ? currentInstance.$path + '.' : ''}${path}`;

      if (_signal._subject instanceof ObjectSubject) {
        handleObjectSubject(value, propPath);
      } else if (_signal._subject instanceof ArraySubject) {
        handleArraySubject(value, propPath);
      } else {
        savePath(propPath, value);
      }
    }
  });

  if (!currentInstance.$snapshot) {
    currentInstance.$snapshot = new Map();
  }

  currentInstance.$snapshot.set(path, _signal);

  return _signal;
};
