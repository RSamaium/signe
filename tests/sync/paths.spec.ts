import { describe, expect, it } from "vitest";
import { signal } from "@signe/reactive";
import { DELETE_TOKEN, id, load, sync, PathTable, PathTableDecoder } from "../../packages/sync/src";

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


/** Encodes a sync value like the server does, then parses it like the client. */
const encode = (table: PathTable, cursor: any, value: any) => {
  table.startPacket();
  const pairs = table.encode(value);
  return JSON.parse(`{"type":"sync",${table.header(cursor)}"p":[${pairs}]}`);
};

describe("path table format", () => {
  it("produces the same state and events as load() for a sequence of packets", () => {
    const a = new Root();
    const b = new Root();
    const eventsA = record(a);
    const eventsB = record(b);
    const table = new PathTable();
    const cursor = table.createCursor();
    const decoder = new PathTableDecoder();

    for (const packet of packets) {
      load(a, structuredClone(packet), true);
      decoder.apply(b, encode(table, cursor, packet));
      expect(snapshot(b)).toEqual(snapshot(a));
    }
    expect(eventsB).toEqual(eventsA);
  });

  it("matches for each packet applied to a fresh instance", () => {
    for (const packet of packets) {
      const a = new Root();
      const b = new Root();
      const table = new PathTable();
      load(a, structuredClone(packet), true);
      new PathTableDecoder().apply(b, encode(table, table.createCursor(), packet));
      expect(snapshot(b)).toEqual(snapshot(a));
    }
  });

  it("sends each definition once per client", () => {
    const table = new PathTable();
    const cursor = table.createCursor();
    const first = encode(table, cursor, { players: { p1: { x: 1, y: 2 } } });
    expect(first.d).toEqual([0, "players.p1.x", "players.p1.y"]);
    expect(first.p).toEqual([0, 1, 1, 2]);
    const second = encode(table, cursor, { players: { p1: { x: 3 }, p2: { x: 4 } } });
    expect(second.d).toEqual([2, "players.p2.x"]);
    expect(second.p).toEqual([0, 3, 2, 4]);
    expect(encode(table, cursor, { players: { p1: { x: 5 } } }).d).toBeUndefined();

    // A client that joins later gets every definition
    const late = table.createCursor();
    expect(encode(table, late, { players: { p1: { x: 6 } } }).d).toEqual([0, "players.p1.x", "players.p1.y", "players.p2.x"]);
  });

  it("keeps updating an entity deleted then created again with the same id", () => {
    const a = new Root();
    const b = new Root();
    const table = new PathTable();
    const cursor = table.createCursor();
    const decoder = new PathTableDecoder();
    const steps = [
      { players: { p1: { x: 1, name: "a" } } },
      { players: { p1: { x: 2 } } },
      { players: { p1: DELETE_TOKEN } },
      { players: { p1: { x: 3, name: "b" } } },
      { players: { p1: { x: 4 } } },
    ];
    for (const step of steps) {
      load(a, structuredClone(step), true);
      decoder.apply(b, encode(table, cursor, step));
    }
    expect(snapshot(b)).toEqual(snapshot(a));
    expect((b.players() as any).p1.x()).toBe(4);
  });

  it("follows an entity replaced by another load()", () => {
    const b = new Root();
    const table = new PathTable();
    const cursor = table.createCursor();
    const decoder = new PathTableDecoder();
    decoder.apply(b, encode(table, cursor, { players: { p1: { x: 1 } } }));
    decoder.apply(b, encode(table, cursor, { players: { p1: { x: 2 } } }));
    // The state is replaced outside the decoder (for example a full snapshot)
    load(b, { players: { p1: DELETE_TOKEN } }, true);
    load(b, { players: { p1: { x: 10 } } }, true);
    decoder.apply(b, encode(table, cursor, { players: { p1: { x: 11 } } }));
    expect((b.players() as any).p1.x()).toBe(11);
  });

  it("starts a new table when the limit is reached", () => {
    const b = new Root();
    const table = new PathTable(3);
    const cursor = table.createCursor();
    const decoder = new PathTableDecoder();
    decoder.apply(b, encode(table, cursor, { players: { p1: { x: 1, y: 1 }, p2: { x: 2 } } }));
    const packet = encode(table, cursor, { players: { p3: { x: 3 }, p1: { x: 4 } } });
    expect(packet.r).toBe(1);
    expect(packet.d).toEqual([0, "players.p3.x", "players.p1.x"]);
    decoder.apply(b, packet);
    expect((b.players() as any).p3.x()).toBe(3);
    expect((b.players() as any).p1.x()).toBe(4);
    expect((b.players() as any).p2.x()).toBe(2);
  });

  it("encodes values like JSON.stringify", () => {
    const table = new PathTable();
    const packet = encode(table, table.createCursor(), {
      a: NaN, b: Infinity, c: -0, d: 1.5e-7, e: "x\"y", f: [1, { g: 2 }], h: null, i: undefined, j: true,
    });
    const values = Object.fromEntries(packet.d.slice(1).map((path: string, i: number) => [path, packet.p[i * 2 + 1]]));
    expect(values).toEqual(JSON.parse(JSON.stringify({ a: NaN, b: Infinity, c: -0, d: 1.5e-7, e: "x\"y", f: [1, { g: 2 }], h: null, j: true })));
  });
});
