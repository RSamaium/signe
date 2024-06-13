import { load } from "@signe/sync";
import PartySocket from "partysocket";

export function connection(options, roomInstance) {
  const conn = new PartySocket(options);
  conn.addEventListener("message", (event) => {
    const object = JSON.parse(event.data);
    switch (object.type) {
      case "sync":
        load(roomInstance, object.value, true);
        break;
    }
  });
  return {
    emit: (key, value) => {
      conn.send(
        JSON.stringify({
          action: key,
          value,
        })
      );
    },
    on: (key, cb) => {
      conn.addEventListener("message", (event) => {
        const object = JSON.parse(event.data);
        if (object.type === key) {
          cb(object.value);
        }
      });
    },
    off: (key, cb) => {
      conn.removeEventListener("message", (event) => {
        const object = JSON.parse(event.data);
        if (object.type === key) {
          cb(object.value);
        }
      });
    },
    close: conn.close,
    conn,
  };
}
