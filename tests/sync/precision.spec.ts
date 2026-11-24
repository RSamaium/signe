import { signal } from "@signe/reactive";
import { describe, expect, it } from "vitest";
import { roundToPrecision, sync, syncClass } from "../../packages/sync/src";

const track = (instance: any) => {
  const sent: Array<[string, any]> = [];
  const persisted: Array<[string, any]> = [];
  syncClass(instance, {
    onSync: (values) => { for (const e of values) sent.push(e); values.clear(); },
    onPersist: (values) => { for (const e of values) persisted.push(e); values.clear(); },
  });
  return { sent, persisted };
};

describe("roundToPrecision", () => {
  it("rounds numbers to the given decimals", () => {
    expect(roundToPrecision(12.345, 0)).toBe(12);
    expect(roundToPrecision(12.345, 1)).toBe(12.3);
    expect(roundToPrecision(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundToPrecision(1234, -2)).toBe(1200);
  });

  it("rounds numbers inside plain objects and arrays, and leaves other values", () => {
    expect(roundToPrecision({ x: 1.6, y: [2.4, "a"], n: null }, 0)).toEqual({ x: 2, y: [2, "a"], n: null });
    expect(roundToPrecision("1.5", 0)).toBe("1.5");
    expect(roundToPrecision(Infinity, 0)).toBe(Infinity);
    expect(roundToPrecision("$delete", 0)).toBe("$delete");
    expect(roundToPrecision(1.5, undefined)).toBe(1.5);
  });
});

describe("@sync({ precision })", () => {
  it("sends rounded values and persists exact ones", () => {
    class Player {
      @sync({ precision: 0 }) x = signal(1.2);
    }
    class Root {
      @sync(Player) players = signal<Record<string, Player>>({});
    }
    const root = new Root();
    const { sent, persisted } = track(root);
    const p = new Player();
    root.players.mutate((ps) => { ps.a = p; });
    sent.length = 0;
    persisted.length = 0;

    p.x.set(10.7);

    expect(sent).toEqual([["players.a.x", 11]]);
    expect(persisted).toEqual([["players.a.x", 10.7]]);
  });

  it("rounds the initial value", () => {
    class Root {
      @sync({ precision: 1 }) speed = signal(3.14159);
    }
    const root = new Root();
    const { sent } = track(root);
    expect(sent).toContainEqual(["speed", 3.1]);
  });

  it("does not send a change that keeps the same rounded value", () => {
    class Root {
      @sync({ precision: 0 }) x = signal(10);
    }
    const root = new Root();
    const { sent, persisted } = track(root);
    sent.length = 0;
    persisted.length = 0;

    root.x.set(10.2);
    root.x.set(10.4);
    expect(sent).toEqual([]);
    expect(persisted.map(([, v]) => v)).toEqual([10.2, 10.4]);

    root.x.set(10.6);
    expect(sent).toEqual([["x", 11]]);
  });

  it("sends a number again after a non-numeric value", () => {
    class Root {
      @sync({ precision: 0 }) value = signal<any>(5);
    }
    const root = new Root();
    const { sent } = track(root);
    sent.length = 0;

    root.value.set("a");
    root.value.set(5);
    expect(sent).toEqual([["value", "a"], ["value", 5]]);
  });

  it("applies transform first, then precision", () => {
    class Root {
      @sync({ transform: (v: number) => v * 10, precision: 0 }) ratio = signal(0.11);
    }
    const root = new Root();
    const { sent } = track(root);
    sent.length = 0;
    root.ratio.set(0.26);
    expect(sent).toEqual([["ratio", 3]]);
  });

  it("rounds numbers in object signals", () => {
    class Root {
      @sync({ precision: 0 }) pos = signal<Record<string, number>>({ x: 0 });
    }
    const root = new Root();
    const { sent } = track(root);
    sent.length = 0;

    root.pos().x = 4.6;
    root.pos.set({ x: 1.2, y: 7.7 });
    expect(sent).toEqual([["pos.x", 5], ["pos", { x: 1, y: 8 }]]);
  });

  it("does not change values without precision", () => {
    class Root {
      @sync() x = signal(0);
    }
    const root = new Root();
    const { sent } = track(root);
    sent.length = 0;
    root.x.set(1.23456);
    root.x.set(1.23457);
    expect(sent).toEqual([["x", 1.23456], ["x", 1.23457]]);
  });
});
