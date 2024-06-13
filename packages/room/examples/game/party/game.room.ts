import { Room, action } from "../../../src";
import { RoomSchema } from "../shared/room.schema";

@Room({
    path: 'game'
})
export class GameRoom extends RoomSchema {
    @action('increment')
    increment() {
        this.count.update((count) => count + 1);
    }
}