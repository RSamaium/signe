import * as Party from "./types/party";
import { JWTAuth } from "./jwt";
import { response } from "./utils";

export const guardManageWorld = async (_, req: Party.Request, room: Party.Room): Promise<boolean> => {
    const tokenShard = req.headers.get("x-access-shard");
    if (tokenShard) {
        if (tokenShard !== room.env.SHARD_SECRET) {
            return false
        }
        return true
    }
    const url = new URL(req.url);
    const token = req.headers.get("Authorization") ?? url.searchParams.get("world-auth-token");
    if (!token) {
        return false;
    }
    const jwt = new JWTAuth(room.env.AUTH_JWT_SECRET as string);
    try {
        const payload = await jwt.verify(token);
        if (!payload) {
            return false;
        }
    } catch (error) {
        return false;
    }
    return true;
}