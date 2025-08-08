import { signal, computed } from "@signe/reactive";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStatesSnapshot,
  persist,
  sync,
  syncClass,
} from "../../packages/sync/src";

describe("onSync", () => {
  it("should sync class", () => {
    class TestClass {
      @sync() count = signal(0);
    }

    const instance = new TestClass();
    const onSync = vi.fn();

    syncClass(instance, { onSync });

    expect(onSync).toHaveBeenCalledWith(new Map<string, any>([["count", 0]]));
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

    expect(onSync).toHaveBeenCalledWith(new Map<string, any>([["nested", {}]]));
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
    expect(onSync).toHaveBeenCalledWith(new Map<string, any>([["count", 1]]));
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
      new Map<string, any>([
        ["count", 1],
        ["name", "updated"],
      ])
    );
  });

  it("should sync computed properties", () => {
    class TestClass {
      @sync() count = signal(0);
      @sync() name = signal("test");
      @sync() fullDescription = computed(() => `${this.name()}-${this.count()}`);
    }

    const instance = new TestClass();
    const onSync = vi.fn();

    syncClass(instance, { onSync });

    // Initial sync should include the computed value
    expect(onSync).toHaveBeenCalledWith(
      new Map<string, any>([
        ["count", 0],
        ["name", "test"],
        ["fullDescription", "test-0"],
      ])
    );

    // Update signals that affect the computed value
    instance.count.set(5);
    
    // Check that the computed property was synced with updated value
    expect(onSync).toHaveBeenCalledWith(
      new Map<string, any>([
        ["count", 5],
        ["name", "test"],
        ["fullDescription", "test-5"],
      ])
    );

    // Update another dependency
    instance.name.set("new");
    
    // Check that the computed property was synced with updated value
    expect(onSync).toHaveBeenCalledWith(
      new Map<string, any>([
        ["count", 5],
        ["name", "new"],
        ["fullDescription", "new-5"],
      ])
    );
  });

  it("should sync computed properties with nested dependencies", () => {
    class NestedClass {
      @sync() value = signal(10);
      @sync() name = signal("nested");
    }

    class TestClass {
      @sync(NestedClass) nested = signal<NestedClass>({} as NestedClass);
      @sync() counter = signal(1);
      @sync() nestedSummary = computed(() => {
        const nestedObj = this.nested();
        return `${nestedObj.name?.()}-${nestedObj?.value?.() ?? ''} (counter: ${this.counter()})`;
      });
    }

    const instance = new TestClass();
    const onSync = vi.fn();

    syncClass(instance, { onSync });

    instance.nested.set(new NestedClass())
    
    const nestedObj = instance.nested();
    nestedObj.value.set(20);
    
    // Check that the computed property was synced with updated nested value
    expect(onSync).toHaveBeenCalledWith(
      expect.objectContaining(new Map<string, any>([
        ["nestedSummary", "nested-20 (counter: 1)"],
      ]))
    );

    // Update another nested property
    nestedObj.name.set("updated");
    
    // Check that the computed property was synced with all updated values
    expect(onSync).toHaveBeenCalledWith(
      expect.objectContaining(new Map<string, any>([
        ["nestedSummary", "updated-20 (counter: 1)"],
      ]))
    );

    // Update parent property
    instance.counter.set(5);
    
    // Check that the computed property was synced with parent property update
    expect(onSync).toHaveBeenCalledWith(
      expect.objectContaining(new Map<string, any>([
        ["nestedSummary", "updated-20 (counter: 5)"],
      ]))
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
        new Map<string, any>([
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
        new Map<string, any>([
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
        new Map<string, any>([
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
        new Map<string, any>([
          ["data", { nested: {} }],
          ["data.nested.value", 10]
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
        new Map<string, any>([
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
        new Map<string, any>([
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
        new Map<string, any>([
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
        new Map<string, any>([
          ["data", {}],
          ["data.0.value", 10],
        ])
      );
    });
  });

  it("should sync Question class with id and text", () => {
    class Question {
      @sync() text = signal("");
    }

    class Room {
      @sync(Question) currentQuestion = signal({} as Question);
    }

    const room = new Room();
    const onSync = vi.fn();

    syncClass(room, { onSync });

    const question = new Question();
    question.text.set("What is your name?");

    room.currentQuestion.set(question);

    expect(onSync).toHaveBeenCalledWith(
      new Map<string, any>([
        ["currentQuestion", {}],
        ["currentQuestion.text", "What is your name?"],
      ])
    );
  });

  it("should sync array of Question class", () => {
    class Question {
      @sync() text = signal("");
    }

    class Room {
      @sync(Question) questions = signal([] as Question[]);
    }

    const room = new Room();
    const onSync = vi.fn();

    syncClass(room, { onSync });

    const question = new Question();
    question.text.set("What is your name?");

    room.questions.set([question, question]);

    expect(onSync).toHaveBeenCalledTimes(3);
    expect(onSync).toHaveBeenCalledWith(
      new Map<string, any>([
        ["questions", {}],
        ["questions.0.text", "What is your name?"],
        ["questions.1.text", "What is your name?"],
      ])
    );
  });

  it("should sync object with signal properties", () => {
    class TestClass {
      @sync() count = signal(0);
      @sync() address = {
        city: signal("Paris"),
        country: signal("France")
      };
      @sync() fullInfo = computed(() => `${this.count()} - ${this.address.city()}, ${this.address.country()}`);
    }

    const instance = new TestClass();
    const onSync = vi.fn();

    syncClass(instance, { onSync });
    
    expect(onSync).toHaveBeenCalledWith(
      expect.objectContaining(new Map<string, any>([
        ["count", 0],
        ["address.city", "Paris"],
        ["address.country", "France"],
        ["fullInfo", "0 - Paris, France"]
      ]))
    );

    instance.address.city.set("London");
    
    expect(onSync).toHaveBeenCalledWith(
      expect.objectContaining(new Map<string, any>([
        ["address.city", "London"],
        ["fullInfo", "0 - London, France"]
      ]))
    );

    instance.count.set(5);
    
    expect(onSync).toHaveBeenCalledWith(
      expect.objectContaining(new Map<string, any>([
        ["count", 5],
        ["fullInfo", "5 - London, France"]
      ]))
    );
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

    expect(onPersist).toHaveBeenCalledWith(new Map<string, any>([[".", 1]]));
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

    expect(onPersist).toHaveBeenCalledWith(new Map<string, any>([[
      ".", 'updated'
    ]]));
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

    expect(onPersist).toHaveBeenCalledWith(new Map<string, any>([[
      ".", 3
    ]]));
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

    expect(onPersist).toHaveBeenCalledWith(new Map<string, any>([["nested.id", 10]]));
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
    instance.nested.mutate((array) => array.push(nested));

    expect(onPersist).toHaveBeenCalledWith(new Map<string, any>([["nested.0", 10]]));
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

describe("createStatesSnapshot", () => {
  it("should return an empty object if instance.$snapshot is not defined", () => {
    class TestClass {
      count = signal(0);
      text = signal("hello");
    }

    const instance = new TestClass();

    syncClass(instance);

    const result = createStatesSnapshot(instance);
    expect(result).toEqual({});
  });

  it("should persist primitive values with sync decorator", () => {
    class TestClass {
      @sync() count = signal(0);
      @sync() text = signal("hello");
    }

    const instance = new TestClass();

    syncClass(instance);

    const result = createStatesSnapshot(instance);
    
    expect(result).toEqual({
      count: 0,
      text: "hello",
    });
  });

  it("should not persist values with persist option set to false", () => {
    class TestClass {
      @sync({ persist: false }) count = signal(0);
      text = signal("hello");
    }

    const instance = new TestClass();

    syncClass(instance);

    const result = createStatesSnapshot(instance);
    expect(result).toEqual({});
  });

  it("should not persist non-primitive values", () => {
    class TestClass {
      @sync() count = signal({ a: 1 });
      @sync() text = signal([1, 2, 3]);
    }

    const instance = new TestClass();
    syncClass(instance);

    const result = createStatesSnapshot(instance);
    expect(result).toEqual({});
  });
});
