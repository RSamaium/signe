import { describe, expect, it, vi } from "vitest";
import {
  buildObject,
  dremove,
  extractParams,
  throttle,
  batch,
  debounce,
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
describe("batch", () => {
  it("runs once at the end of the task when wait is 0", async () => {
    const fn = vi.fn();
    const schedule = batch(fn);
    schedule(); schedule(); schedule();
    expect(fn).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs at most once per wait window, with a trailing run", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const schedule = batch(fn, 100);
      schedule();
      await Promise.resolve();
      expect(fn).toHaveBeenCalledTimes(1);

      schedule(); schedule();
      await vi.advanceTimersByTimeAsync(99);
      expect(fn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("debounce", () => {
  it("runs after the quiet period", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const schedule = debounce(fn, 100);
      schedule();
      vi.advanceTimersByTime(50);
      schedule();
      vi.advanceTimersByTime(99);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs after maxWait even when calls keep coming", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const schedule = debounce(fn, 100, 300);
      for (let t = 0; t < 300; t += 50) {
        schedule();
        vi.advanceTimersByTime(50);
      }
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildObject with cached path keys", () => {
  it("builds a new packet each call while reusing split paths", () => {
    const memory: any = {};
    const values = new Map<string, any>([["players.p1.x", 1], ["players.p1.y", 2]]);
    const first = buildObject(values, memory);
    values.set("players.p1.x", 3);
    const second = buildObject(values, memory);

    expect(first).toEqual({ players: { p1: { x: 1, y: 2 } } });
    expect(second).toEqual({ players: { p1: { x: 3, y: 2 } } });
    expect(first).not.toBe(second);
    expect(memory).toEqual({ players: { p1: { x: 3, y: 2 } } });
  });

  it("keeps creating arrays for numeric keys and handles deletes", () => {
    const memory: any = {};
    buildObject(new Map([["items.0", "a"], ["items.1", "b"]]), memory);
    expect(Array.isArray(memory.items)).toBe(true);

    const packet = buildObject(new Map([["items.0", "$delete"]]), memory);
    expect(packet).toEqual({ items: ["$delete"] });
    expect(memory.items[0]).toBeUndefined();
  });

  it("stays correct past the cache limit", () => {
    const memory: any = {};
    const values = new Map<string, any>();
    for (let i = 0; i < 10_050; i++) values.set(`p${i}.v`, i);
    buildObject(values, memory);
    expect(memory.p0.v).toBe(0);
    expect(memory.p10049.v).toBe(10049);
  });
});
