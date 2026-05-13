export const AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "node-shard-auth-secret-at-least-256-bits";
export const SHARD_SECRET = process.env.SHARD_SECRET ?? "node-shard-local-secret";
export const WORLD_PORT = Number(process.env.WORLD_PORT ?? 3002);
export const ROOM_PORT = Number(process.env.ROOM_PORT ?? 3003);
export const WORLD_ORIGIN = process.env.WORLD_ORIGIN ?? `http://localhost:${WORLD_PORT}`;
export const ROOM_ORIGIN = process.env.ROOM_ORIGIN ?? `http://localhost:${ROOM_PORT}`;
