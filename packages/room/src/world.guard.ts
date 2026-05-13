import * as Party from "./types/party";
import { JWTAuth } from "./jwt";

export const guardManageWorld = async (_: unknown, req: Party.Request, room: Party.Room): Promise<boolean> => {
    const tokenShard = req.headers.get("x-access-shard");
    if (tokenShard) {
        if (tokenShard !== room.env.SHARD_SECRET) {
            return false
        }
        return true
    }
    const url = new URL(req.url);
    const token = getAuthToken(req, url);
    if (!token) {
        return false;
    }
    const jwt = new JWTAuth(room.env.AUTH_JWT_SECRET as string);
    try {
        const payload = await jwt.verify(token);
        if (!payload) {
            return false;
        }
        if (!canAccessWorld(payload, room.id)) {
            return false;
        }
    } catch (error) {
        return false;
    }
    return true;
}

function getAuthToken(req: Party.Request, url: URL) {
    const authorization = req.headers.get("Authorization");
    if (authorization?.startsWith("Bearer ")) {
        return authorization.slice("Bearer ".length).trim();
    }
    return authorization ?? url.searchParams.get("world-auth-token");
}

function canAccessWorld(payload: Record<string, unknown>, worldId: string) {
    const worlds = payload.worlds;
    if (!Array.isArray(worlds)) {
        return false;
    }

    return worlds.some((world) => world === "*" || world === worldId);
}
