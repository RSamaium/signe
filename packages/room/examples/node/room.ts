import { Action, Request, Room, Server } from "@signe/room";
import { signal } from "@signe/reactive";
import { connected, sync, users } from "@signe/sync";
import { z } from "zod";

class DemoUser {
  @sync() name = signal("Anonymous");
  @connected() connected = signal(false);
}

@Room({ path: "{roomId}", sessionExpiryTime: 2000 })
class CounterRoom {
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

  @Request({ path: "/count" })
  getCount() {
    return { count: this.count() };
  }

  @Request({ path: "/reset", method: "POST" })
  reset() {
    this.count.set(0);
    return { count: this.count() };
  }
}

export class CounterServer extends Server {
  rooms = [CounterRoom];
}
