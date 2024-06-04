export function isFunction(val: unknown): boolean {
  return {}.toString.call(val) === "[object Function]";
}

export const isObject = (item: any) =>
  item && typeof item === "object" && !Array.isArray(item) && item !== null;
