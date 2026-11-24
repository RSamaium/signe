import { batch, isSignal } from "@signe/reactive";
import { DELETE_TOKEN } from "./core";
import { getStructureVersion, loadPathParts } from "./load";

/**
 * Path table format of sync packets.
 *
 * Instead of a nested object (`{"players":{"p1":{"x":10}}}`), a sync packet carries a flat
 * list of `[pathId, value, pathId, value, ...]`. Each path (`"players.p1.x"`) gets a number
 * the first time it is sent, and its definition is sent once to each client:
 *
 * ```json
 * {"type":"sync","d":[12,"players.p1.x","players.p1.y"],"p":[12,10,13,20]}
 * ```
 *
 * - `p`: pairs of path id and value. A value is applied like `load()` applies it (`"$delete"`
 *   deletes, an array is a value, an object is never sent: its fields are flattened).
 * - `d`: path definitions, `[firstId, path, path, ...]`, sent before the ids are used.
 * - `r`: `1` when the client must forget its table first (the server started a new one).
 *
 * The client parses a flat array instead of one object per entity, and applies each value
 * to the signal it found for this path the last time, without walking the state again.
 */
export const PATH_FORMAT_QUERY_PARAM = "format";
export const PATH_FORMAT_QUERY_VALUE = "paths";

/** Position of a client in the path table: what it already knows. */
export interface PathTableCursor {
  epoch: number;
  known: number;
}

function encodeValue(value: any): string {
  if (typeof value === "number") {
    // Same output as JSON.stringify for numbers, without the call
    return Number.isFinite(value) ? "" + value : "null";
  }
  return JSON.stringify(value);
}

/**
 * Server side: gives a number to each path and encodes sync values as pairs.
 *
 * One table is shared by all the clients of a room, so a packet encoded once can be sent to
 * every client; only the definitions they miss differ (see {@link PathTable.header}).
 * When the table holds more than `limit` paths, it starts over (clients are told with `r`).
 *
 * @example
 * const table = new PathTable();
 * const pairs = table.encode(packet.value); // "0,10,1,20"
 * const data = `{"type":"sync",${table.header(cursor)}"p":[${pairs}]}`;
 */
interface PathNode {
  /** Id of the path ending here, once sent as a value. */
  id: number;
  path: string;
  children: Map<string, PathNode> | undefined;
}

function createNode(path: string): PathNode {
  return { id: -1, path, children: undefined };
}

/**
 * Server side: gives a number to each path and encodes sync values as pairs.
 *
 * One table is shared by all the clients of a room, so a packet encoded once can be sent to
 * every client; only the definitions they miss differ (see {@link PathTable.header}).
 * When the table holds more than `limit` paths, it starts over (clients are told with `r`).
 *
 * Paths are stored as a tree of keys, so encoding a known path builds no string.
 *
 * @example
 * const table = new PathTable();
 * table.startPacket();
 * const pairs = table.encode(packet.value); // "0,10,1,20"
 * const data = `{"type":"sync",${table.header(cursor)}"p":[${pairs}]}`;
 */
export class PathTable {
  private root: PathNode = createNode("");
  private paths: string[] = [];
  private epoch = 0;
  /** Serialized definitions from a given id, shared while the table does not grow. */
  private definitionCache = new Map<number, string>();
  private definitionCacheSize = 0;

  constructor(public limit: number = 65536) {}

  get size(): number {
    return this.paths.length;
  }

  /** Starts a new table if this one is full. Call it before encoding a packet. */
  startPacket(): void {
    if (this.paths.length < this.limit) return;
    this.root = createNode("");
    this.paths = [];
    this.epoch++;
    this.definitionCache.clear();
  }

  private child(node: PathNode, key: string): PathNode {
    let children = node.children;
    if (children === undefined) {
      children = node.children = new Map();
    }
    let child = children.get(key);
    if (child === undefined) {
      child = createNode(node === this.root ? key : node.path + "." + key);
      children.set(key, child);
    }
    return child;
  }

  private idOf(node: PathNode): number {
    if (node.id === -1) {
      node.id = this.paths.length;
      this.paths.push(node.path);
    }
    return node.id;
  }

  /** Number of a path (dot separated), given on first use. */
  id(path: string): number {
    let node = this.root;
    for (const key of path.split(".")) {
      node = this.child(node, key);
    }
    return this.idOf(node);
  }

  /**
   * Encodes a sync value as `id,value` pairs, flattened like `load()` walks it: a nested
   * plain object is walked, anything else (including arrays) is a value.
   *
   * @param value - The sync value (or a part of it).
   * @param prefix - Path of `value` in the state (`"players.p1"`), "" for the root.
   * @returns The pairs, comma separated, without brackets ("" when there is nothing).
   */
  encode(value: any, prefix: string = ""): string {
    let node = this.root;
    if (prefix) {
      for (const key of prefix.split(".")) node = this.child(node, key);
    }
    return this.flatten(value, node, "");
  }

  /** Encodes a single value at a path (for example `"$delete"`). */
  encodeLeaf(path: string, value: any): string {
    return `${this.id(path)},${encodeValue(value)}`;
  }

