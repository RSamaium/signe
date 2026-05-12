import { Action, Request, Room, Server } from "@signe/room";
import { signal } from "@signe/reactive";
import { connected, sync, users } from "@signe/sync";
import { z } from "zod";

const ARENA_WIDTH = 900;
const ARENA_HEIGHT = 560;
const PLAYER_RADIUS = 16;
const STAR_RADIUS = 13;
const COLLECT_DISTANCE = PLAYER_RADIUS + STAR_RADIUS + 8;

type Point = {
  x: number;
  y: number;
};

class Player {
  @sync() name = signal("Anonymous");
  @connected() connected = signal(false);
  @sync() x = signal(-1);
  @sync() y = signal(-1);
  @sync() color = signal("#2563eb");
  @sync() score = signal(0);
}

@Room({ path: "{roomId}", sessionExpiryTime: 2000 })
class GameRoom {
  @sync() star = signal<Point>(randomPoint());
  @users(Player) players = signal<Record<string, Player>>({});

  onJoin(player: Player, _conn: unknown, ctx: { request?: Request }) {
    const url = new URL(ctx.request?.url ?? "http://localhost");
    const name = url.searchParams.get("name")?.trim();

    if (name) {
      player.name.set(name.slice(0, 40));
    }

    if (player.x() < 0 || player.y() < 0) {
      const point = randomPoint();
      player.x.set(point.x);
      player.y.set(point.y);
      player.color.set(colorFromName(player.name()));
    }
  }

  @Action("move", z.object({ x: z.number(), y: z.number() }))
  move(player: Player, value: Point) {
    player.x.set(clamp(value.x, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS));
    player.y.set(clamp(value.y, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS));
  }

  @Action("collect", z.object({}))
  collect(player: Player) {
    const distance = getDistance(player.x(), player.y(), this.star().x, this.star().y);

    if (distance > COLLECT_DISTANCE) {
      return;
    }

    player.score.update((score) => score + 1);
    this.star.set(randomPoint());
  }

  @Request({ path: "/state" })
  getState() {
    return this.snapshot();
  }

  @Request({ path: "/reset", method: "POST" })
  reset() {
    for (const player of Object.values(this.players())) {
      player.score.set(0);
    }

    this.star.set(randomPoint());
    return this.snapshot();
  }

  private snapshot() {
    return {
      arena: {
        width: ARENA_WIDTH,
        height: ARENA_HEIGHT,
      },
      star: this.star(),
      players: Object.fromEntries(
        Object.entries(this.players()).map(([id, player]) => [
          id,
          {
            name: player.name(),
            connected: player.connected(),
            x: player.x(),
            y: player.y(),
            color: player.color(),
            score: player.score(),
          },
        ])
      ),
    };
  }
}

export class GameServer extends Server {
  rooms = [GameRoom];
}

function randomPoint(): Point {
  return {
    x: randomInt(PLAYER_RADIUS + 20, ARENA_WIDTH - PLAYER_RADIUS - 20),
    y: randomInt(PLAYER_RADIUS + 20, ARENA_HEIGHT - PLAYER_RADIUS - 20),
  };
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getDistance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

function colorFromName(name: string) {
  const colors = [
    "#2563eb",
    "#dc2626",
    "#16a34a",
    "#9333ea",
    "#ea580c",
    "#0891b2",
    "#be123c",
    "#4f46e5",
  ];
  let hash = 0;

  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }

  return colors[hash % colors.length];
}
