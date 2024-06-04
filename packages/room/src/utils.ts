import { dset } from "dset";

export function isPromise(value: any): boolean {
  return value && value instanceof Promise;
}

export async function awaitReturn(val: any) {
  return isPromise(val) ? await val : val;
}

export function isClass(obj: any): boolean {
  return (
    typeof obj === "function" &&
    obj.prototype &&
    obj.prototype.constructor === obj
  );
}

export function throttle<F extends (...args: any[]) => any>(
  func: F,
  wait: number
): (...args: Parameters<F>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<F> | null = null;

  return function (...args: Parameters<F>) {
    if (!timeout) {
      func(...args);
      timeout = setTimeout(() => {
        if (lastArgs) {
          func(...lastArgs);
          lastArgs = null;
        }
        timeout = null;
      }, wait);
    } else {
      lastArgs = args;
    }
  };
}

export function extractParams(
  pattern: string,
  str: string
): { [key: string]: string } | null {
  const regexPattern = pattern.replace(/{(\w+)}/g, "(?<$1>[\\w-]+)");

  const regex = new RegExp(`^${regexPattern}$`);
  const match = regex.exec(str);

  if (match && match.groups) {
    return match.groups;
  } else {
    return null;
  }
}

export function dremove(obj, keys) {
  keys.split && (keys = keys.split("."));
  var i = 0,
    l = keys.length,
    t = { ...obj },
    k;

  while (i < l - 1) {
    k = keys[i++];
    if (k === "__proto__" || k === "constructor" || k === "prototype") return; // On évite les clés dangereuses
    t = t[k];
    if (typeof t !== "object" || t === null) return; // Si l'objet n'existe pas, on arrête
  }

  k = keys[i];
  if (
    t &&
    typeof t === "object" &&
    !(k === "__proto__" || k === "constructor" || k === "prototype")
  ) {
    delete t[k];
  }
}

export function buildObject(valuesMap, allMemory) {
    let memoryObj = {};
    for (let path of valuesMap.keys()) {
      const value = valuesMap.get(path);
      dset(memoryObj, path, value);
      if (path == "$delete") {
        dremove(allMemory, value);
      } else {
        dset(allMemory, path, value);
      }
    }
    return memoryObj;
  }