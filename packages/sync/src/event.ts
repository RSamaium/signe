export type SyncEventListener<T> = (payload: T) => void;

/**
 * A volatile synchronized value: each `emit()` is sent once to clients,
 * triggers their listeners, and is never stored, persisted or replayed.
 */
export interface SyncEvent<T = any> {
  /**
   * Emits a payload. Local listeners run immediately and, when the owner
   * instance is synchronized, the payload is sent to clients with the next sync packet.
   */
  emit(payload: T): void;
  /**
   * Registers a listener. Returns a function that removes it.
   */
  on(listener: SyncEventListener<T>): () => void;
  /**
   * Removes a listener registered with `on()`.
   */
  off(listener: SyncEventListener<T>): void;
}

export interface SyncEventInternal<T = any> extends SyncEvent<T> {
  readonly __syncEvent: true;
  /**
   * Called when the event is attached to a synchronized instance.
   * `emitter` receives every emitted payload and forwards it to the sync channel.
   */
  $bind(emitter: ((payload: T) => void) | null): void;
  /**
   * Calls listeners without forwarding to the sync channel (used when receiving a packet).
   */
  $dispatch(payload: T): void;
}

/**
 * Creates a volatile synchronized event.
 *
 * Unlike a signal, an event has no current value: two identical emissions are two events,
 * several emissions in the same tick are all delivered, and nothing is kept in memory
 * (late joiners never receive past events).
 *
 * @example
 * ```typescript
 * class Player {
 *   @sync() hp = signal(100)
 *   @sync() hit = event<{ damage: number }>()
 * }
 *
 * // server
 * player.hp.update(v => v - 40)
 * player.hit.emit({ damage: 40 })
 *
 * // client (hp is already applied when the listener runs)
 * player.hit.on(({ damage }) => showDamage(damage))
 * ```
 */
export function event<T = void>(): SyncEvent<T> {
  const listeners = new Set<SyncEventListener<T>>();
  let emitter: ((payload: T) => void) | null = null;

  const dispatch = (payload: T) => {
    for (const listener of [...listeners]) {
      listener(payload);
    }
  };

  const evt: SyncEventInternal<T> = {
    __syncEvent: true,
    emit(payload: T) {
      emitter?.(payload);
      dispatch(payload);
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    off(listener) {
      listeners.delete(listener);
    },
    $bind(next) {
      emitter = next;
    },
    $dispatch: dispatch,
  };

  return evt;
}

export function isSyncEvent(value: any): value is SyncEventInternal {
  return !!value && typeof value === "object" && value.__syncEvent === true;
}
