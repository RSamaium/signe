import { load } from "@signe/sync";
import PartySocket, { PartySocketOptions } from "partysocket";
import { TokenStorage } from "./storage";

interface TokenManager {
  saveToken: (token: string) => Promise<void> | void;
  getToken: () => Promise<string | null> | string | null;
}

interface ConnectionOptions extends PartySocketOptions {
  tokenManager?: TokenManager;
  onSaveToken?: (token: string) => Promise<void> | void;
  query?: () => Promise<{ token: string }>;
}

interface RoomInstance {
  [key: string]: any;
  $valuesChanges?: {
    set: (path: string, value: any) => void;
    setPersist: (path: string) => void;
    has: (path: string) => boolean;
    get: (path: string) => any;
  };
}

interface ConnectionResult {
  emit: (key: string, value: any) => void;
  on: (key: string, cb: (value: any) => void) => void;
  off: (key: string, cb: (value: any) => void) => void;
  close: () => void;
  conn: PartySocket;
}

export function connection(options: ConnectionOptions, roomInstance: RoomInstance): ConnectionResult {
  // Configure default token handling if not provided
  const tokenManager = options.tokenManager || TokenStorage;
  
  // Add token handling to options
  options.onSaveToken = tokenManager.saveToken;
  options.query = async () => {
    const token = await tokenManager.getToken();
    return { token: token || '' };
  };

  const conn = new PartySocket(options);
  conn.addEventListener("message", (event) => {
    const object = JSON.parse(event.data);
    switch (object.type) {
      case "sync":
        load(roomInstance, object.value, true);
        const { privateId } = object.value;
        if (privateId) {
          tokenManager.saveToken(privateId);
        }
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

export { PartySocket, TokenStorage };
