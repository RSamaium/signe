import { createStatesSnapshot, getByPath, load, syncClass } from "@signe/sync";
import { dset } from "dset";
import z from "zod";
import type * as Party from "./types/party";
import {
    awaitReturn,
    buildObject,
    extractParams,
    isClass,
    throttle,
} from "./utils";

const Message = z.object({
  action: z.string(),
  value: z.any(),
});

export class Server implements Party.Server {
  memoryAll = {};
  subRoom = {};
  rooms = [];

  static async onBeforeConnect(request: Party.Request) {
    try {
      request.headers.set("X-User-ID", "" + Math.random());
      return request;
    } catch (e) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  constructor(readonly room: Party.Room) {
    for (let room of this.rooms) {
      const params = extractParams(room.path, this.room.id);
      if (params) {
        this.subRoom = new room(this.room, params);
        break;
      }
    }

    if (!this.subRoom) {
      throw new Error("Room not found");
    }

    const loadMemory = async () => {
      const root = await this.room.storage.get(".");
      const memory = await this.room.storage.list();
      const tmpObject = root || {};
      for (let [key, value] of memory) {
        if (key == ".") {
          continue;
        }
        dset(tmpObject, key, value);
      }
      load(this, tmpObject);
    };

    loadMemory();

    syncClass(this.subRoom, {
      onSync: throttle((values) => {
        const packet = buildObject(values, this.memoryAll);
        this.room.broadcast(
          JSON.stringify({
            type: "sync",
            value: packet,
          })
        );
        values.clear();
      }, 100),
      onPersist: throttle(async (values) => {
        for (let path of values) {
          const instance =
            path == "." ? this.subRoom : getByPath(this.subRoom, path);
          const itemValue = createStatesSnapshot(instance);
          await this.room.storage.put(path, itemValue);
        }
        values.clear();
      }, 2000),
    });
  }

  private getUsersProperty() {
    const meta = this.subRoom.constructor._propertyMetadata;
    const propId = meta?.get("users");
    if (propId) {
      return this.subRoom[propId];
    }
    return null;
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const publicId = "a" + ("" + Math.random()).split(".")[1];
    let user = null;
    const signal = this.getUsersProperty();
    if (signal) {
      const { classType } = signal.options;
      user = isClass(classType) ? new classType() : classType(conn, ctx);
      signal()[publicId] = user;
    }
    await awaitReturn(this.subRoom.onJoin?.(user, conn, ctx));
    conn.setState({ publicId });
    conn.send(
      JSON.stringify({
        type: "sync",
        value: {
          pId: publicId,
          ...this.memoryAll,
        },
      })
    );
  }

  async onMessage(message: string, sender: Party.Connection) {
    const actions = this.subRoom.constructor._actionMetadata;
    const result = Message.safeParse(JSON.parse(message));
    if (!result.success) {
      return;
    }
    if (actions) {
      const signal = this.getUsersProperty();
      const { publicId } = sender.state;
      const user = signal?.()[publicId];
      const actionName = actions.get(result.data.action);
      if (actionName) {
        if (actionName.bodyValidation) {
          const bodyResult = actionName.bodyValidation.safeParse(
            result.data.value
          );
          if (!bodyResult.success) {
            return;
          }
        }
        await awaitReturn(
          this.subRoom[actionName.key](user, result.data.value, sender)
        );
      }
    }
  }

  async onClose(conn: Party.Connection) {
    const signal = this.getUsersProperty();
    const { publicId } = conn.state;
    const user = signal?.()[publicId];
    await awaitReturn(this.subRoom.onLeave?.(user, conn));
    if (signal) {
      delete signal()[publicId];
    }
  }
}
