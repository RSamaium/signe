import { Action, Room } from "../../../src";
import { RoomSchema } from "../shared/room.schema";

@Room({
    path: 'game'
})
export class GameRoom extends RoomSchema {
    @Action('increment')
    increment() {
        this.count.update((count) => count + 1);
    }
}