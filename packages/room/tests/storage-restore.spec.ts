import { describe, expect, it } from "vitest";
import { signal } from "@signe/reactive";
import { sync, users } from "@signe/sync";
import { Room, Server, ServerIo } from "../src";

class Item {
  id = signal("");
}

class Player {
  items = signal<any[]>([]);
}

describe("storage restore hooks", () => {
  it("allows a room to hydrate the persisted root snapshot before load", async () => {
    @Room({ path: "demo" })
    class DemoRoom {
      @sync()
      title = signal("");

      onStorageRestore({ snapshot }: { snapshot: any }) {
        return {
          ...snapshot,
          title: `${snapshot.title}:hydrated`,
        };
      }
    }

    class DemoServer extends Server {
      rooms = [DemoRoom];
    }

    const io = new ServerIo("demo");
    await io.storage.put("state:title", "saved");

    const server = new DemoServer(io as any);
    await server.onStart();

    expect((server.subRoom as any).title()).toBe("saved:hydrated");
  });

  it("allows a room to hydrate persisted user snapshots before load", async () => {
    @Room({ path: "demo" })
    class DemoRoom {
      @users(Player)
      players = signal<Record<string, Player>>({});

      async onUserStorageRestore({ userSnapshot, user }: { userSnapshot: any; user?: Player }) {
        return {
          ...userSnapshot,
          items: userSnapshot.items.map((entry: any) => {
            const item = new Item();
            item.id.set(entry.id);
            return item;
          }),
          usedHelperInstance: user instanceof Player,
        };
      }
    }

    class DemoServer extends Server {
      rooms = [DemoRoom];
    }

    const io = new ServerIo("demo");
    await io.storage.put("state:players.public-1.items", [{ id: "potion" }]);

    const server = new DemoServer(io as any);
    await server.onStart();

    const restoredPlayer = (server.subRoom as any).players()["public-1"];
    expect(restoredPlayer).toBeInstanceOf(Player);
    expect(restoredPlayer.items()[0]).toBeInstanceOf(Item);
    expect(restoredPlayer.items()[0].id()).toBe("potion");
    expect((restoredPlayer as any).usedHelperInstance).toBe(true);
  });

  it("compacts persisted delete markers when loading room storage", async () => {
    @Room({ path: "demo" })
    class DemoRoom {
      @sync()
      items = signal<Record<string, number>>({});
    }

    class DemoServer extends Server {
      rooms = [DemoRoom];
    }

    const io = new ServerIo("demo");
    await io.storage.put("state:items.a", "$delete");

    const server = new DemoServer(io as any);
    await server.onStart();

    const storageEntries = await io.storage.list({ prefix: "state:" });
    expect(storageEntries.get("state:items.a")).toBeUndefined();
    expect(storageEntries.get("state:.")).toEqual({ items: {} });
  });

  it("compacts runtime deletes instead of leaving delete markers in storage", async () => {
    @Room({ path: "demo" })
    class DemoRoom {
      @sync()
      items = signal<Record<string, number>>({ a: 1, b: 2 });
    }

    class DemoServer extends Server {
      rooms = [DemoRoom];
    }

    const io = new ServerIo("demo");
    const server = new DemoServer(io as any);
    await server.onStart();

    delete (server.subRoom as any).items().a;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const storageEntries = await io.storage.list({ prefix: "state:" });
    expect(storageEntries.get("state:items.a")).toBeUndefined();
    expect(storageEntries.get("state:.")).toEqual({ items: { b: 2 } });
  });
});
