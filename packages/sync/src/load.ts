import { isSignal } from "@signe/reactive";
import { DELETE_TOKEN, setMetadata } from "./core";
import { isClass } from "./utils";

/**
 * Loads values into the root instance by paths or from an object.
 * 
 * @param {object} rootInstance - The instance into which values will be loaded.
 * @param {object} values - The values to load, either as paths or an object.
 * @param {boolean} [valueIsObject=false] - If true, `values` is treated as an object.
 * @example
 * // Using paths:
 * load(instance, { 'position.x': 10, 'position.y': 20 });
 * 
 * // Using an object:
 * load(instance, { position: { x: 10, y: 20 } }, true);
 */
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

/**
 * Loads values into the root instance using paths.
 * 
 * @param {object} rootInstance - The instance into which values will be loaded.
 * @param {object} values - The values to load, with keys as paths.
 * @example
 * loadFromPaths(instance, { 'position.x': 10, 'position.y': 20 });
 */
function loadFromPaths(rootInstance: any, values: { [path: string]: any }) {
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split(".");
    loadValue(rootInstance, parts, value);
  }
}

/**
 * Recursively loads values from an object into the root instance.
 * 
 * @param {object} rootInstance - The instance into which values will be loaded.
 * @param {object} values - The values to load.
 * @param {string} [currentPath=""] - The current path in the recursion.
 * @example
 * loadFromObject(instance, { position: { x: 10, y: 20 } });
 */
function loadFromObject(
  rootInstance: any,
  values: object,
  currentPath: string = ""
) {
  for (let key in values) {
    const value = values[key];
    const newPath = currentPath ? `${currentPath}.${key}` : key;
    if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      loadFromObject(rootInstance, value, newPath);
    } else {
      const parts = newPath.split(".");
      loadValue(rootInstance, parts, value);
    }
  }
}

/**
 * Sets a value in the root instance by navigating through the path parts.
 * 
 * @param {object} rootInstance - The instance into which the value will be set.
 * @param {string[]} parts - The parts of the path.
 * @param {any} value - The value to set.
 * @example
 * loadValue(instance, ['position', 'x'], 10);
 */
function loadValue(rootInstance: any, parts: string[], value: any) {
  let current: any = rootInstance;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (i === parts.length - 1) {
      if (value == DELETE_TOKEN) {
        if (isSignal(current)) {
          current = current();
        }
        Reflect.deleteProperty(current, part);
      }
      else if (current[part]?._subject) {
        current[part].set(value);
      }
      else if (isSignal(current) && Array.isArray(current()) && !isNaN(Number(part))) {
        current()[Number(part)] = value;
      }
      else {
        current[part] = value;
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

/**
 * Retrieves a value from the root instance by a path.
 * 
 * @param {object} root - The root instance.
 * @param {string} path - The path to the value.
 * @returns {any} - The value at the specified path.
 * @example
 * const value = getByPath(instance, 'position.x');
 */
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