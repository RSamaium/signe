import { signal } from "@signe/reactive";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persist, sync, syncClass } from "../../packages/sync/src";

describe("onSync", () => {
  it("should sync class", () => {
    class TestClass {
      @sync() count = signal(0);
    }

    const instance = new TestClass();
    const onSync = vi.fn();

    syncClass(instance, { onSync });

    expect(onSync).toHaveBeenCalledWith(new Map([["count", 0]]));
  });

  it("should not sync nested class if not attached to parent", () => {
    class NestedClass {
      @sync() value = signal(10);
    }

    class TestClass {
      @sync() nested = signal({});
    }

    const instance = new TestClass();
    const onSync = vi.fn();

    syncClass(instance, { onSync });

    const nested = new NestedClass();
    nested.value.set(20);

    expect(onSync).toHaveBeenCalledWith(new Map([["nested", {}]]));
  });


  it("should sync class and update on change", () => {
    class TestClass {
      @sync() count = signal(0);
    }

    const instance = new TestClass();
    const onSync = vi.fn();

    syncClass(instance, { onSync });

    instance.count.set(1);

    expect(onSync).toHaveBeenCalledTimes(2);
    expect(onSync).toHaveBeenCalledWith(new Map([["count", 1]]));
  });

  it("should sync multiple properties", () => {
    class TestClass {
      @sync() count = signal(0);
      @sync() name = signal("test");
    }

    const instance = new TestClass();
    const onSync = vi.fn();

    syncClass(instance, { onSync });

    instance.count.set(1);
    instance.name.set("updated");

    expect(onSync).toHaveBeenCalledTimes(4);
    expect(onSync).toHaveBeenCalledWith(
      new Map([
        ["count", 1],
        ["name", "updated"],
      ])
    );
  });

  describe("sync nested class", () => {
    let instance;
    let onSync;
    let nested;
    beforeEach(() => {
      class NestedClass {
        @sync() value = signal(10);
      }

      class TestClass {
        @sync() nested = signal({});
      }

      instance = new TestClass();
      onSync = vi.fn();

      syncClass(instance, { onSync });

      nested = new NestedClass();
    });

    it("should sync nested classes", () => {
      instance.nested.mutate((obj) => (obj["id"] = nested));

      expect(onSync).toHaveBeenCalledTimes(2);
      expect(onSync).toHaveBeenCalledWith(
        new Map([
          ["nested", {}],
          ["nested.id.value", 10],
        ])
      );
    });
  });

  describe("sync object", () => {
    let instance;
    let onSync;
    beforeEach(() => {
      class TestClass {
        @sync() data = signal({ a: 1, b: 2 });
      }

      instance = new TestClass();
      onSync = vi.fn();

      syncClass(instance, { onSync });
    });

    it("should sync object signal", () => {
      instance.data.mutate((obj) => {
        obj.a = 3;
      });

      expect(onSync).toHaveBeenCalledTimes(2);
      expect(onSync).toHaveBeenCalledWith(
        new Map([
          ["data", { a: 1, b: 2 }],
          ["data.a", 3],
        ])
      );
    });

    it("should sync object signal", () => {
      instance.data.mutate((obj) => {
        delete obj.a;
      });

      expect(onSync).toHaveBeenCalledWith(
        new Map([
          ["data", { a: 1, b: 2 }],
          ["data.a", "$delete"],
        ])
      );
    });

    it("With nested class", () => {
      class NestedClass {
        @sync() value = signal(10);
      }

      class TestClass {
        @sync() data = signal({ nested: {} });
      }

      instance = new TestClass();
      onSync = vi.fn();

      syncClass(instance, { onSync });

      const nested = new NestedClass();
      instance.data.mutate((obj) => {
        obj.nested = nested;
      });

      expect(onSync).toHaveBeenCalledTimes(2);
      expect(onSync).toHaveBeenCalledWith(
        new Map([
          ["data", { nested: {} }],
          ["data.nested.value", 10],
        ])
      );
    });
  });

  describe("sync array", () => {
    let instance;
    let onSync;

    beforeEach(() => {
      class TestClass {
        @sync() items = signal([1, 2]);
      }

      instance = new TestClass();
      onSync = vi.fn();

      syncClass(instance, { onSync });
    });

    it("should sync array signal", () => {
      instance.items.mutate((arr) => {
        arr.push(3);
      });

      expect(onSync).toHaveBeenCalledTimes(2);
      expect(onSync).toHaveBeenCalledWith(
        new Map([
          ["items", { "0": 1, "1": 2 }],
          ["items.2", 3],
        ])
      );
    });

    it("should update array signal", () => {
      instance.items.mutate((arr) => {
        arr[0] = 10;
      });

      expect(onSync).toHaveBeenCalledTimes(2);
      expect(onSync).toHaveBeenCalledWith(
        new Map([
          ["items", { "0": 1, "1": 2 }],
          ["items.0", 10],
        ])
      );
    });

    it("should sync array signal", () => {
      instance.items.mutate((arr) => {
        arr.shift();
      });

      expect(onSync).toHaveBeenCalledWith(
        new Map([
          ["items", { "0": 1, "1": 2 }],
          ["items.0", "$delete"],
        ])
      );
    });

    it("With nested class", () => {
      class NestedClass {
        @sync() value = signal(10);
      }

      class TestClass {
        @sync() data = signal([]);
      }

      instance = new TestClass();
      onSync = vi.fn();

      syncClass(instance, { onSync });

      const nested = new NestedClass();
      instance.data.mutate((obj) => {
        obj[0] = nested;
      });

      expect(onSync).toHaveBeenCalledTimes(2);
      expect(onSync).toHaveBeenCalledWith(
        new Map([
          ["data", {}],
          ["data.0.value", 10],
        ])
      );
    });
  });
});

