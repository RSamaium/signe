import { ArraySubject, ObjectSubject, isSignal, type WritableSignal } from "@signe/reactive";
import { isObject } from "./utils";

export const syncClass = (instance: any, options = {}) => {
  const cacheSync = new Map();
  const cachePersist = new Set();
  instance.$valuesChanges = {
    set: (path: string, value: any) => {
      cacheSync.set(path, value);
      options.onSync?.(cacheSync);
    },
    setPersist: (path: string) => {
      if (path == '') path = '.'
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

export function createStatesSnapshot(instance: any) {
  let persistObject: any = {}
  if (instance.$snapshot) {
    for (const key of instance.$snapshot.keys()) {
      const signal = instance.$snapshot.get(key)
      const persist = signal.options.persist ?? true;
      let value = signal();
      if (isObject(value) || Array.isArray(value)) {
        break
      }
      if (persist) {
        persistObject[key] = value;
      }
    }
  }
  return persistObject
}

export function setMetadata(target: any, key: string, value: any) {
  const meta = target.constructor._propertyMetadata
  const propId = meta?.get(key);
  if (propId) {
    if (isSignal(target[propId])) {
      target[propId].set(value)
    }
    else {
      target[propId] = value;
    }
  }
}

export const createSyncClass = (currentClass: any, parentKey: any = null, parentClass = null, path = "") => {
  currentClass.$path = path;
  if (parentClass) {
    currentClass.$valuesChanges = parentClass.$valuesChanges;
  }
  if (parentKey) {
    setMetadata(currentClass, 'id', parentKey)
  }
  if (currentClass.$snapshot) {
    for (const key of currentClass.$snapshot.keys()) {
      const signal = currentClass.$snapshot.get(key)
      const syncToClient = signal.options.syncToClient ?? true;
      let value = signal();
      if (isObject(value) || Array.isArray(value)) {
        value = { ...value };
      }
      if (syncToClient) currentClass.$valuesChanges.set((path ? path + "." : "") + key, value);
    }
  }
};

export const type = (
  _signal: any,
  path: string,
  options = {},
  currentInstance: any
): WritableSignal<any> => {
  const syncToClient = options.syncToClient ?? true;
  const persist = options.persist ?? true;
  let init = true;
  _signal.options = options;
  _signal.observable.subscribe((value) => {
    const check = currentInstance.$valuesChanges;
    if (init) {
      init = false;
      return;
    }
    if (currentInstance.$path !== undefined) {
      const propPath = (currentInstance.$path ? currentInstance.$path + "." : "") + path;
      if (_signal._subject instanceof ObjectSubject) {
        const newPath =
          (currentInstance.$path ? currentInstance.$path + "." : "") +
          path +
          "." +
          value.key;
        if (value.type == "add") {
          createSyncClass(value.value, value.key, currentInstance, newPath);
        } else if (value.type == "update") {
          if (isObject(value.value) || Array.isArray(value.value)) {
            // createClass
          } else {
            if (syncToClient) check.set(newPath, value.value);
          }
        } else if (value.type == "remove") {
          if (syncToClient) check.set(newPath, "$delete");
        }
      } else if (_signal._subject instanceof ArraySubject) {
        if (value.type == "add") {
          createSyncClass(
            value.items[0],
            value.key,
            propPath +
              "." +
              value.index
          );
        }
      } else {
        if (syncToClient) check.set(propPath, value);
        if (persist) {
          check.setPersist(currentInstance.$path);
        }
      }
    }
  });

  if (!currentInstance.$snapshot) {
    currentInstance.$snapshot = new Map();
  }

  currentInstance.$snapshot.set(path, _signal);

  return _signal;
};
