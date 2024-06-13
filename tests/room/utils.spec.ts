import { describe, expect, it, vi } from "vitest";
import {
  buildObject,
  dremove,
  extractParams,
  throttle,
} from "../../packages/room/src/utils";

describe("extractParams", () => {
  it("should return null for non-matching pattern", () => {
    expect(extractParams("game", "test")).toBeNull();
  });

  it("should return an empty object for exact matching pattern without params", () => {
    expect(extractParams("game", "game")).toEqual({});
  });

  it("should extract single parameter", () => {
    expect(extractParams("game-{id}", "game-123")).toEqual({ id: "123" });
  });

  it("should extract multiple parameters", () => {
    expect(extractParams("test-{foo}-{bar}", "test-abc-xyz")).toEqual({
      foo: "abc",
      bar: "xyz",
    });
  });

  it("should return null for partial matching pattern", () => {
    expect(extractParams("game-{id}", "game-")).toBeNull();
  });

  it("should handle hyphens in parameters", () => {
    expect(extractParams("game-{id}", "game-abc-123")).toEqual({
      id: "abc-123",
    });
  });

  it("should handle underscores in parameters", () => {
    expect(extractParams("test_{foo}_{bar}", "test_abc_xyz")).toEqual({
      foo: "abc",
      bar: "xyz",
    });
  });
});

describe("throttle", () => {
  it("should call the function immediately on the first call", () => {
    const func = vi.fn();
    const throttledFunc = throttle(func, 100);

    throttledFunc();

    expect(func).toHaveBeenCalledTimes(1);
  });

  it("should not call the function again before the wait time", () => {
    const func = vi.fn();
    const throttledFunc = throttle(func, 100);

    throttledFunc();
    throttledFunc();

    expect(func).toHaveBeenCalledTimes(1);
  });

  it("should call the function again after the wait time", () => {
    vi.useFakeTimers();
    const func = vi.fn();
    const throttledFunc = throttle(func, 100);

    throttledFunc();
    vi.advanceTimersByTime(50);
    throttledFunc();
    vi.advanceTimersByTime(40);

    expect(func).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);

    expect(func).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("should call the function with the latest arguments after the wait time", () => {
    vi.useFakeTimers();
    const func = vi.fn();
    const throttledFunc = throttle(func, 100);

    throttledFunc("first");
    throttledFunc("second");

    vi.advanceTimersByTime(100);

    expect(func).toHaveBeenCalledWith("first");
    expect(func).toHaveBeenCalledWith("second");
    expect(func).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("should not call the function again if not called during the wait time", () => {
    vi.useFakeTimers();
    const func = vi.fn();
    const throttledFunc = throttle(func, 100);

    throttledFunc();
    vi.advanceTimersByTime(100);

    expect(func).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("dremove", () => {
  it("should remove a simple property", () => {
    const obj = { a: 1, b: 2 };
    dremove(obj, "a");
    expect(obj).toEqual({ b: 2 });
  });

  it("should remove a nested property", () => {
    const obj = { a: { b: { c: 3 } } };
    dremove(obj, "a.b.c");
    expect(obj).toEqual({ a: { b: {} } });
  });

  it("should do nothing if the property does not exist", () => {
    const obj = { a: 1, b: 2 };
    dremove(obj, "c");
    expect(obj).toEqual({ a: 1, b: 2 });
  });

  it("should do nothing if the nested property does not exist", () => {
    const obj = { a: { b: 2 } };
    dremove(obj, "a.c");
    expect(obj).toEqual({ a: { b: 2 } });
  });

  it("should avoid removing dangerous keys", () => {
    const obj = { __proto__: 1, constructor: 2, prototype: 3, a: 4 };
    dremove(obj, "__proto__");
    dremove(obj, "constructor");
    dremove(obj, "prototype");
    dremove(obj, "a");
    expect(obj).toEqual({ __proto__: 1, constructor: 2, prototype: 3 });
  });

  it("should not remove properties from null or non-object values", () => {
    const obj = { a: null, b: 1 };
    dremove(obj, "a.b");
    dremove(obj, "b.c");
    expect(obj).toEqual({ a: null, b: 1 });
  });

  it("should remove deeply nested properties", () => {
    const obj = { a: { b: { c: { d: 4 } } } };
    dremove(obj, "a.b.c.d");
    expect(obj).toEqual({ a: { b: { c: {} } } });
  });

  it("should handle keys passed as an array", () => {
    const obj = { a: { b: { c: 3 } } };
    dremove(obj, ["a", "b", "c"]);
    expect(obj).toEqual({ a: { b: {} } });
  });
});

describe('buildObject', () => {
  it('should set values in memoryObj and allMemory', () => {
    const valuesMap = new Map();
    valuesMap.set('a.b.c', 1);
    valuesMap.set('x.y.z', 2);

    const allMemory = {};
    const memoryObj = buildObject(valuesMap, allMemory);

    expect(memoryObj).toEqual({
      a: {
        b: {
          c: 1
        }
      },
      x: {
        y: {
          z: 2
        }
      }
    });

    expect(allMemory).toEqual({
      a: {
        b: {
          c: 1
        }
      },
      x: {
        y: {
          z: 2
        }
      }
    });
  });

  it('should delete values from allMemory when value is $delete', () => {
    const valuesMap = new Map();
    valuesMap.set('a.b.c', '$delete');

    const allMemory = {
      a: {
        b: {
          c: 1,
          d: 2
        }
      }
    };

    const memoryObj = buildObject(valuesMap, allMemory);

    expect(memoryObj).toEqual({
      a: {
        b: {
          c: '$delete'
        }
      }
    });
    expect(allMemory).toEqual({ a: { b: { d: 2 } } });
  });

  it('should handle mixed set and delete operations', () => {
    const valuesMap = new Map();
    valuesMap.set('a.b.c', 1);
    valuesMap.set('x.y.z', '$delete');
    valuesMap.set('x.y.new', 3);

    const allMemory = {
      x: {
        y: {
          z: 2
        }
      }
    };

    const memoryObj = buildObject(valuesMap, allMemory);

    expect(memoryObj).toEqual({
      a: {
        b: {
          c: 1
        }
      },
      x: {
        y: {
          z: '$delete',
          new: 3
        }
      }
    });

    expect(allMemory).toEqual({
      a: {
        b: {
          c: 1
        }
      },
      x: {
        y: {
          new: 3
        }
      }
    });
  });

  it('should not modify allMemory if path to delete does not exist', () => {
    const valuesMap = new Map();
    valuesMap.set('a.b.c', '$delete');

    const allMemory = {
      a: {
        b: {
          d: 2
        }
      }
    };

    const memoryObj = buildObject(valuesMap, allMemory);

    expect(memoryObj).toEqual({
      a: {
        b: {
          c: '$delete'
        }
      }
    });
    expect(allMemory).toEqual({ a: { b: { d: 2 } } });
  });
});