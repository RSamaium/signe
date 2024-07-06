import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signal } from "../../packages/reactive/src";
import { Action, Room, Server, ServerIo } from "../../packages/room/src";
import { id, users } from "../../packages/sync/src";

describe("Server", () => {
    let server: Server;
    let conn: any;
    let onJoinSpy: any;
    let onLeaveSpy: any;
    let setState: any;

    const createConnection = () => {
      let _state: any = {};
      return {
        send: vi.fn(),
        setState(value) {
          _state = value;
          setState(value);
        },
        get state() {
          return _state;
        },
      };
    };

    beforeEach(() => {
      setState = vi.fn();
      conn = createConnection();
      onJoinSpy = vi.fn();
      onLeaveSpy = vi.fn();

      class Player {
        @id() id: string;
        x = signal(0);
        y = signal(0);
      }

      @Room({
        path: "game",
      })
      class GameRoom {
        count = signal(0);
        @users(Player) users = signal({});

        @Action("increment")
        increment() {
          this.count.update((count) => count + 1);
        }

        onJoin: any = onJoinSpy;
        onLeave: any = onLeaveSpy;
      }

      class MainServer extends Server {
        rooms = [GameRoom];
      }

      server = new MainServer(new ServerIo("game") as any);
    });

    it("should initialize correctly", async () => {
      await server.onStart();
      expect(server.subRoom).toBeDefined();
    });

    it("should handle connection correctly", async () => {
      await server.onStart();

      await server.onConnect(conn as any, {} as any);

      expect(setState).toHaveBeenCalledWith({
        publicId: expect.any(String),
      });
      expect(conn.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"sync"')
      );
      expect(onJoinSpy).toHaveBeenCalled();
    });

    it("should handle messages correctly", async () => {
      await server.onStart();
      await server.onConnect(conn as any, {} as any);

      const message = JSON.stringify({
        action: "increment",
        value: null,
      });

      await server.onMessage(message, conn as any);

      expect((server.subRoom as any).count()).toBe(1);
    });

    it("should handle disconnection correctly", async () => {
      await server.onStart();
      await server.onConnect(conn as any, {} as any);

      await server.onClose(conn as any);

      expect(onLeaveSpy).toHaveBeenCalled();
    });

    it("should throw an error for unknown room", async () => {
      class EmptyServer extends Server {
        rooms = [];
      }

      const emptyServer = new EmptyServer(new ServerIo("unknown") as any);

      await expect(emptyServer.onStart()).rejects.toThrow("Room not found");
    });

    it("should handle invalid messages", async () => {
      await server.onStart();
      const invalidMessage = "invalid json";

      await expect(
        server.onMessage(invalidMessage, conn as any)
      ).resolves.toBeUndefined();
    });

    it("should handle messages with invalid actions", async () => {
      await server.onStart();
      const invalidActionMessage = JSON.stringify({
        action: "nonexistentAction",
        value: null,
      });

      await expect(
        server.onMessage(invalidActionMessage, conn as any)
      ).resolves.toBeUndefined();
    });

    it("should update users signal on connection", async () => {
      await server.onStart();
      await server.onConnect(conn as any, {} as any);

      expect(Object.keys((server.subRoom as any).users()).length).toBe(1);
    });

    it("should remove user from users signal on disconnection", async () => {
      await server.onStart();
      await server.onConnect(conn as any, {} as any);
      await server.onClose(conn as any);

      expect(Object.keys((server.subRoom as any).users()).length).toBe(0);
    });

    it("should handle multiple connections and disconnections", async () => {
      await server.onStart();

      const conn1 = createConnection();
      const conn2 = createConnection();

      await server.onConnect(conn1 as any, {} as any);
      await server.onConnect(conn2 as any, {} as any);

      expect(Object.keys((server.subRoom as any).users()).length).toBe(2);

      await server.onClose(conn1 as any);

      expect(Object.keys((server.subRoom as any).users()).length).toBe(1);

      await server.onClose(conn2 as any);

      expect(Object.keys((server.subRoom as any).users()).length).toBe(0);
    });

    it("should handle messages from different users", async () => {
      await server.onStart();

      const conn1 = createConnection();
      const conn2 = createConnection();

      await server.onConnect(conn1 as any, {} as any);
      await server.onConnect(conn2 as any, {} as any);

      const message = JSON.stringify({
        action: "increment",
        value: null,
      });

      await server.onMessage(message, conn1 as any);
      await server.onMessage(message, conn2 as any);

      expect((server.subRoom as any).count()).toBe(2);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });
  });