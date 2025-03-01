import * as Party from "./types/party";
import { JWTAuth } from "./jwt";
import { response } from "./utils";

export const guardManageWorld = async (_, req: Party.Request, room: Party.Room): Promise<boolean | Response> => {
    const tokenShard = req.headers.get("x-access-shard");
    if (tokenShard) {
        if (tokenShard !== room.env.SHARD_SECRET) {
            return false
        }
        return true
    }
    const token = req.headers.get("Authorization");
    if (!token) {
        return response(401, { error: "Unauthorized" });
    }
    const jwt = new JWTAuth(room.env.AUTH_JWT_SECRET as string);
    const payload = await jwt.verify(token);
    if (!payload) {
        return response(401, { error: "Unauthorized" });
    }
    return true;
}