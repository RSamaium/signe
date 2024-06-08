import { isSignal } from "@signe/reactive";
import { setMetadata } from "./core";
import { isClass } from "./utils";

export function load(rootInstance: any, values: { [path: string]: any }): void;
export function load(
  rootInstance: any,
  values: object,
  valueIsObject: true
): void;
export function load(
  rootInstance: any,
  values: { [path: string]: any } | object,
  valueIsObject?: boolean
) {
  if (valueIsObject) {
    loadFromObject(rootInstance, values);
  } else {
    loadFromPaths(rootInstance, values);
  }
}

function loadFromPaths(rootInstance: any, values: { [path: string]: any }) {
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split(".");
    loadValue(rootInstance, parts, value);
  }
}

function loadFromObject(
  rootInstance: any,
  values: object,
  currentPath: string = ""
) {
  for (const [key, value] of Object.entries(values)) {
    const newPath = currentPath ? `${currentPath}.${key}` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      loadFromObject(rootInstance, value, newPath);
    } else {
      const parts = newPath.split(".");
      loadValue(rootInstance, parts, value);
    }
  }
}

function loadValue(rootInstance: any, parts: string[], value: any) {
  let current: any = rootInstance;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (i === parts.length - 1) {
      if (value == '$delete') {
        if (isSignal(current)) {
          current = current();
        }
        Reflect.deleteProperty(current, part);
      }
      else if (current[part]?._subject) {
        current[part].set(value);
      }
    } else {
      if (isSignal(current)) {
        current = current();
      }
      const currentValue = current[part];
      if (currentValue === undefined) {
        const parentInstance = getByPath(
          rootInstance,
          parts.slice(0, i).join(".")
        );
        const classType = parentInstance?.options?.classType;
        if (classType) {
          current[part] = !isClass(classType) ? classType(part) : new classType();
          setMetadata(current[part], 'id', part)
        } else {
          current[part] = {};
        }
      }
      current = current[part];
    }
  }
}

export function getByPath(root: any, path: string) {
  const parts = path.split(".");
  let current = root;
  for (const part of parts) {
    if (isSignal(current)) {
      current = current();
    }
    if (current[part]) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}
