import { batch, isSignal } from "@signe/reactive";
import { DELETE_TOKEN, setMetadata } from "./core";
import { isSyncEvent } from "./event";
import { isClass } from "./utils";

/**
 * Loads values into the root instance by paths or from an object.
 *
 * Runs in a single `batch()`: computed signals and effects depending on several loaded
 * values update once, after all values are applied.
 * 
 * @param {object} rootInstance - The instance into which values will be loaded.
 * @param {object} values - The values to load, either as paths or an object.
 * @param {boolean} [valueIsObject=false] - If true, `values` is treated as an object.
 * @example
 * // Using paths:
 * load(instance, { 'position.x': 10, 'position.y': 20 });
 * 
 * // Using an object:
 * load(instance, { position: { x: 10, y: 20 } }, true);
 */
export function load(rootInstance: any, values: { [path: string]: any }): void;
export function load(
  rootInstance: any,
  values: object,
  valueIsObject: true
): void;
export function load(
  rootInstance: any,
  values: { [path: string]: any } | object,
  valueIsObject?: boolean
) {
  // One batch per load: computed signals and effects that read several loaded values
  // (e.g. a sprite reading x and y) update once per packet instead of once per value.
  batch(() => {
    if (valueIsObject) {
      loadFromObject(rootInstance, values);
    } else {
      loadFromPaths(rootInstance, values);
    }
  });
}

/**
 * Loads values into the root instance using paths.
 * 
 * @param {object} rootInstance - The instance into which values will be loaded.
 * @param {object} values - The values to load, with keys as paths.
 * @example
 * loadFromPaths(instance, { 'position.x': 10, 'position.y': 20 });
 */
function loadFromPaths(rootInstance: any, values: { [path: string]: any }) {
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split(".");
    loadValue(rootInstance, parts, value);
  }
}

/**
 * Recursively loads values from an object into the root instance.
 *
 * Walks the values and the instance together: each level is resolved once, instead of
 * building a path string for every value and walking it again from the root. The rules
 * are the same as {@link loadValue}: intermediate nodes are created (with the parent's
 * `classType` when set) only when a value is loaded below them.
 *
 * @param {object} rootInstance - The instance into which values will be loaded.
 * @param {object} values - The values to load.
 * @example
 * loadFromObject(instance, { position: { x: 10, y: 20 } });
 */
function loadFromObject(rootInstance: any, values: object) {
  loadObjectLevel(() => rootInstance, values, true);
}

/**
 * @param getNode - Returns the node for this level (before unwrapping a signal), created on
 *   first use so that a level with no value below it is never created.
 * @param isRoot - At the root there is no parent, so no `classType` (as in loadValue).
 */
function loadObjectLevel(getNode: () => any, values: object, isRoot: boolean) {
  for (const key in values) {
    const value = values[key];
    // A key may itself be a path ("items.0.value"), as when paths were joined then split
    const parts = key.includes(".") ? key.split(".") : null;
    const last = parts ? parts[parts.length - 1] : key;
    // Node that holds `last`: walks the leading parts of a dotted key
    const getHolder = parts
      ? () => {
          let node = getNode();
          for (let i = 0; i < parts.length - 1; i++) {
            node = stepInto(node, parts[i], isRoot && i === 0 ? undefined : node);
          }
          return node;
        }
      : getNode;
    const holderIsRoot = isRoot && !parts;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      let child: any;
      let resolved = false;
      const getChild = () => {
        if (!resolved) {
          const node = getHolder();
          child = stepInto(node, last, holderIsRoot ? undefined : node);
          resolved = true;
        }
        return child;
      };
      loadObjectLevel(getChild, value, false);
    } else {
      applyLeaf(getHolder(), last, value);
    }
  }
}

/**
 * Sets a value in the root instance by navigating through the path parts.
 * 
 * @param {object} rootInstance - The instance into which the value will be set.
 * @param {string[]} parts - The parts of the path.
 * @param {any} value - The value to set.
 * @example
 * loadValue(instance, ['position', 'x'], 10);
 */
function loadValue(rootInstance: any, parts: string[], value: any) {
  let current: any = rootInstance;
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) {
    // The parent of a level is the node at the previous path (none at the root)
    const parentInstance = i === 0 ? undefined : current;
    current = stepInto(current, parts[i], parentInstance);
  }
  applyLeaf(current, parts[last], value);
}

/**
 * Moves one level down from `current` (unwrapping a signal), creating the child when it is
 * missing: an instance of the parent's `classType` if any, otherwise a plain object.
 */
function stepInto(current: any, part: string, parentInstance: any) {
  if (isSignal(current)) {
    current = current();
  }
  if (current[part] === undefined) {
    const classType = parentInstance?.options?.classType;
    if (classType) {
      current[part] = !isClass(classType) ? classType(part) : new classType();
      setMetadata(current[part], 'id', part)
    } else {
      current[part] = {};
    }
  }
  return current[part];
}

/** Applies a value (or a delete) at `part` of `current`. */
function applyLeaf(current: any, part: string, value: any) {
  if (value == DELETE_TOKEN) {
    if (isSignal(current)) {
      if (mutateSignalContainer(current, target => {
        Reflect.deleteProperty(target, part);
      })) {
        return;
      }
      current = current();
    }
    Reflect.deleteProperty(current, part);
  }
  else if (current[part]?._subject) {
    current[part].set(value);
  }
  else if (isSignal(current) && mutateSignalContainer(current, target => {
    const key = Array.isArray(target) && !isNaN(Number(part))
      ? Number(part)
      : part;
    target[key] = value;
  })) {
    return;
  }
  else {
    current[part] = value;
  }
}

function mutateSignalContainer(
  signal: any,
  mutation: (target: any) => void
): boolean {
  const container = signal();
  if (container === null || typeof container !== "object") {
    return false;
  }

  if (typeof signal.mutate === "function") {
    signal.mutate(mutation);
  } else {
    mutation(container);
  }

  return true;
}

/**
 * Dispatches volatile events received in a sync packet to the matching `event()` listeners.
 *
 * Call it after `load()` so listeners see the state of the same packet.
 * Paths that do not resolve to an `event()` are ignored. Nothing is stored.
 *
 * @param {object} rootInstance - The instance holding the events.
 * @param {object} events - Payloads by path, in emission order.
 * @example
 * load(instance, packet.value, true);
 * loadEvents(instance, packet.events ?? {});
 */
export function loadEvents(
  rootInstance: any,
  events: Record<string, any[]> | undefined | null
): void {
  if (!events) return;
  for (const [path, payloads] of Object.entries(events)) {
    const target = getByPath(rootInstance, path);
    if (!isSyncEvent(target) || !Array.isArray(payloads)) continue;
    for (const payload of payloads) {
      target.$dispatch(payload);
    }
  }
}

/**
 * Retrieves a value from the root instance by a path.
 * 
 * @param {object} root - The root instance.
 * @param {string} path - The path to the value.
 * @returns {any} - The value at the specified path.
 * @example
 * const value = getByPath(instance, 'position.x');
 */
export function getByPath(root: any, path: string) {
  const parts = path.split(".");
  let current = root;
  for (const part of parts) {
    if (isSignal(current)) {
      current = current();
    }
    if (current != null && current[part]) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}
