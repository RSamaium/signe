# Example

```ts
import { signal } from "@signe/reactive";
import { Room, Server, action } from "@signe/room";
import { id, sync, users } from "@signe/sync";

export class Player {
  @id() id = signal("");
  @sync() x = signal(0);
  @sync() y = signal(0);
  @sync() color = signal("#000000");

  constructor() {
    const randomColor = Math.floor(Math.random() * 16777215).toString(16);
    this.color.set("#" + randomColor);
  }
}

export class RoomSchema {
  @sync() count = signal(0);
  @users(Player) players = signal({});
}

@Room({
  path: "chess-{id}",
  maxUsers: 2,
})
export class MyRoom extends RoomSchema {
  static onAuth() {}

  constructor(readonly room, readonly params: { id: string }) {
    super();
  }

  onCreate() {}

  @action("move")
  move(player: Player, data: any) {
    player.x.set(data.x);
    player.y.set(data.y);
  }

  onJoin(player: Player) {
    console.log(player.id(), "joined");
  }

  onLeave() {}
}

export default class MyServer extends Server {
  rooms = [MyRoom];
}
```