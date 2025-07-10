import { Action, Guard, Room } from "../../../src";
import { RoomSchema } from "../shared/room.schema";

@Room({
    path: 'game',
    sessionExpiryTime: 5000 
})
export class GameRoom extends RoomSchema  {
    @Action('increment')
    increment(player) {
        this.count.update((count) => count + 1); 
        player.score.update((score) => score + 1);
        this.$sessionTransfer(player.id(), "protected-1");
    }

    async onRequest(req: Party.Request, room: any) {
       const map = await room.storage.list() as Map<string, any>;
       return Object.fromEntries(map);
    }
} 

@Room({
    path: 'protected-{gameId}',
    sessionExpiryTime: 5000 
})
export class ProtectedRoom extends RoomSchema  {
    @Action('increment')
    increment(player) {
        console.log('increment', player);
    }
} 