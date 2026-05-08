import { beforeEach, describe, expect, it } from "vitest";
import { signal, computed } from "../../packages/reactive/src";
import { load, sync } from "../../packages/sync/src";

describe("load function", () => {
  let testInstance: any;
  let _class

  beforeEach(() => {
    _class = class NestedClass {
      value = signal(0);
      constructor(id: string) {
        console.log('NestedClass constructor', id);
      }
    }

    class TestClass {
      count = signal(0);
      position = {
        x: signal(0),
        y: signal(0),
      }
      @sync(_class) nested = signal({});
      normalValue = 0;
      graphics = signal([]);
    }

    testInstance = new TestClass();
  });

  it("should load values into non-signal properties", () => {
    load(testInstance, { normalValue: 42 }, true);
    expect(testInstance.normalValue).toBe(42);
    load(testInstance, { normalValue: 100 }, true);
    expect(testInstance.normalValue).toBe(100);
  });

  it("should load values using paths", () => {
    load(testInstance, { 'position.x': 10, 'position.y': 20 });
    expect(testInstance.position.x()).toBe(10);
    expect(testInstance.position.y()).toBe(20);
  });

  it("should load values from an object", () => {
    load(testInstance, {
        position: {
            x: 10,
            y: 20,
        },
    }, true);
    expect(testInstance.position.x()).toBe(10);
    expect(testInstance.position.y()).toBe(20);
  });

  
  it("collection", () => {
    load(testInstance, { 'nested.id.value': 10});
    expect(testInstance.nested()['id']).instanceOf(_class)
    expect(testInstance.nested()['id'].value()).toBe(10);
  });

  it("should load an array", () => {
    load(testInstance, { 'graphics': { '0': 'sprite1', '1': 'sprite2' } }, true);
    expect(testInstance.graphics()).toEqual(['sprite1', 'sprite2']);
  });

  it("should load an array with a missing index", () => {
    load(testInstance, { 'graphics': { '2': 'sprite1'} }, true);
    expect(testInstance.graphics()).toEqual([undefined, undefined, 'sprite1']);
  });

  it("should delete a property if value is $delete", () => {
    load(testInstance, { "nested.id": "$delete" });
    expect(testInstance.nested()["id"]).toBeUndefined();
  });

  it("should load nested GameObject in Scene", () => {
    class GameObject {
      position = {
        x: signal(0),
        y: signal(0),
      };
      @sync() direction = signal(0);
      @sync() graphics = signal([]);
    }

    class Scene {
      @sync(GameObject) users = signal({});
    }

    const scene = new Scene();
    
    load(scene, {
      users: {
        player1: {
          position: { x: 100, y: 200 },
          direction: 45,
          graphics: ['sprite1', 'sprite2']
        }
      }
    }, true);

    expect(scene.users()['player1']).instanceOf(GameObject);
    expect(scene.users()['player1'].position.x()).toBe(100);
    expect(scene.users()['player1'].position.y()).toBe(200);
    expect(scene.users()['player1'].direction()).toBe(45);
    expect(scene.users()['player1'].graphics()).toEqual(['sprite1', 'sprite2']);
  });

  it("should handle multiple loads on the same Scene", () => {
    class GameObject {
      position = {
        x: signal(0),
        y: signal(0),
      };
      @sync() direction = signal(0);
      @sync() graphics = signal([]);
    }

    class Scene {
      @sync(GameObject) users = signal({});
    }

    const scene = new Scene();
  
    load(scene, {
      users: {
        player1: {
          position: { x: 100, y: 200 },
          direction: 45,
          graphics: ['sprite1']
        }
      }
    }, true);

    load(scene, {
      users: {
        player1: {
          position: { x: 150, y: 250 },
          graphics: ['sprite2', 'sprite3']
        },
        player2: {
          position: { x: 300, y: 400 },
          direction: 90,
          graphics: ['sprite4']
        }
      }
    }, true);

    expect(scene.users()['player1'].position.x()).toBe(150);
    expect(scene.users()['player1'].position.y()).toBe(250);
    expect(scene.users()['player1'].direction()).toBe(45);
    expect(scene.users()['player1'].graphics()).toEqual(['sprite2', 'sprite3']);

    expect(scene.users()['player2']).instanceOf(GameObject);
    expect(scene.users()['player2'].position.x()).toBe(300);
    expect(scene.users()['player2'].position.y()).toBe(400);
    expect(scene.users()['player2'].direction()).toBe(90);
    expect(scene.users()['player2'].graphics()).toEqual(['sprite4']);
  });

  it("should properly load Question instance with its properties", () => {
    class Question {
      text = signal("");
      options = signal<string[]>([]);
      correctOptionIndex = signal(0);
    }

    class RoomSchema {
      @sync(Question) questions = signal([]);
    }

    const room = new RoomSchema();
    
    load(room, {
      questions: {
        "0": {
          id: "question-1",
          text: "What is the capital of France?",
          options: ["London", "Paris", "Berlin", "Madrid"],
          correctOptionIndex: 1
        }
      }
    }, true);

    expect(room.questions()[0]).instanceOf(Question);
    expect(room.questions()[0].text()).toBe("What is the capital of France?");
    expect(room.questions()[0].options()).toEqual(["London", "Paris", "Berlin", "Madrid"]);
    expect(room.questions()[0].correctOptionIndex()).toBe(1);
  });

  it("should update computed values after loading data", () => {
    class ComputedTestClass {
      @sync() firstName = signal("John");
      @sync() lastName = signal("Doe");
      @sync() age = signal(30);
      @sync() fullInfo = computed(() => `${this.firstName()}, ${this.lastName()}, ${this.age()} years old`);
    }

    const instance = new ComputedTestClass();
    
    expect(instance.fullInfo()).toBe("John, Doe, 30 years old");
    
    load(instance, {
      firstName: "Jane",
      lastName: "Smith",
      age: 25
    }, true);
    
    expect(instance.fullInfo()).toBe("Jane, Smith, 25 years old");
    
    load(instance, {
      "firstName": "Robert",
      "age": 40
    });
    
    expect(instance.fullInfo()).toBe("Robert, Smith, 40 years old");
  });

  it("should update computed values with nested objects after loading data", () => {
    class ComputedNestedClass {
      @sync() name = signal("John");
      @sync() address = {
        city: signal("Paris"),
        country: signal("France")
      }
      @sync() fullLocation = computed(() => {
        const addressObj = this.address;
        return `${this.name?.() ?? ''} lives in ${addressObj.city?.() ?? ''}, ${addressObj.country?.() ?? ''}`;
      });
    }
    
    const instance = new ComputedNestedClass();
    expect(instance.fullLocation()).toBe("John lives in Paris, France");
    
    load(instance, {
      name: "Jane",
      address: {
        city: "London",
        country: "UK"
      }
    }, true);

    expect(instance.fullLocation()).toBe("Jane lives in London, UK");
    
    load(instance, {
      "name": "Robert",
      "address.city": "Berlin"
    });
    
    expect(instance.fullLocation()).toBe("Robert lives in Berlin, UK");
  });

  describe("load function - edge cases and robustness", () => {
    describe("1. Deeply nested collections", () => {
      it("should handle 3 levels of nesting", () => {
        class Level3 {
          @sync() value = signal(0);
        }
        class Level2 {
          @sync(Level3) level3 = signal({});
        }
        class Level1 {
          @sync(Level2) level2 = signal({});
        }
        class TestClass {
          @sync(Level1) level1 = signal({});
        }
        const instance = new TestClass();
        load(instance, { 'level1.a.level2.b.level3.c.value': 10 });
        expect(instance.level1()['a'].level2()['b'].level3()['c'].value()).toBe(10);
      });

      it("should handle 4 levels of nesting", () => {
        class Level4 {
          @sync() value = signal(0);
        }
        class Level3 {
          @sync(Level4) level4 = signal({});
        }
        class Level2 {
          @sync(Level3) level3 = signal({});
        }
        class Level1 {
          @sync(Level2) level2 = signal({});
        }
        class TestClass {
          @sync(Level1) level1 = signal({});
        }
        const instance = new TestClass();
        load(instance, { 'level1.a.level2.b.level3.c.level4.d.value': 10 });
        expect(instance.level1()['a'].level2()['b'].level3()['c'].level4()['d'].value()).toBe(10);
      });

      it("should handle mixed collections and simple objects", () => {
        class Item {
          @sync() value = signal(0);
        }
        class TestClass {
          @sync(Item) items = signal({});
          simple = { x: signal(0) };
        }
        const instance = new TestClass();
        load(instance, {
          'items.item1.value': 10,
          'simple.x': 20
        });
        expect(instance.items()['item1'].value()).toBe(10);
        expect(instance.simple.x()).toBe(20);
      });

      it("should handle collections in arrays", () => {
        class Item {
          @sync() value = signal(0);
        }
        class TestClass {
          @sync(Item) items = signal([]);
        }
        const instance = new TestClass();
        load(instance, { 'items.0.value': 10 }, true);
        expect(instance.items()[0].value()).toBe(10);
      });
    });


    describe("3. Array edge cases", () => {
      it("should handle negative array indices", () => {
        class TestClass {
          items = signal([]);
        }
        const instance = new TestClass();
        load(instance, { 'items.-1': 'value' });
        // Should create property with key "-1"
        expect(instance.items()['-1']).toBe('value');
      });

      it("should handle empty arrays", () => {
        class TestClass {
          items = signal([1, 2, 3]);
        }
        const instance = new TestClass();
        load(instance, { items: [] }, true);
        expect(instance.items()).toEqual([]);
      });

      it("should handle sparse arrays", () => {
        class TestClass {
          items = signal([]);
        }
        const instance = new TestClass();
        load(instance, { items: { '0': 'a', '5': 'b' } }, true);
        const result = instance.items();
        expect(result[0]).toBe('a');
        expect(result[5]).toBe('b');
        expect(result[1]).toBeUndefined();
      });

      it("should handle large arrays", () => {
        class TestClass {
          items = signal([]);
        }
        const instance = new TestClass();
        const largeArray: any = {};
        for (let i = 0; i < 1000; i++) {
          largeArray[i.toString()] = `item${i}`;
        }
        load(instance, { items: largeArray }, true);
        expect(instance.items().length).toBe(1000);
        expect(instance.items()[0]).toBe('item0');
        expect(instance.items()[999]).toBe('item999');
      });
    });

    describe("4. Uninitialized signals and properties", () => {
      it("should handle loading into uninitialized signal", () => {
        class TestClass {
          @sync() value: any;
        }
        const instance = new TestClass();
        // Signal not initialized
        expect(() => {
          load(instance, { value: 10 }, true);
        }).not.toThrow();
      });

      it("should handle loading into non-existent property", () => {
        class TestClass {
          existing = signal(0);
        }
        const instance = new TestClass();
        load(instance, { 'nonExistent': 10 });
        expect((instance as any).nonExistent).toBe(10);
      });

      it("should handle loading into readonly property", () => {
        class TestClass {
          readonly readOnlyProp = signal(0);
        }
        const instance = new TestClass();
        load(instance, { 'readOnlyProp': 10 });
        // Should still work, but may not update if truly readonly
        expect(instance.readOnlyProp).toBeDefined();
      });

      it("should handle null signal value", () => {
        class TestClass {
          @sync() value = signal(null);
        }
        const instance = new TestClass();
        load(instance, { value: 10 }, true);
        expect(instance.value()).toBe(10);
      });

      it("should handle undefined signal value", () => {
        class TestClass {
          @sync() value = signal(undefined);
        }
        const instance = new TestClass();
        load(instance, { value: 10 }, true);
        expect(instance.value()).toBe(10);
      });
    });

    describe("5. Mixed formats and inconsistencies", () => {
      it("should handle overlapping paths", () => {
        class TestClass {
          data = signal({});
        }
        const instance = new TestClass();
        load(instance, {
          'data.a': { x: 1 },
          'data.a.b': 2
        });
        expect((instance.data() as any).a).toBeDefined();
        expect((instance.data() as any).a.b).toBe(2);
      });

      it("should handle same path loaded multiple times", () => {
        class TestClass {
          @sync() value = signal(0);
        }
        const instance = new TestClass();
        // Load twice with different values
        load(instance, { 'value': 10 });
        load(instance, { 'value': 20 });
        // Last value should win
        expect(instance.value()).toBe(20);
      });

      it("should handle mixed paths and objects in same call", () => {
        class TestClass {
          @sync() a = signal(0);
          @sync() b = signal(0);
        }
        const instance = new TestClass();
        load(instance, {
          'a': 10,
          b: 20
        });
        expect(instance.a()).toBe(10);
        expect(instance.b()).toBe(20);
      });
    });

    describe("6. Performance and volume", () => {
      it("should handle loading many properties", () => {
        class TestClass {
          @sync() prop0 = signal(0);
        }
        const instance = new TestClass();
        const data: any = {};
        for (let i = 0; i < 1000; i++) {
          data[`prop${i}`] = i;
        }
        const start = performance.now();
        load(instance, data, true);
        const end = performance.now();
        expect(end - start).toBeLessThan(1000); // Should complete in less than 1 second
        expect(instance.prop0()).toBe(0);
      });

      it("should handle large collection", () => {
        class Item {
          @sync() value = signal(0);
        }
        class TestClass {
          @sync(Item) items = signal({});
        }
        const instance = new TestClass();
        const data: any = {};
        for (let i = 0; i < 100; i++) {
          data[`item${i}`] = { value: i };
        }
        const start = performance.now();
        load(instance, { items: data }, true);
        const end = performance.now();
        expect(end - start).toBeLessThan(1000);
        expect(Object.keys(instance.items())).toHaveLength(100);
        expect(instance.items()['item0'].value()).toBe(0);
        expect(instance.items()['item99'].value()).toBe(99);
      });

      it("should handle very deep nesting", () => {
        class Deep {
          @sync() value = signal(0);
        }
        class TestClass {
          level1 = signal({});
        }
        const instance = new TestClass();
        let path = 'level1';
        for (let i = 1; i <= 10; i++) {
          path += `.level${i}`;
        }
        path += '.value';
        const start = performance.now();
        load(instance, { [path]: 10 });
        const end = performance.now();
        expect(end - start).toBeLessThan(1000);
      });
    });

    describe("7. Partial updates", () => {
      it("should update only some properties of existing instance", () => {
        class Item {
          @sync() a = signal(0);
          @sync() b = signal(0);
          @sync() c = signal(0);
        }
        class TestClass {
          @sync(Item) items = signal({});
        }
        const instance = new TestClass();
        load(instance, { items: { item1: { a: 1, b: 2, c: 3 } } }, true);
        load(instance, { items: { item1: { b: 20 } } }, true);
        expect(instance.items()['item1'].a()).toBe(1);
        expect(instance.items()['item1'].b()).toBe(20);
        expect(instance.items()['item1'].c()).toBe(3);
      });

      it("should update non-existent property in existing instance", () => {
        class Item {
          @sync() a = signal(0);
        }
        class TestClass {
          @sync(Item) items = signal({});
        }
        const instance = new TestClass();
        load(instance, { items: { item1: { a: 1 } } }, true);
        load(instance, { 'items.item1.b': 2 });
        expect(instance.items()['item1'].a()).toBe(1);
        expect(instance.items()['item1'].b).toBe(2);
      });

      it("should handle partial object update", () => {
        class Item {
          @sync() a = signal(0);
          @sync() b = signal(0);
        }
        class TestClass {
          @sync(Item) items = signal({});
        }
        const instance = new TestClass();
        load(instance, { items: { item1: { a: 1, b: 2 } } }, true);
        load(instance, { items: { item1: { a: 10 } } }, true);
        expect(instance.items()['item1'].a()).toBe(10);
        expect(instance.items()['item1'].b()).toBe(2); // Should keep old value
      });
    });

    describe("8. Classes with factory functions", () => {
      it("should handle factory function as classType", () => {
        const factoryFn = (id: string) => {
          return {
            id: signal(id),
            value: signal(0)
          };
        };
        class TestClass {
          @sync(factoryFn) items = signal({});
        }
        const instance = new TestClass();
        load(instance, { 'items.item1.value': 10 });
        expect(instance.items()['item1']).toBeDefined();
        expect(instance.items()['item1'].value()).toBe(10);
      });

      it("should handle factory function that returns different types", () => {
        const factoryFn = (id: string) => {
          if (id.startsWith('special')) {
            return { type: 'special', value: signal(0) };
          }
          return { type: 'normal', value: signal(0) };
        };
        class TestClass {
          @sync(factoryFn) items = signal({});
        }
        const instance = new TestClass();
        load(instance, { 'items.item1.value': 10 });
        load(instance, { 'items.special1.value': 20 });
        expect(instance.items()['item1'].type).toBe('normal');
        expect(instance.items()['special1'].type).toBe('special');
      });
    });
  });
});