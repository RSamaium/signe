import { dset } from "dset";

/**
 * Checks if a value is a Promise.
 *
 * @param {unknown} value - The value to check.
 * @returns {boolean} - Returns true if the value is a Promise, otherwise false.
 *
 * @example
 * isPromise(Promise.resolve()); // true
 * isPromise(42); // false
 */
export function isPromise(value: unknown): value is Promise<any> {
  return value instanceof Promise;
}

/**
 * Awaits the given value if it is a Promise, otherwise returns the value directly.
 *
 * @param {unknown} val - The value to await or return.
 * @returns {Promise<any>} - Returns a Promise that resolves to the value.
 *
 * @example
 * awaitReturn(Promise.resolve(42)); // 42
 * awaitReturn(42); // 42
 */
export async function awaitReturn(val: unknown): Promise<any> {
  return isPromise(val) ? await val : val;
}

/**
 * Checks if a value is a class.
 *
 * @param {unknown} obj - The value to check.
 * @returns {boolean} - Returns true if the value is a class, otherwise false.
 *
 * @example
 * class MyClass {}
 * isClass(MyClass); // true
 * isClass(() => {}); // false
 */
export function isClass(obj: unknown): boolean {
  return (
    typeof obj === "function" &&
    obj.prototype &&
    obj.prototype.constructor === obj
  );
}


/**
 * Creates a throttled function that only invokes the provided function at most once per every wait milliseconds.
 *
 * The throttled function comes with a cancel method to cancel delayed invocations.
 * If the throttled function is invoked more than once during the wait timeout,
 * it will call the provided function with the latest arguments.
 *
 * @template F - The type of the function to throttle.
 * @param {F} func - The function to throttle.
 * @param {number} wait - The number of milliseconds to throttle invocations to.
 * @returns {(...args: Parameters<F>) => void} - Returns the new throttled function.
 *
 * @example
 * const log = throttle((message) => console.log(message), 1000);
 * log("Hello"); // Will log "Hello" immediately
 * log("World"); // Will log "World" after 1 second, if no other calls to log() are made within the 1 second.
 */
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

/**
 * Extracts parameters from a given string based on a specified pattern.
 *
 * The pattern can include placeholders in the form of {paramName}, which will be
 * extracted from the input string if they match.
 *
 * @param {string} pattern - The pattern containing placeholders.
 * @param {string} str - The string to extract parameters from.
 * @returns {{ [key: string]: string } | null} - An object containing the extracted parameters,
 *                                               or null if the string does not match the pattern.
 *
 * @example
 * // returns { id: '123' }
 * extractParams('game-{id}', 'game-123');
 *
 * @example
 * // returns { foo: 'abc', bar: 'xyz' }
 * extractParams('test-{foo}-{bar}', 'test-abc-xyz');
 *
 */
export function extractParams(
  pattern: string,
  str: string
): { [key: string]: string } | null {
  // Replace placeholders in the pattern with named capture groups
  const regexPattern = pattern.replace(/{(\w+)}/g, "(?<$1>[\\w-]+)");

  // Create a strict regular expression from the pattern
  const regex = new RegExp(`^${regexPattern}$`);
  const match = regex.exec(str);

  // If a match is found and groups are present, return the captured groups
  if (match && match.groups) {
    return match.groups;
  } else if (pattern === str) {
    // If the pattern exactly matches the string, return an empty object
    return {};
  } else {
    // Otherwise, return null
    return null;
  }
}

/**
 * Removes a property from an object based on a dot-separated key string or an array of keys.
 *
 * The function modifies the original object by deleting the specified property.
 * It safely handles dangerous keys like __proto__, constructor, and prototype.
 *
 * @param {Record<string, any>} obj - The object from which to remove the property.
 * @param {string | string[]} keys - The key(s) specifying the property to remove. Can be a dot-separated string or an array of strings.
 *
 * @example
 * const obj = { a: { b: { c: 3 } } };
 * dremove(obj, 'a.b.c');
 * // obj is now { a: { b: {} } }
 *
 * @example
 * const obj = { a: 1, b: 2 };
 * dremove(obj, 'a');
 * // obj is now { b: 2 }
 *
 * @example
 * const obj = { a: { b: { c: 3 } } };
 * dremove(obj, ['a', 'b', 'c']);
 * // obj is now { a: { b: {} } }
 */
export function dremove(
  obj: Record<string, any>,
  keys: string | string[]
): void {
  // If keys is a string, convert it to an array using the "." separator
  if (typeof keys === "string") {
    keys = keys.split(".");
  }

  let i = 0;
  const l = keys.length;
  let t = obj;
  let k;

  while (i < l - 1) {
    k = keys[i++];
    if (k === "__proto__" || k === "constructor" || k === "prototype") return; // Avoid dangerous keys
    if (typeof t[k] !== "object" || t[k] === null) return; // If the object doesn't exist, stop
    t = t[k];
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

/**
 * Builds an object from a map of values and updates the provided memory object.
 *
 * For each key-value pair in the map, this function sets the value at the given path in the `memoryObj`.
 * If the value is "$delete", it removes the corresponding path from `allMemory`.
 *
 * @param {Map<string, any>} valuesMap - A map where the keys are paths and the values are the values to set at those paths.
 * @param {Record<string, any>} allMemory - The object to update based on the values in the map.
 * @returns {Record<string, any>} - The built memory object with the applied values from the map.
 *
 * @example
 * const valuesMap = new Map();
 * valuesMap.set('a.b.c', 1);
 * valuesMap.set('x.y.z', '$delete');
 * const allMemory = { x: { y: { z: 2 } } };
 * const result = buildObject(valuesMap, allMemory);
 * // result is { a: { b: { c: 1 } }, x: { y: { z: '$delete' } } }
 * // allMemory is { a: { b: { c: 1 } }, x: { y: {} } }
 */
export function buildObject(valuesMap: Map<string, any>, allMemory: Record<string, any>): Record<string, any> {
  let memoryObj = {};
  for (let path of valuesMap.keys()) {
    const value = valuesMap.get(path);
    dset(memoryObj, path, value);
    if (value === "$delete") {
      dremove(allMemory, path);
    } else {
      dset(allMemory, path, value);
    }
  }
  return memoryObj;
}