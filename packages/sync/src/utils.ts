/**
 * Checks if the given value is a function.
 *
 * @param {unknown} val - The value to check.
 * @returns {boolean} - True if the value is a function, false otherwise.
 * @example
 * isFunction(function() {}); // true
 * isFunction(() => {}); // true
 * isFunction(123); // false
 */
export function isFunction(val: unknown): boolean {
  return {}.toString.call(val) === "[object Function]";
}

/**
 * Checks if the given object is a class.
 *
 * @param {any} obj - The object to check.
 * @returns {boolean} - True if the object is a class, false otherwise.
 * @example
 * class MyClass {}
 * isClass(MyClass); // true
 * isClass(() => {}); // false
 */
export function isClass(obj: any): boolean {
  return (
    typeof obj === "function" &&
    obj.prototype &&
    obj.prototype.constructor === obj
  );
}

/**
 * Checks if the given item is an object.
 *
 * @param {any} item - The item to check.
 * @returns {boolean} - True if the item is an object, false otherwise.
 * @example
 * isObject({}); // true
 * isObject(null); // false
 * isObject([]); // false
 */
export const isObject = (item: any): boolean =>
  item && typeof item === "object" && !Array.isArray(item) && item !== null;

/**
 * Checks if the given value is an instance of a class.
 *
 * @param {unknown} value - The value to check.
 * @returns {boolean} - True if the value is an instance of a class, false otherwise.
 * @example
 * class MyClass {}
 * const instance = new MyClass();
 * isInstanceOfClass(instance); // true
 * isInstanceOfClass({}); // false
 */
export function isInstanceOfClass(value: unknown): boolean {
  if (
    value === null ||
    typeof value !== "object" ||
    value === undefined ||
    Array.isArray(value)
  ) {
    return false;
  }
  return Object.getPrototypeOf(value) !== Object.prototype;
}
