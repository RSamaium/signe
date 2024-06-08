export function isFunction(val: unknown): boolean {
  return {}.toString.call(val) === "[object Function]";
}

export function isClass(obj: any): boolean {
  return (
    typeof obj === "function" &&
    obj.prototype &&
    obj.prototype.constructor === obj
  );
}

export const isObject = (item: any) =>
  item && typeof item === "object" && !Array.isArray(item) && item !== null;

export function isInstanceOfClass(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || value === undefined || Array.isArray(value)) {
      return false;
  }
  return Object.getPrototypeOf(value) !== Object.prototype;
}