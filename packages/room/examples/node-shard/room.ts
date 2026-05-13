import { signal } from "@signe/reactive";
import { Action, Request, Room, Server, Shard, WorldRoom } from "@signe/room";
import { connected, sync, users } from "@signe/sync";
import { z } from "zod";
import type * as Party from "../../src/types/party";

class DemoUser {
  @sync() name = signal("Anonymous");
  @connected() connected = signal(false);
}

@Room({ path: "{roomId}", sessionExpiryTime: 5000 })
class DemoRoom {
  @sync() count = signal(0);
  @users(DemoUser) users = signal<Record<string, DemoUser>>({});

  onJoin(user: DemoUser, _conn: unknown, ctx: { request?: Request }) {
    const url = new URL(ctx.request?.url ?? "http://localhost");
    const name = url.searchParams.get("name")?.trim();

    if (name) {
      user.name.set(name.slice(0, 40));
    }
  }

  @Action("increment", z.object({ amount: z.number().optional() }))
  increment(_user: DemoUser, value: { amount?: number }) {
    this.count.update((count) => count + (value.amount ?? 1));
  }

  @Request({ path: "/state" })
  getState() {
    return this.snapshot();
  }

  @Request({ path: "/reset", method: "POST" })
  reset() {
    this.count.set(0);
    return this.snapshot();
  }

  private snapshot() {
    return {
      count: this.count(),
      users: Object.fromEntries(
        Object.entries(this.users()).map(([id, user]) => [
          id,
          {
            name: user.name(),
            connected: user.connected(),
          },
        ])
      ),
    };
  }
}

@Room({
  path: "world-{worldId}",
  maxUsers: 100,
  throttleStorage: 2000,
  throttleSync: 500,
})
class DashboardWorldRoom extends WorldRoom {
  constructor(private readonly dashboardRoom: Party.Room) {
    super(dashboardRoom);
  }

  @Request({ path: "/dashboard" })
  dashboard() {
    return {
      worldId: this.dashboardRoom.id,
      rooms: Object.values(this.rooms()).map((room) => ({
        id: room.id,
        name: room.name(),
        balancingStrategy: room.balancingStrategy(),
        public: room.public(),
        maxPlayersPerShard: room.maxPlayersPerShard(),
        minShards: room.minShards(),
        maxShards: room.maxShards(),
      })),
      shards: Object.values(this.shards()).map((shard: any) => ({
        id: shard.id,
        roomId: shard.roomId(),
        worldId: shard.worldId(),
        url: shard.url(),
        currentConnections: shard.currentConnections(),
        maxConnections: shard.maxConnections(),
        status: shard.status(),
        lastHeartbeat: shard.lastHeartbeat(),
      })),
    };
  }
}

export class MainServer extends Server {
  rooms = [DashboardWorldRoom, DemoRoom];
}

export class ShardServer extends Shard {
  constructor(room: Party.Room) {
    super(room);
    this.statsInterval = 5000;
  }
}
