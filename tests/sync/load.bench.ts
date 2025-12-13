import { bench, describe } from "vitest";
import { signal } from "../../packages/reactive/src";
import { load, sync } from "../../packages/sync/src";

/**
 * Benchmark suite for testing the performance of the load function.
 * 
 * This benchmark tests various scenarios:
 * - Loading many simple properties
 * - Loading large collections
 * - Loading with deep nesting
 * - Comparing path-based vs object-based loading
 * - Loading large arrays
 * - Loading with multiple class instances
 * 
 * @example
 * Run with: pnpm test load.bench.ts
 */
describe("load function performance benchmarks", () => {
  describe("1. Simple property loading", () => {
    bench("load 100 simple properties (paths)", () => {
      class TestClass {
        @sync() prop0 = signal(0);
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 100; i++) {
        data[`prop${i}`] = i;
      }
      load(instance, data, true);
    });

    bench("load 1000 simple properties (paths)", () => {
      class TestClass {
        @sync() prop0 = signal(0);
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 1000; i++) {
        data[`prop${i}`] = i;
      }
      load(instance, data, true);
    });

    bench("load 10000 simple properties (paths)", () => {
      class TestClass {
        @sync() prop0 = signal(0);
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 10000; i++) {
        data[`prop${i}`] = i;
      }
      load(instance, data, true);
    });
  });

  describe("2. Collection loading", () => {
    bench("load 10 items in collection", () => {
      class Item {
        @sync() value = signal(0);
        @sync() name = signal("");
      }
      class TestClass {
        @sync(Item) items = signal({});
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 10; i++) {
        data[`item${i}`] = { value: i, name: `Item ${i}` };
      }
      load(instance, { items: data }, true);
    });

    bench("load 100 items in collection", () => {
      class Item {
        @sync() value = signal(0);
        @sync() name = signal("");
      }
      class TestClass {
        @sync(Item) items = signal({});
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 100; i++) {
        data[`item${i}`] = { value: i, name: `Item ${i}` };
      }
      load(instance, { items: data }, true);
    });

    bench("load 1000 items in collection", () => {
      class Item {
        @sync() value = signal(0);
        @sync() name = signal("");
      }
      class TestClass {
        @sync(Item) items = signal({});
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 1000; i++) {
        data[`item${i}`] = { value: i, name: `Item ${i}` };
      }
      load(instance, { items: data }, true);
    });
  });

  describe("3. Deep nesting performance", () => {
    bench("load with 3 levels of nesting", () => {
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
      const data: any = {};
      for (let a = 0; a < 5; a++) {
        for (let b = 0; b < 5; b++) {
          for (let c = 0; c < 5; c++) {
            data[`a${a}.level2.b${b}.level3.c${c}.value`] = a + b + c;
          }
        }
      }
      load(instance, data);
    });

    bench("load with 4 levels of nesting", () => {
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
      const data: any = {};
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          for (let c = 0; c < 3; c++) {
            for (let d = 0; d < 3; d++) {
              data[`a${a}.level2.b${b}.level3.c${c}.level4.d${d}.value`] = a + b + c + d;
            }
          }
        }
      }
      load(instance, data);
    });
  });

  describe("4. Path-based vs Object-based loading", () => {
    bench("load 100 properties using paths", () => {
      class TestClass {
        position = {
          x: signal(0),
          y: signal(0),
        };
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 100; i++) {
        data[`position.x`] = i;
        data[`position.y`] = i * 2;
      }
      load(instance, data);
    });

    bench("load 100 properties using object format", () => {
      class TestClass {
        position = {
          x: signal(0),
          y: signal(0),
        };
      }
      const instance = new TestClass();
      const data: any = {
        position: {
          x: 99,
          y: 198,
        },
      };
      load(instance, data, true);
    });
  });

  describe("5. Array loading", () => {
    bench("load array with 100 items", () => {
      class TestClass {
        items = signal([]);
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 100; i++) {
        data[i.toString()] = `item${i}`;
      }
      load(instance, { items: data }, true);
    });

    bench("load array with 1000 items", () => {
      class TestClass {
        items = signal([]);
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 1000; i++) {
        data[i.toString()] = `item${i}`;
      }
      load(instance, { items: data }, true);
    });

    bench("load array with 10000 items", () => {
      class TestClass {
        items = signal([]);
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 10000; i++) {
        data[i.toString()] = `item${i}`;
      }
      load(instance, { items: data }, true);
    });
  });

  describe("6. Complex nested structures", () => {
    bench("load complex game scene structure", () => {
      class GameObject {
        position = {
          x: signal(0),
          y: signal(0),
        };
        @sync() direction = signal(0);
        @sync() health = signal(100);
        @sync() graphics = signal([]);
      }

      class Scene {
        @sync(GameObject) users = signal({});
        @sync(GameObject) enemies = signal({});
      }

      const scene = new Scene();
      const data: any = {
        users: {},
        enemies: {},
      };

      for (let i = 0; i < 50; i++) {
        data.users[`player${i}`] = {
          position: { x: i * 10, y: i * 20 },
          direction: i * 5,
          health: 100,
          graphics: [`sprite${i}`],
        };
      }

      for (let i = 0; i < 50; i++) {
        data.enemies[`enemy${i}`] = {
          position: { x: i * 15, y: i * 25 },
          direction: i * 3,
          health: 50,
          graphics: [`enemySprite${i}`],
        };
      }

      load(scene, data, true);
    });

    bench("load deeply nested collection structure", () => {
      class Item {
        @sync() value = signal(0);
      }
      class Container {
        @sync(Item) items = signal({});
      }
      class Box {
        @sync(Container) containers = signal({});
      }
      class TestClass {
        @sync(Box) boxes = signal({});
      }

      const instance = new TestClass();
      const data: any = {};

      for (let box = 0; box < 10; box++) {
        for (let container = 0; container < 10; container++) {
          for (let item = 0; item < 10; item++) {
            data[`box${box}.containers.container${container}.items.item${item}.value`] =
              box + container + item;
          }
        }
      }

      load(instance, data);
    });
  });

  describe("7. Sequential loads", () => {
    bench("100 sequential loads of single property", () => {
      class TestClass {
        @sync() value = signal(0);
      }
      const instance = new TestClass();
      for (let i = 0; i < 100; i++) {
        load(instance, { value: i }, true);
      }
    });

    bench("100 sequential loads of collection updates", () => {
      class Item {
        @sync() value = signal(0);
      }
      class TestClass {
        @sync(Item) items = signal({});
      }
      const instance = new TestClass();

      for (let i = 0; i < 100; i++) {
        load(instance, { items: { item1: { value: i } } }, true);
      }
    });
  });

  describe("8. Mixed loading patterns", () => {
    bench("load mixed paths and objects", () => {
      class TestClass {
        @sync() a = signal(0);
        @sync() b = signal(0);
        position = {
          x: signal(0),
          y: signal(0),
        };
      }
      const instance = new TestClass();
      const data: any = {};
      for (let i = 0; i < 50; i++) {
        data[`a`] = i;
        data[`b`] = i * 2;
        data[`position.x`] = i * 10;
        data[`position.y`] = i * 20;
      }
      load(instance, data);
    });

    bench("load with partial updates", () => {
      class Item {
        @sync() a = signal(0);
        @sync() b = signal(0);
        @sync() c = signal(0);
      }
      class TestClass {
        @sync(Item) items = signal({});
      }
      const instance = new TestClass();

      // Initial load
      load(instance, {
        items: {
          item1: { a: 1, b: 2, c: 3 },
          item2: { a: 4, b: 5, c: 6 },
        },
      }, true);

      // 100 partial updates
      for (let i = 0; i < 100; i++) {
        load(instance, { items: { item1: { b: i } } }, true);
      }
    });
  });
});
