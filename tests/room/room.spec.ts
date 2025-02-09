import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signal } from "../../packages/reactive/src";
import { Action, Room, Server, ServerIo, Guard } from "../../packages/room/src";
import { id, users } from "../../packages/sync/src";
import { z } from "zod";

describe("Server", () => {
    let server: Server;
    let conn: any;
    let onJoinSpy: any;
    let onLeaveSpy: any;
    let setState: any;
    let isAuthenticatedGuard: any;
    let isAdminGuard: any;
    let isRoomGuard: any;
    let Player: any;

    const createConnection = () => {
      let _state: any = {};
      return {
        send: vi.fn(),
        close: vi.fn(),
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
      isAuthenticatedGuard = vi.fn().mockReturnValue(true);
      isAdminGuard = vi.fn().mockReturnValue(true);
      isRoomGuard = vi.fn().mockReturnValue(true);

      class _Player {
        @id() id: string;
        x = signal(0);
        y = signal(0);
      }
      Player = _Player;

      @Room({
        path: "game",
      })
      class GameRoom {
        count = signal(0);
        @users(Player) users = signal({});
        $actionGuards: Map<string, ((sender: any, value: any) => boolean | Promise<boolean>)[]>;

        constructor() {
          this.$actionGuards = new Map();
          this.$actionGuards.set('adminAction', [isAuthenticatedGuard, isAdminGuard]);
          this.$actionGuards.set('userAction', [isAuthenticatedGuard]);
        }

        @Action("increment")
        increment() {
          this.count.update((count) => count + 1);
        }

        @Action("adminAction")
        adminAction() {
          this.count.update((count) => count + 10);
        }

        @Action("userAction")
        userAction() {
          this.count.update((count) => count + 5);
        }

        @Action("updatePosition", z.object({
          x: z.number(),
          y: z.number()
        }))
        updatePosition(user: any, value: { x: number, y: number }) {
          this.count.update((count) => count + value.x + value.y);
        }

        @Action("updateName", z.object({
          name: z.string().min(3)
        }))
        updateName() {}

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

    describe("Action Guards", () => {
      beforeEach(async () => {
        await server.onStart();
        await server.onConnect(conn as any, {} as any);
      });

      it("should allow action when all guards pass", async () => {
        isAuthenticatedGuard.mockReturnValue(true);
        isAdminGuard.mockReturnValue(true);

        const message = JSON.stringify({
          action: "adminAction",
          value: null,
        });

        await server.onMessage(message, conn as any);

        expect(isAuthenticatedGuard).toHaveBeenCalled();
        expect(isAdminGuard).toHaveBeenCalled();
        expect((server.subRoom as any).count()).toBe(10);
      });

      it("should block action when any guard fails", async () => {
        isAuthenticatedGuard.mockReturnValue(true);
        isAdminGuard.mockReturnValue(false);

        const message = JSON.stringify({
          action: "adminAction",
          value: null,
        });

        await server.onMessage(message, conn as any);

        expect(isAuthenticatedGuard).toHaveBeenCalled();
        expect(isAdminGuard).toHaveBeenCalled();
        expect((server.subRoom as any).count()).toBe(0);
      });

      it("should allow action with single guard when it passes", async () => {
        isAuthenticatedGuard.mockReturnValue(true);

        const message = JSON.stringify({
          action: "userAction",
          value: null,
        });

        await server.onMessage(message, conn as any);

        expect(isAuthenticatedGuard).toHaveBeenCalled();
        expect(isAdminGuard).not.toHaveBeenCalled();
        expect((server.subRoom as any).count()).toBe(5);
      });

      it("should block action with single guard when it fails", async () => {
        isAuthenticatedGuard.mockReturnValue(false);

        const message = JSON.stringify({
          action: "userAction",
          value: null,
        });

        await server.onMessage(message, conn as any);

        expect(isAuthenticatedGuard).toHaveBeenCalled();
        expect((server.subRoom as any).count()).toBe(0);
      });

      it("should pass connection and message value to guards", async () => {
        const testValue = { test: "data" };
        const message = JSON.stringify({
          action: "adminAction",
          value: testValue,
        });

        await server.onMessage(message, conn as any);

        expect(isAuthenticatedGuard).toHaveBeenCalledWith(conn, testValue);
        expect(isAdminGuard).toHaveBeenCalledWith(conn, testValue);
      });
    });

    describe("Action Body Validation", () => {
      beforeEach(async () => {
        @Room({
          path: "game",
        })
        class ValidationRoom {
          count = signal(0);

          @Action("updatePosition", z.object({
            x: z.number(),
            y: z.number()
          }))
          updatePosition(user: any, value: { x: number, y: number }) {
            this.count.update((count) => count + value.x + value.y);
          }

          @Action("updateName", z.object({
            name: z.string().min(3)
          }))
          updateName() {}
        }

        server = new (class extends Server {
          rooms = [ValidationRoom];
        })(new ServerIo("game") as any);

        await server.onStart();
        await server.onConnect(conn as any, {} as any);
      });

      it("should accept an action with valid data", async () => {
        const message = JSON.stringify({
          action: "updatePosition",
          value: { x: 10, y: 20 }
        });

        await server.onMessage(message, conn as any);
        expect((server.subRoom as any).count()).toBe(30);
      });

      it("should reject an action with invalid data (wrong type)", async () => {
        const message = JSON.stringify({
          action: "updatePosition",
          value: { x: "10", y: 20 }
        });

        await server.onMessage(message, conn as any);
        expect((server.subRoom as any).count()).toBe(0);
      });

      it("should reject an action with invalid data (missing field)", async () => {
        const message = JSON.stringify({
          action: "updatePosition",
          value: { x: 10 }
        });

        await server.onMessage(message, conn as any);
        expect((server.subRoom as any).count()).toBe(0);
      });

      it("should reject an action with invalid string validation", async () => {
        const message = JSON.stringify({
          action: "updateName",
          value: { name: "ab" }
        });

        await server.onMessage(message, conn as any);
        expect((server.subRoom as any).count()).toBe(0);
      });
    });

    describe("Room Guards", () => {
      let ProtectedGameRoom: any;

      beforeEach(() => {
        @Room({
          path: "game",
          guards: [isRoomGuard],
        })
        class _ProtectedGameRoom {
          count = signal(0);
          @users(Player) users = signal({});
          $actionGuards: Map<string, ((sender: any, value: any) => boolean | Promise<boolean>)[]>;

          constructor() {
            this.$actionGuards = new Map();
            this.$actionGuards.set('adminAction', [isAuthenticatedGuard, isAdminGuard]);
            this.$actionGuards.set('userAction', [isAuthenticatedGuard]);
          }

          @Action("increment")
          increment() {
            this.count.update((count) => count + 1);
          }

          @Action("updatePosition", z.object({
            x: z.number(),
            y: z.number()
          }))
          updatePosition(user: any, value: { x: number, y: number }) {
            this.count.update((count) => count + value.x + value.y);
          }

          @Action("updateName", z.object({
            name: z.string().min(3)
          }))
          updateName() {}

          onJoin: any = onJoinSpy;
          onLeave: any = onLeaveSpy;
        }

        ProtectedGameRoom = _ProtectedGameRoom;
        server = new (class extends Server {
          rooms = [ProtectedGameRoom];
        })(new ServerIo("game") as any);
      });

      it("should block connection when room guard fails", async () => {
        isRoomGuard.mockReturnValue(false);
        await server.onStart();

        await server.onConnect(conn as any, {} as any);

        expect(isRoomGuard).toHaveBeenCalled();
        expect(onJoinSpy).not.toHaveBeenCalled();
        expect(setState).not.toHaveBeenCalled();
      });

      it("should allow connection when room guard passes", async () => {
        isRoomGuard.mockReturnValue(true);
        await server.onStart();

        await server.onConnect(conn as any, {} as any);

        expect(isRoomGuard).toHaveBeenCalled();
        expect(onJoinSpy).toHaveBeenCalled();
        expect(setState).toHaveBeenCalled();
      });

      it("should block messages when room guard fails", async () => {
        isRoomGuard.mockReturnValue(true);
        await server.onStart();
        await server.onConnect(conn as any, {} as any);

        isRoomGuard.mockReturnValue(false);
        const message = JSON.stringify({
          action: "increment",
          value: null,
        });

        await server.onMessage(message, conn as any);

        expect(isRoomGuard).toHaveBeenCalledTimes(2);
        expect((server.subRoom as any).count()).toBe(0);
      });

      it("should allow messages when room guard passes", async () => {
        isRoomGuard.mockReturnValue(true);
        await server.onStart();
        await server.onConnect(conn as any, {} as any);

        const message = JSON.stringify({
          action: "increment",
          value: null,
        });

        await server.onMessage(message, conn as any);

        expect(isRoomGuard).toHaveBeenCalledTimes(2);
        expect((server.subRoom as any).count()).toBe(1);
      });

      it("should check room guards before action guards", async () => {
        isRoomGuard.mockReturnValue(false);
        await server.onStart();
        await server.onConnect(conn as any, {} as any);

        const message = JSON.stringify({
          action: "userAction",
          value: null,
        });

        await server.onMessage(message, conn as any);

        expect(isRoomGuard).toHaveBeenCalled();
        expect(isAuthenticatedGuard).not.toHaveBeenCalled();
      });

      it("should pass connection and context to room guards on connect", async () => {
        const context = { request: { headers: new Headers() } };
        await server.onStart();
        await server.onConnect(conn as any, context as any);

        expect(isRoomGuard).toHaveBeenCalledWith(conn, context);
      });

      it("should pass connection and message value to room guards on message", async () => {
        isRoomGuard.mockReturnValue(true);
        await server.onStart();
        await server.onConnect(conn as any, {} as any);

        const testValue = { test: "data" };
        const message = JSON.stringify({
          action: "increment",
          value: testValue,
        });

        await server.onMessage(message, conn as any);

        expect(isRoomGuard).toHaveBeenCalledWith(conn, testValue);
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });
  });