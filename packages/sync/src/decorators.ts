import { type } from "./core";

export function sync(options?: any) {
  let classType;
  let persist = true;
  let syncToClient = true;

  if (typeof options === "function") {
    classType = options;
  } else if (typeof options === "object") {
    classType = options.classType;
    if (options.hasOwnProperty("persist")) {
      persist = options.persist;
    }
    if (options.hasOwnProperty("syncToClient")) {
      syncToClient = options.syncToClient;
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

export function id() {
  return function (target: any, propertyKey: string) {
    if (!target.constructor._propertyMetadata) {
      target.constructor._propertyMetadata = new Map();
    }
    target.constructor._propertyMetadata.set("id", propertyKey);
  };
}

export function users(options) {
  return function (target: any, propertyKey: string) {
    if (!target.constructor._propertyMetadata) {
      target.constructor._propertyMetadata = new Map();
    }
    target.constructor._propertyMetadata.set("users", propertyKey);
    sync(options)(target, propertyKey);
  };
}

export function persist() {
  return sync({
    persist: true,
    syncToClient: false,
  });
}
