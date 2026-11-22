import { describe, expect, it } from "vitest";
import { signal } from "@signe/reactive";
import { DELETE_TOKEN, id, load, sync } from "../../packages/sync/src";
import { load as referenceLoad } from "./fixtures/load-reference";

class Item {
  @id() id = signal("");
  @sync() value = signal(0);
  @sync() tags = signal<string[]>([]);
}

class Player {
  @id() id = signal("");
  @sync() x = signal(0);
  @sync() y = signal(0);
  @sync() name = signal("");
  @sync() stats = signal<Record<string, number>>({ hp: 100 });
  @sync(Item) inventory = signal<Record<string, Item>>({});
}

class Root {
  @sync() count = signal(0);
  @sync(Player) players = signal<Record<string, Player>>({});
  @sync(Item) list = signal<Item[]>([]);
  @sync() meta = signal<Record<string, any>>({});
  plain: any = { nested: { a: 1 } };
}

/** Serializes the whole instance tree, unwrapping signals. */
const snapshot = (value: any, seen = new WeakSet()): any => {
  if (typeof value === "function" && value.observable) return snapshot(value(), seen);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[cycle]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => snapshot(v, seen));
  const out: Record<string, any> = {};
  for (const key of Object.keys(value)) {
    if (key.startsWith("$")) continue;
    out[key.startsWith("__") ? key.slice(2) : key] = snapshot(value[key], seen);
  }
  return { __class: value.constructor?.name, ...out };
};

/** Records every event emitted by the root signals, in order. */
const record = (root: Root) => {
  const events: string[] = [];
  for (const key of ["count", "players", "list", "meta"] as const) {
    (root as any)[key].observable.subscribe((e: any) => events.push(key + ":" + JSON.stringify(snapshot(e))));
  }
  return events;
};

const packets: any[] = [
  { count: 3 },
  { players: { p1: { x: 1, y: 2, name: "a" } } },
  { players: { p1: { x: 5 }, p2: { x: 7, stats: { hp: 50, mp: 10 } } } },
  { players: { p1: { inventory: { sword: { value: 3, tags: ["sharp"] } } } } },
  { players: { p2: DELETE_TOKEN } },
  { players: { p1: { stats: { hp: DELETE_TOKEN } } } },
  { list: { "0": { value: 1 }, "2": { value: 3 } } },
  { "list.1.value": 9 },
  { "players.p3.x": 4, meta: { deep: { deeper: { leaf: true } } } },
  { meta: { arr: [1, 2, { a: 1 }], empty: {} } },
  { players: { p4: {} } },
  { plain: { nested: { b: 2 } }, newPlain: { c: { d: 1 } } },
  { count: DELETE_TOKEN },
  { players: { p1: { x: 0, y: 0 } }, count: 0 },
];

describe("load(): single-walk rewrite matches the previous implementation", () => {
  it("produces the same state and the same events for a sequence of packets", () => {
    const a = new Root();
    const b = new Root();
    const eventsA = record(a);
    const eventsB = record(b);

    for (const packet of packets) {
      referenceLoad(a, structuredClone(packet), true);
      load(b, structuredClone(packet), true);
      expect(snapshot(b)).toEqual(snapshot(a));
    }
    expect(eventsB).toEqual(eventsA);
  });

  it("matches for each packet applied to a fresh instance", () => {
    for (const packet of packets) {
      const a = new Root();
      const b = new Root();
      referenceLoad(a, structuredClone(packet), true);
      load(b, structuredClone(packet), true);
      expect(snapshot(b)).toEqual(snapshot(a));
    }
  });

  it("matches in path mode", () => {
    const a = new Root();
    const b = new Root();
    const paths = { "players.p1.x": 3, "players.p1.stats.hp": 7, "list.0.value": 2, count: 5, "meta.k": "v" };
    referenceLoad(a, paths);
    load(b, paths);
    expect(snapshot(b)).toEqual(snapshot(a));
  });
});
