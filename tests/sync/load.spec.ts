import { beforeEach, describe, expect, it } from "vitest";
import { signal } from "../../packages/reactive/src";
import { load, sync } from "../../packages/sync/src";

describe("load function", () => {
  let testInstance: any;
  let _class

  beforeEach(() => {
    _class = class NestedClass {
      value = signal(0);
    }

    class TestClass {
      count = signal(0);
      position = {
        x: signal(0),
        y: signal(0),
      }
      @sync(_class) nested = signal({});
    }

    testInstance = new TestClass();
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

  it("should delete a property if value is $delete", () => {
    load(testInstance, { "nested.id": "$delete" });
    expect(testInstance.nested()["id"]).toBeUndefined();
  });
});