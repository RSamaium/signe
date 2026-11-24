import { signal } from "@signe/reactive";
import { describe, expect, it, vi } from "vitest";
import {
  createStatesSnapshot,
  createStatesSnapshotDeep,
  event,
  load,
  loadEvents,
  sync,
  syncClass,
} from "../../packages/sync/src";

class Player {
  @sync() hp = signal(100);
  @sync() hit = event<{ damage: number }>();
}

class GameRoom {
  @sync() score = signal(0);
  @sync() tick = event<number>();
  @sync(Player) players = signal<Record<string, Player>>({});
}

describe("event()", () => {
  it("calls local listeners on each emit, including identical payloads", () => {
    const evt = event<number>();
    const listener = vi.fn();
    evt.on(listener);

    evt.emit(1);
    evt.emit(1);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("removes listeners with off() and the returned unsubscribe", () => {
    const evt = event<number>();
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribe = evt.on(a);
    evt.on(b);

    unsubscribe();
    evt.off(b);
    evt.emit(1);

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});

describe("syncClass with events", () => {
  it("queues every emission by path without touching the state cache", () => {
    const room = new GameRoom();
    const onSync = vi.fn();
    const onEvent = vi.fn();
    syncClass(room, { onSync, onEvent });
    onSync.mockClear();

    room.tick.emit(1);
    room.tick.emit(1);
    room.tick.emit(2);

    expect(onSync).not.toHaveBeenCalled();
    const queue: Map<string, any[]> = onEvent.mock.calls.at(-1)![0];
    expect(queue.get("tick")).toEqual([1, 1, 2]);
  });

  it("uses the full path for events of nested instances", () => {
    const room = new GameRoom();
    const onEvent = vi.fn();
    syncClass(room, { onEvent });

    const player = new Player();
    room.players.mutate((players) => {
      players.abc = player;
    });
    player.hit.emit({ damage: 40 });

    const queue: Map<string, any[]> = onEvent.mock.calls.at(-1)![0];
    expect(queue.get("players.abc.hit")).toEqual([{ damage: 40 }]);
  });

  it("does not collect events when onEvent is not provided", () => {
    const room = new GameRoom();
    syncClass(room, {});
    expect(() => room.tick.emit(1)).not.toThrow();
  });

  it("does not forward events when syncToClient is false", () => {
    class Local {
      @sync({ syncToClient: false }) ping = event<number>();
    }
    const instance = new Local();
    const onEvent = vi.fn();
    const listener = vi.fn();
    syncClass(instance, { onEvent });
    instance.ping.on(listener);

    instance.ping.emit(1);

    expect(onEvent).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("never appears in snapshots", () => {
    const room = new GameRoom();
    syncClass(room, {});
    room.tick.emit(1);

    expect(createStatesSnapshot(room)).not.toHaveProperty("tick");
    expect(createStatesSnapshotDeep(room)).not.toHaveProperty("tick");
  });
});

describe("loadEvents", () => {
  it("dispatches payloads in order to the event at the given path", () => {
    const room = new GameRoom();
    load(room, { players: { abc: { hp: 60 } } }, true);
    const player = room.players().abc;
    const received: Array<[number, number]> = [];
    player.hit.on(({ damage }) => received.push([damage, player.hp()]));

    loadEvents(room, { "players.abc.hit": [{ damage: 40 }, { damage: 5 }] });

    expect(received).toEqual([
      [40, 60],
      [5, 60],
    ]);
  });

  it("ignores unknown paths and non-event targets", () => {
    const room = new GameRoom();
    expect(() =>
      loadEvents(room, {
        "players.missing.hit": [1],
        score: [1],
        "nothing.here": [1],
      })
    ).not.toThrow();
    expect(room.score()).toBe(0);
  });

  it("accepts a missing events object", () => {
    expect(() => loadEvents(new GameRoom(), undefined)).not.toThrow();
  });
});