describe("onPersist", () => {
  it("should sync class", () => {
    class TestClass {
      @sync() count = signal(0);
    }

    const instance = new TestClass();
    const onPersist = vi.fn();

    syncClass(instance, { onPersist });

    instance.count.set(1);

    expect(onPersist).toHaveBeenCalledWith(new Set(["."]));
  });

  it("should multi persist", () => {
    class TestClass {
      @sync() count = signal(0);
      @sync() name = signal("test");
    }

    const instance = new TestClass();
    const onPersist = vi.fn();

    syncClass(instance, { onPersist });

    instance.count.set(1);
    instance.name.set("updated");

    expect(onPersist).toHaveBeenCalledWith(new Set(["."]));
  });

  it("should multi persist with object", () => {
    class TestClass {
      @sync() data = signal({ a: 1, b: 2 });
    }

    const instance = new TestClass();
    const onPersist = vi.fn();

    syncClass(instance, { onPersist });

    instance.data.mutate((obj) => {
      obj.a = 3;
    });

    expect(onPersist).toHaveBeenCalledWith(new Set(["."]));
  });

  it("should create new path for collection (shard)", () => {
    class NestedClass {
      @sync() value = signal(10);
    }

    class TestClass {
      @sync() nested = signal({});
    }

    const instance = new TestClass();
    const onPersist = vi.fn();

    syncClass(instance, { onPersist });

    const nested = new NestedClass();
    instance.nested.mutate((obj) => (obj["id"] = nested));

    expect(onPersist).toHaveBeenCalledWith(new Set(["nested.id"]));
  });

 
  it("should create new path for array collection (shard)", () => {
    class NestedClass {
      @sync() value = signal(10);
    }

    class TestClass {
      @sync() nested = signal([]);
    }

    const instance = new TestClass();
    const onPersist = vi.fn();

    syncClass(instance, { onPersist });

    const nested = new NestedClass();
    instance.nested.mutate(array => array.push(nested))

    expect(onPersist).toHaveBeenCalledWith(new Set(["nested.0"]));
  });

  it("not call", () => {
    class TestClass {
      @sync() count = signal(0);
    }

    const instance = new TestClass();
    const onPersist = vi.fn();

    syncClass(instance, { onPersist });

    expect(onPersist).not.toHaveBeenCalled();
  });

  it("should not call onSync when using @persist()", () => {
    class TestClass {
      @persist() data = signal("persisted");
    }

    const instance = new TestClass();
    const onSync = vi.fn();

    syncClass(instance, { onSync });

    instance.data.set("new value");

    expect(onSync).not.toHaveBeenCalled();
  });

  it("should call but not onPersist", () => {
    class TestClass {
      @sync({
        persist: false,
      })
      data = signal("hello");
    }

    const instance = new TestClass();
    const onSync = vi.fn();
    const onPersist = vi.fn();

    syncClass(instance, { onSync, onPersist });

    instance.data.set("world");

    expect(onSync).toHaveBeenCalledTimes(2);
    expect(onPersist).not.toHaveBeenCalled();
  });
});
