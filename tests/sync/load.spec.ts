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
      normalValue = 0;
    }

    testInstance = new TestClass();
  });

  it("should load values into non-signal properties", () => {
    load(testInstance, { normalValue: 42 }, true);
    expect(testInstance.normalValue).toBe(42);

    // Vérifier que ça fonctionne aussi avec un deuxième chargement
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
});