  private flatten(value: any, node: PathNode, out: string): string {
    for (const key in value) {
      const child = value[key];
      if (child === undefined || typeof child === "function" || typeof child === "symbol") {
        continue; // dropped by JSON.stringify too
      }
      const childNode = this.child(node, key);
      if (child !== null && typeof child === "object" && !Array.isArray(child)) {
        out = this.flatten(child, childNode, out);
      } else {
        out += (out === "" ? "" : ",") + this.idOf(childNode) + "," + encodeValue(child);
      }
    }
    return out;
  }

  /**
   * Fields to add to a packet for a client, and moves its cursor: the definitions it does not
   * have yet (`"d":[...],`), preceded by `"r":1,` when the table started over.
   * Call it after encoding the packet, so the definitions include its new paths.
   *
   * @returns "" when the client already knows every path.
   */
  header(cursor: PathTableCursor): string {
    let reset = "";
    if (cursor.epoch !== this.epoch) {
      cursor.epoch = this.epoch;
      cursor.known = 0;
      reset = `"r":1,`;
    }
    const from = cursor.known;
    if (from >= this.paths.length) return reset;
    cursor.known = this.paths.length;
    if (this.definitionCacheSize !== this.paths.length) {
      this.definitionCache.clear();
      this.definitionCacheSize = this.paths.length;
    }
    let definitions = this.definitionCache.get(from);
    if (definitions === undefined) {
      definitions = `"d":${JSON.stringify([from, ...this.paths.slice(from)])},`;
      this.definitionCache.set(from, definitions);
    }
    return reset + definitions;
  }

  /** A new cursor for a client that knows nothing yet. */
  createCursor(): PathTableCursor {
    return { epoch: -1, known: 0 };
  }
}

function isPrimitive(value: any): boolean {
  return value === null || (typeof value !== "object" && typeof value !== "function");
}

/**
 * Client side: applies sync packets in the path table format to a state.
 *
 * Each path resolves to the signal that holds its value; the signal is kept and reused for
 * the next packets, until the structure of the state changes (an entity created or deleted,
 * an object replaced: see `load()`). Other values are applied like `load()` applies them.
 *
 * Keep one decoder per connection: the table belongs to the connection.
 *
 * @example
 * const decoder = new PathTableDecoder();
 * socket.addEventListener("message", (event) => {
 *   const packet = decodeMessage(event.data);
 *   if (packet.type === "sync") decoder.apply(state, packet);
 * });
 */
export class PathTableDecoder {
  private parts: string[][] = [];
  private signals: any[] = [];
  private versions: number[] = [];
  private root: any;

  /** Whether `packet` uses this format (it has `p` instead of `value`). */
  static isPathPacket(packet: any): boolean {
    return Array.isArray(packet?.p);
  }

  /**
   * Applies a packet to `rootInstance`, in one `batch()` like `load()`.
   *
   * @param rootInstance - The state to update.
   * @param packet - The decoded packet, with `p` and optionally `d` and `r`.
   */
  apply(rootInstance: any, packet: { p: any[]; d?: any[]; r?: number }): void {
    if (packet.r) {
      this.parts = [];
      this.signals = [];
      this.versions = [];
    }
    if (rootInstance !== this.root) {
      // Signals found in another state cannot be reused
      this.root = rootInstance;
      this.signals = [];
      this.versions = [];
    }
    const definitions = packet.d;
    if (definitions) {
      const from = definitions[0];
      for (let i = 1; i < definitions.length; i++) {
        const id = from + i - 1;
        this.parts[id] = String(definitions[i]).split(".");
        this.signals[id] = undefined;
      }
    }
    const pairs = packet.p;
    batch(() => {
      for (let i = 0; i < pairs.length; i += 2) {
        this.applyPair(rootInstance, pairs[i], pairs[i + 1]);
      }
    });
  }

  private applyPair(rootInstance: any, id: number, value: any) {
    const version = getStructureVersion();
    if (isPrimitive(value) && value !== DELETE_TOKEN) {
      let signal = this.versions[id] === version ? this.signals[id] : undefined;
      if (signal === undefined) {
        signal = this.resolve(rootInstance, id);
        this.signals[id] = signal ?? null;
        this.versions[id] = version;
      }
      // A signal that holds an object goes through load(): replacing it changes the structure
      if (signal && isPrimitive(signal._subject.value)) {
        signal.set(value);
        return;
      }
    }
    const parts = this.parts[id];
    if (parts === undefined) {
      throw new Error(`Unknown path id ${id} in sync packet`);
    }
    loadPathParts(rootInstance, parts, value);
  }

  /**
   * The signal holding the value at this path, or null if there is none yet (or the value is
   * not held by a signal): those values go through `load()`'s rules.
   */
  private resolve(rootInstance: any, id: number): any {
    const parts = this.parts[id];
    if (parts === undefined) return null;
    let current = rootInstance;
    const last = parts.length - 1;
    for (let i = 0; i < last; i++) {
      // Same steps as load(): unwrap a signal, then go one level down
      if (isSignal(current)) {
        current = current();
      }
      if (current === null || current === undefined) return null;
      current = current[parts[i]];
      if (current === undefined) return null;
    }
    if (current === null || current === undefined) return null;
    const leaf = current[parts[last]];
    return leaf?._subject ? leaf : null;
  }
}
