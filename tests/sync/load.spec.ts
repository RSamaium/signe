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

  it("should load values from an object with null values", () => {
    load(testInstance, {
        position: {
            x: null,
            y: 20,
        },
    }, true);
    expect(testInstance.position.x()).toBe(null);
    expect(testInstance.position.y()).toBe(20);
  });

  it("should handle undefined values", () => {
    load(testInstance, { 'position.x': undefined });
    expect(testInstance.position.x()).toBe(undefined);
  });

  it("should handle multiple nested levels", () => {
    const data = {
      position: {
        x: 100,
        y: 200
      },
      nested: {
        id: {
          value: 50
        }
      }
    };
    load(testInstance, data, true);
    expect(testInstance.position.x()).toBe(100);
    expect(testInstance.position.y()).toBe(200);
    expect(testInstance.nested()['id'].value()).toBe(50);
  });

  it("should handle array of paths", () => {
    load(testInstance, {
      'count': 5,
      'position.x': 15,
      'position.y': 25,
      'nested.id.value': 35
    });
    expect(testInstance.count()).toBe(5);
    expect(testInstance.position.x()).toBe(15);
    expect(testInstance.position.y()).toBe(25);
    expect(testInstance.nested()['id'].value()).toBe(35);
  });

  it("should handle overwriting existing values", () => {
    load(testInstance, { 'position.x': 10 });
    expect(testInstance.position.x()).toBe(10);
    
    load(testInstance, { 'position.x': 20 });
    expect(testInstance.position.x()).toBe(20);
  });

  it("should handle mixed object and path loading", () => {
    load(testInstance, { 'position.x': 10 });
    load(testInstance, { position: { y: 20 } }, true);
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